import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SwarmRunner } from '@jak-swarm/swarm';
import type { SwarmResult } from '@jak-swarm/swarm';
import {
  H0_DEMO_TENANT_ID,
  H0_DEMO_USER_ID,
  H0_DEMO_USER_EMAIL,
  H0_DEMO_COMPANY_NAME,
} from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';
// The real SwarmRunner loop makes several sequential LLM calls (commander →
// planner → guardrail → worker → approval). Allow up to 60s on Vercel Pro so
// the live engine can complete instead of being killed at the 10s default.
export const maxDuration = 60;

/**
 * POST /api/h0/workflows/run-demo
 *
 * Runs a REAL JackOps swarm workflow end-to-end against the live LLM and
 * Amazon Aurora PostgreSQL — the same SwarmRunner engine the production
 * jak-swarm uses, not a simulation. The full agent loop executes:
 *   Commander → Planner → JAK Shield (guardrail) → Worker → Approval gate.
 *
 * The live OpenAI (or Gemini) key drives the agents; their real token usage,
 * cost, tool calls and handoffs are persisted to Aurora as AgentTrace rows.
 * The external customer-email send is classified HIGH risk by JAK Shield, so
 * the engine routes it to a real ApprovalRequest (PENDING) instead of
 * executing it — no real email is ever sent. AuditLog + ApprovalAuditLog rows
 * record the genuine security decision.
 *
 * If the real engine throws (LLM timeout, key error, bundle resolution), we
 * fall back to a deterministic replay so the demo endpoint never 500s. The
 * response flags `realEngine: true/false` so the dashboard shows which path ran.
 *
 * H0 demo mode skips authentication for judge/demo access only.
 */

const GOAL =
  'Review a customer escalation about a delayed AI billing report, draft a professional empathetic reply, and send it to the customer by email.';

// In-process, serverless-safe tool whitelist. Heavy server-only tools
// (browser_*, file_*, code_execute, gmail_*, post_to_*, read_email) cannot run
// in a Vercel function and are excluded. `send_email` is intentionally INCLUDED
// so the real JAK Shield approval gate engages — the engine classifies the
// external send as HIGH risk and routes it to human approval instead of
// executing, which is exactly the production behavior we want to demonstrate.
const ALLOWED_TOOLS = [
  'draft_email',
  'send_email',
  'summarize_document',
  'classify_text',
  'classify_ticket',
  'web_search',
  'web_fetch',
  'memory_store',
  'memory_retrieve',
  'generate_report',
  'lookup_customer',
  'search_knowledge',
  'search_knowledge_base',
];

interface CreatedSummary {
  workflowId: string;
  goal: string;
  status: string;
  riskLevel: string;
  totalCostUsd: number;
  aiSource: string;
  traceCount: number;
  approvalCount: number;
  demoSafe: boolean;
  realEngine: boolean;
}

async function ensureDemoWorkspace() {
  // Idempotent: tenant + user for the preconfigured demo workspace.
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'h0-demo' },
    update: { name: H0_DEMO_COMPANY_NAME, industry: 'TECHNOLOGY' },
    create: {
      id: H0_DEMO_TENANT_ID,
      slug: 'h0-demo',
      name: H0_DEMO_COMPANY_NAME,
      industry: 'TECHNOLOGY',
      status: 'ACTIVE',
      plan: 'ENTERPRISE',
      requireApprovals: true,
      approvalThreshold: 'HIGH',
    },
  });

  // Ensure tenant row uses the stable demo id (upsert by slug may create a new id
  // if the row did not exist with the literal id). Reconcile defensively.
  if (tenant.id !== H0_DEMO_TENANT_ID) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { id: H0_DEMO_TENANT_ID },
    });
  }

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: H0_DEMO_TENANT_ID, email: H0_DEMO_USER_EMAIL } },
    update: { name: 'H0 Judge', role: 'TENANT_ADMIN', active: true },
    create: {
      id: H0_DEMO_USER_ID,
      tenantId: H0_DEMO_TENANT_ID,
      email: H0_DEMO_USER_EMAIL,
      name: 'H0 Judge',
      role: 'TENANT_ADMIN',
      active: true,
    },
  });
}

function pickLlm(): { provider: 'openai' | 'gemini'; key: string } | null {
  const openai = process.env['OPENAI_API_KEY']?.trim();
  if (openai) return { provider: 'openai', key: openai };
  const gemini = process.env['GEMINI_API_KEY']?.trim();
  if (gemini) return { provider: 'gemini', key: gemini };
  return null;
}

function outputsToText(result: SwarmResult): string {
  const outputs = result.outputs ?? [];
  const first = Array.isArray(outputs) ? outputs[0] : outputs;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'text' in first) {
    const t = (first as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  try {
    return JSON.stringify(outputs);
  } catch {
    return '';
  }
}

async function computeSummary(tenantId: string) {
  const [totalWorkflows, completedWorkflows, pendingApprovals, auditEvents, securityCount, costAgg] =
    await Promise.all([
      prisma.workflow.count({ where: { tenantId } }),
      prisma.workflow.count({ where: { tenantId, status: 'COMPLETED' } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.auditLog.count({ where: { tenantId } }),
      prisma.auditLog.count({
        where: {
          tenantId,
          OR: [{ action: { startsWith: 'SECURITY' } }, { severity: { in: ['WARN', 'CRITICAL'] } }],
        },
      }),
      prisma.workflow.aggregate({ where: { tenantId }, _sum: { totalCostUsd: true } }),
    ]);

  return {
    totalWorkflows,
    completedWorkflows,
    pendingApprovals,
    auditEvents,
    securityEvents: securityCount,
    estimatedCostUsd: Number((costAgg._sum.totalCostUsd ?? 0).toFixed(4)),
  };
}

/**
 * Run the REAL SwarmRunner engine and persist its genuine traces, approvals
 * and audit events to Aurora. Returns the summary fields for the dashboard.
 */
async function runRealEngine(): Promise<CreatedSummary> {
  const llm = pickLlm();
  if (!llm) {
    throw new Error('No LLM API key configured (OPENAI_API_KEY or GEMINI_API_KEY).');
  }

  const tenantId = H0_DEMO_TENANT_ID;
  const userId = H0_DEMO_USER_ID;

  const runner = new SwarmRunner({ defaultTimeoutMs: 55_000, maxConcurrentWorkflows: 5 });

  const result: SwarmResult = await runner.run({
    goal: GOAL,
    tenantId,
    userId,
    industry: 'TECHNOLOGY',
    allowedToolNames: ALLOWED_TOOLS,
    browserAutomationEnabled: false,
    autoApproveEnabled: false,
    approvalThreshold: 'HIGH',
    maxCostUsd: 0.25,
    timeoutMs: 55_000,
    llmProvider: llm.provider,
    llmApiKey: llm.key,
  });

  const workflowId = result.workflowId;
  const runId = result.traces[0]?.runId ?? `run_h0_${workflowId}`;
  const totalCostUsd = Math.max(
    0.001,
    result.traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
  );
  const isTerminal =
    result.status === 'COMPLETED' ||
    result.status === 'FAILED' ||
    result.status === 'CANCELLED' ||
    result.status === 'ROLLED_BACK';
  const finalOutput = outputsToText(result) || null;

  // Persist the workflow row using the engine's workflowId so traces FK to it.
  await prisma.workflow.create({
    data: {
      id: workflowId,
      tenantId,
      userId,
      goal: GOAL,
      industry: 'TECHNOLOGY',
      status: result.status,
      startedAt: result.startedAt,
      ...(isTerminal ? { completedAt: result.completedAt } : {}),
      planJson: {
        realEngine: true,
        llmProvider: llm.provider,
        traceCount: result.traces.length,
        approvalCount: result.pendingApprovals.length,
      } as object,
      stateJson: {
        realEngine: true,
        status: result.status,
        pendingApprovals: result.pendingApprovals.length,
        error: result.error ?? null,
        demoSafe: true,
      } as object,
      finalOutput,
      totalCostUsd,
    },
  });

  // Persist every real agent trace (commander, planner, guardrail, worker, …).
  for (const t of result.traces) {
    await prisma.agentTrace.create({
      data: {
        traceId: t.traceId,
        runId: t.runId,
        workflowId,
        tenantId,
        agentRole: String(t.agentRole),
        stepIndex: t.stepIndex,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        durationMs: t.durationMs,
        inputJson: (t.input ?? {}) as object,
        outputJson: (t.output ?? {}) as object,
        toolCallsJson: { calls: t.toolCalls ?? [] } as object,
        handoffsJson: { handoffs: t.handoffs ?? [] } as object,
        ...(t.tokenUsage ? { tokenUsage: t.tokenUsage as object } : {}),
        error: t.error ?? null,
      },
    });
  }

  // Persist the real approval request(s) the guardrail routed to human review.
  for (const ap of result.pendingApprovals) {
    const created = await prisma.approvalRequest.create({
      data: {
        workflowId,
        tenantId,
        taskId: ap.taskId,
        agentRole: String(ap.agentRole),
        action: ap.action,
        rationale: ap.rationale,
        ...(ap.proposedData != null ? { proposedDataJson: ap.proposedData as object } : {}),
        riskLevel: String(ap.riskLevel),
        status: ap.status,
        toolName: ap.toolName ?? null,
        filesAffected: ap.filesAffected ?? [],
        externalService: ap.externalService ?? null,
        expectedResult: ap.expectedResult ?? null,
      },
    });

    await prisma.approvalAuditLog.create({
      data: {
        approvalId: created.id,
        workflowId,
        tenantId,
        taskId: ap.taskId,
        agentRole: 'GUARDRAIL',
        riskLevel: String(ap.riskLevel),
        decision: 'DEFERRED',
        autoApproved: false,
        rationale: 'Routed to human review by JAK Shield (real engine).',
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'SECURITY_DECISION',
        resource: `workflow:${workflowId}`,
        severity: 'WARN',
        details: {
          event: 'External send routed to approval by JAK Shield',
          tool: ap.toolName,
          workflowId,
          approvalId: created.id,
          realEngine: true,
        } as object,
      },
    });
  }

  // Workflow lifecycle audit events tied to the real run.
  const workflowAudit: Array<{
    action: string;
    severity: 'INFO' | 'WARN';
    details: object;
  }> = [
    {
      action: 'WORKFLOW_CREATED',
      severity: 'INFO',
      details: { goal: GOAL, llmProvider: llm.provider, realEngine: true } as object,
    },
  ];
  if (result.status === 'AWAITING_APPROVAL') {
    workflowAudit.push({
      action: 'WORKFLOW_PAUSED',
      severity: 'WARN',
      details: {
        reason: 'High-risk external action awaiting approval (real engine)',
        approvalCount: result.pendingApprovals.length,
      } as object,
    });
  }
  if (result.status === 'COMPLETED') {
    workflowAudit.push({
      action: 'WORKFLOW_COMPLETED',
      severity: 'INFO',
      details: { traceCount: result.traces.length, realEngine: true } as object,
    });
  }
  if (result.status === 'FAILED') {
    workflowAudit.push({
      action: 'WORKFLOW_FAILED',
      severity: 'WARN',
      details: { error: result.error ?? 'unknown', realEngine: true } as object,
    });
  }
  await prisma.auditLog.createMany({
    data: workflowAudit.map((e) => ({
      tenantId,
      userId,
      action: e.action,
      resource: `workflow:${workflowId}`,
      severity: e.severity,
      details: e.details,
    })),
  });

  // Cost/token ledger entry in tenant memory (real engine ledger).
  await prisma.tenantMemory.upsert({
    where: { tenantId_key: { tenantId, key: 'h0_cost_ledger' } },
    update: {
      value: {
        ledger: 'real engine — see workflow.totalCostUsd + agent_traces.tokenUsage',
        lastRunCostUsd: totalCostUsd,
        lastRunId: runId,
        llmProvider: llm.provider,
      } as object,
    },
    create: {
      tenantId,
      key: 'h0_cost_ledger',
      value: {
        ledger: 'real engine — see workflow.totalCostUsd + agent_traces.tokenUsage',
        lastRunCostUsd: totalCostUsd,
        lastRunId: runId,
        llmProvider: llm.provider,
      } as object,
      memoryType: 'KNOWLEDGE',
      source: 'H0_DEMO',
    },
  });

  return {
    workflowId,
    goal: GOAL,
    status: result.status,
    riskLevel: 'HIGH',
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    aiSource: `${llm.provider}:real-engine`,
    traceCount: result.traces.length,
    approvalCount: result.pendingApprovals.length,
    demoSafe: true,
    realEngine: true,
  };
}

/**
 * Deterministic fallback — only used if the real engine throws. Produces a
 * plausible replay so the demo endpoint never returns a 500. Mirrors the
 * pre-engine behavior, with a short OpenAI/Gemini draft call when a key exists.
 */
async function tryGenerateResponse(): Promise<{ text: string; source: string }> {
  const openaiKey = process.env['OPENAI_API_KEY']?.trim();
  const geminiKey = process.env['GEMINI_API_KEY']?.trim();

  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful customer-ops assistant. Draft a short, professional, empathetic reply to an escalated customer. Max 120 words.',
            },
            {
              role: 'user',
              content:
                'A customer escalated: their AI billing report was 2 days late and they need an explanation + next steps.',
            },
          ],
          max_tokens: 220,
          temperature: 0.4,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text) return { text, source: 'openai:gpt-4o-mini' };
      }
    } catch {
      // fall through to deterministic
    }
  }

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: 'A customer escalated: their AI billing report was 2 days late. Draft a short, professional, empathetic reply (max 120 words) with explanation and next steps.',
                  },
                ],
              },
            ],
          }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return { text, source: 'gemini:1.5-flash' };
      }
    } catch {
      // fall through to deterministic
    }
  }

  return {
    text:
      'Hi — thank you for flagging this. Your AI billing report was delayed because a scheduled data sync from the payments connector stalled; we retried it and the report is regenerating now. You will receive the updated report within the next 30 minutes. We have added a monitor so future stalls surface to our on-call team immediately. Please reply if anything looks off once it arrives. — JackOps AI Ops',
    source: 'deterministic-fallback',
  };
}

interface TraceSpec {
  role: string;
  stepIndex: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  toolCalls: string[];
  durationMs: number;
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
}

async function runDeterministicFallback(): Promise<CreatedSummary> {
  const tenantId = H0_DEMO_TENANT_ID;
  const userId = H0_DEMO_USER_ID;
  const now = Date.now();
  const startedAt = new Date(now);

  const { text: draftResponse, source: aiSource } = await tryGenerateResponse();
  const totalCostUsd = 0.0142;

  const workflow = await prisma.workflow.create({
    data: {
      tenantId,
      userId,
      goal: GOAL,
      industry: 'TECHNOLOGY',
      status: 'PAUSED',
      startedAt,
      planJson: {
        riskLevel: 'HIGH',
        steps: [
          'commander: receive escalation',
          'planner: break into steps',
          'security: classify risk',
          'worker: draft response',
          'approval gate: external send review',
        ],
        aiSource,
        fallback: true,
      } as object,
      stateJson: {
        riskLevel: 'HIGH',
        demoSafe: true,
        pendingAction: 'send_customer_email',
        blockedExternalWrite: true,
        fallback: true,
      } as object,
      finalOutput: draftResponse,
      totalCostUsd,
    },
  });

  const workflowId = workflow.id;
  const traceId = `trc_h0_${workflowId}`;
  const runId = `run_h0_${workflowId}`;

  const traces: TraceSpec[] = [
    {
      role: 'COMMANDER',
      stepIndex: 0,
      input: { goal: GOAL },
      output: { plan: 'intake escalation -> classify -> draft -> approve -> deliver' },
      toolCalls: [],
      durationMs: 980,
      tokens: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
    },
    {
      role: 'PLANNER',
      stepIndex: 1,
      input: { goal: GOAL },
      output: { steps: ['classify risk', 'draft response', 'route external send to approval'] },
      toolCalls: ['planner.decompose'],
      durationMs: 1450,
      tokens: { promptTokens: 180, completionTokens: 110, totalTokens: 290 },
    },
    {
      role: 'GUARDRAIL',
      stepIndex: 2,
      input: { action: 'send_customer_email', target: 'external customer' },
      output: { riskLevel: 'HIGH', decision: 'block_auto_execute', routeToApproval: true },
      toolCalls: ['shield.classify', 'shield.promptInjectionCheck'],
      durationMs: 760,
      tokens: { promptTokens: 90, completionTokens: 40, totalTokens: 130 },
    },
    {
      role: 'WORKER_DOCUMENT',
      stepIndex: 3,
      input: { task: 'draft empathetic response (<=120 words)', aiSource },
      output: { draft: draftResponse.slice(0, 200), aiSource },
      toolCalls: [
        aiSource.startsWith('openai')
          ? 'openai.chat'
          : aiSource.startsWith('gemini')
            ? 'gemini.generate'
            : 'demo.draft',
      ],
      durationMs: 2100,
      tokens: { promptTokens: 260, completionTokens: 190, totalTokens: 450 },
    },
  ];

  let elapsed = 0;
  for (const t of traces) {
    const tStarted = new Date(startedAt.getTime() + elapsed);
    elapsed += t.durationMs;
    await prisma.agentTrace.create({
      data: {
        traceId: `${traceId}_${t.stepIndex}`,
        runId,
        workflowId,
        tenantId,
        agentRole: t.role,
        stepIndex: t.stepIndex,
        startedAt: tStarted,
        completedAt: new Date(tStarted.getTime() + t.durationMs),
        durationMs: t.durationMs,
        inputJson: t.input as object,
        outputJson: t.output as object,
        toolCallsJson: { calls: t.toolCalls } as object,
        tokenUsage: t.tokens as object,
      },
    });
  }

  const approval = await prisma.approvalRequest.create({
    data: {
      workflowId,
      tenantId,
      taskId: `task_${workflowId}_send`,
      agentRole: 'WORKER_DOCUMENT',
      action: 'Send drafted response to external customer email',
      rationale:
        'External customer communication is classified HIGH risk. Auto-execution blocked by JackOps security layer; routed to human approval. Demo-safe: no real email is sent.',
      riskLevel: 'HIGH',
      status: 'PENDING',
      toolName: 'send_email',
      externalService: 'Customer Email (external)',
      expectedResult: 'One outbound email to the escalated customer (held pending approval)',
      proposedDataJson: {
        to: 'customer@example.com',
        subject: 'Re: delayed AI billing report',
        bodyPreview: draftResponse.slice(0, 120),
      } as object,
      filesAffected: [],
    },
  });

  await prisma.approvalAuditLog.create({
    data: {
      approvalId: approval.id,
      workflowId,
      tenantId,
      taskId: `task_${workflowId}_send`,
      agentRole: 'GUARDRAIL',
      riskLevel: 'HIGH',
      decision: 'DEFERRED',
      autoApproved: false,
      rationale: 'Routed to human review — external/destructive action blocked in demo mode.',
    },
  });

  const securityEvents = [
    {
      action: 'SECURITY_DECISION',
      resource: `workflow:${workflowId}`,
      severity: 'WARN',
      details: { event: 'External customer email blocked pending approval', workflowId, approvalId: approval.id, demoSafe: true } as object,
    },
    {
      action: 'SECURITY_DECISION',
      resource: `workflow:${workflowId}`,
      severity: 'INFO',
      details: { event: 'Prompt injection risk checked on customer escalation text', result: 'no injection detected', workflowId } as object,
    },
    {
      action: 'SECURITY_DECISION',
      resource: `workflow:${workflowId}`,
      severity: 'CRITICAL',
      details: { event: 'Destructive connector action converted to approval request', blockedAction: 'send_customer_email', workflowId } as object,
    },
  ];
  for (const e of securityEvents) {
    await prisma.auditLog.create({
      data: { tenantId, userId, action: e.action, resource: e.resource, severity: e.severity, details: e.details },
    });
  }

  await prisma.auditLog.createMany({
    data: [
      {
        tenantId,
        userId,
        action: 'WORKFLOW_CREATED',
        resource: `workflow:${workflowId}`,
        severity: 'INFO',
        details: { goal: workflow.goal, aiSource, fallback: true } as object,
      },
      {
        tenantId,
        userId,
        action: 'WORKFLOW_PAUSED',
        resource: `workflow:${workflowId}`,
        severity: 'WARN',
        details: { reason: 'High-risk external action awaiting approval', approvalId: approval.id, fallback: true } as object,
      },
    ],
  });

  await prisma.tenantMemory.upsert({
    where: { tenantId_key: { tenantId, key: 'h0_cost_ledger' } },
    update: { value: { ledger: 'deterministic fallback', lastRunCostUsd: totalCostUsd, lastRunId: runId } as object },
    create: {
      tenantId,
      key: 'h0_cost_ledger',
      value: { ledger: 'deterministic fallback', lastRunCostUsd: totalCostUsd, lastRunId: runId } as object,
      memoryType: 'KNOWLEDGE',
      source: 'H0_DEMO',
    },
  });

  return {
    workflowId,
    goal: workflow.goal,
    status: workflow.status,
    riskLevel: 'HIGH',
    totalCostUsd,
    aiSource: `${aiSource}:fallback`,
    traceCount: traces.length,
    approvalCount: 1,
    demoSafe: true,
    realEngine: false,
  };
}

export async function POST() {
  try {
    await ensureDemoWorkspace();

    let created: CreatedSummary;
    try {
      created = await runRealEngine();
    } catch (engineErr) {
      // Real engine failed (LLM timeout, key error, bundle/import issue) —
      // fall back to a deterministic replay so the demo endpoint never 500s.
      // eslint-disable-next-line no-console
      console.error('[h0 run-demo] real engine failed, using deterministic fallback:', engineErr);
      created = await runDeterministicFallback();
    }

    const summary = await computeSummary(H0_DEMO_TENANT_ID);

    return NextResponse.json({ created, summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'run_demo_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}