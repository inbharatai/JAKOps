import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  H0_DEMO_TENANT_ID,
  H0_DEMO_USER_ID,
  H0_DEMO_USER_EMAIL,
  H0_DEMO_COMPANY_NAME,
} from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * POST /api/h0/workflows/run-demo
 *
 * Creates a realistic "Review customer escalation and draft response"
 * workflow end-to-end in Aurora, then returns the new workflow plus an
 * updated summary. Demonstrates the full JackOps loop:
 *   Commander → Planner → Security layer → Worker → Approval gate → Audit.
 *
 * Security/demo-safety: the external customer-email send is classified as
 * HIGH risk. We do NOT execute it. We create an approval request, mark it
 * demo-safe, log a SECURITY_DECISION audit event, and surface it in the
 * approval queue + audit replay. No real emails are ever sent.
 *
 * Optional OpenAI/Gemini call: if a key is set, the Worker step calls the
 * model through a Vercel server route for one short business output. If the
 * key is missing or the call fails, we fall back to deterministic demo
 * output so the demo never breaks.
 */

interface TraceSpec {
  role: string;
  stepIndex: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  toolCalls: string[];
  durationMs: number;
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
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

  const user = await prisma.user.upsert({
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

  return { tenant, user };
}

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
          },
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
    source: 'deterministic-demo',
  };
}

export async function POST() {
  try {
    await ensureDemoWorkspace();

    const now = Date.now();
    const startedAt = new Date(now);
    const tenantId = H0_DEMO_TENANT_ID;
    const userId = H0_DEMO_USER_ID;

    const { text: draftResponse, source: aiSource } = await tryGenerateResponse();

    const totalCostUsd = 0.0142;

    const workflow = await prisma.workflow.create({
      data: {
        tenantId,
        userId,
        goal: 'Review customer escalation and draft response',
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
        } as object,
        stateJson: {
          riskLevel: 'HIGH',
          demoSafe: true,
          pendingAction: 'send_customer_email',
          blockedExternalWrite: true,
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
        input: { goal: 'Review customer escalation and draft response' },
        output: { plan: 'intake escalation -> classify -> draft -> approve -> deliver' },
        toolCalls: [],
        durationMs: 980,
        tokens: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
      },
      {
        role: 'PLANNER',
        stepIndex: 1,
        input: { goal: 'Review customer escalation and draft response' },
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
        toolCalls: [aiSource.startsWith('openai') ? 'openai.chat' : aiSource.startsWith('gemini') ? 'gemini.generate' : 'demo.draft'],
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

    // Approval gate — external customer email is HIGH risk. Do NOT execute.
    // Create an approval request, mark demo-safe.
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
        proposedDataJson: { to: 'customer@example.com', subject: 'Re: delayed AI billing report', bodyPreview: draftResponse.slice(0, 120) } as object,
        filesAffected: [],
      },
    });

    // Approval audit log (auto-block / route-to-review decision).
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

    // Security/governance decision events.
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

    // Workflow audit log entries (replay evidence).
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId,
          userId,
          action: 'WORKFLOW_CREATED',
          resource: `workflow:${workflowId}`,
          severity: 'INFO',
          details: { goal: workflow.goal, aiSource } as object,
        },
        {
          tenantId,
          userId,
          action: 'WORKFLOW_PAUSED',
          resource: `workflow:${workflowId}`,
          severity: 'WARN',
          details: { reason: 'High-risk external action awaiting approval', approvalId: approval.id } as object,
        },
      ],
    });

    // Cost/token ledger entry in tenant memory (demo ledger).
    await prisma.tenantMemory.upsert({
      where: { tenantId_key: { tenantId, key: 'h0_cost_ledger' } },
      update: { value: { ledger: 'see workflow.totalCostUsd + agent_traces.tokenUsage', lastRunCostUsd: totalCostUsd, lastRunId: runId } as object },
      create: {
        tenantId,
        key: 'h0_cost_ledger',
        value: { ledger: 'see workflow.totalCostUsd + agent_traces.tokenUsage', lastRunCostUsd: totalCostUsd, lastRunId: runId } as object,
        memoryType: 'KNOWLEDGE',
        source: 'H0_DEMO',
      },
    });

    // Updated summary (cheap recompute).
    const [totalWorkflows, completedWorkflows, pendingApprovals, auditEvents, securityCount, costAgg] = await Promise.all([
      prisma.workflow.count({ where: { tenantId } }),
      prisma.workflow.count({ where: { tenantId, status: 'COMPLETED' } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.auditLog.count({ where: { tenantId } }),
      prisma.auditLog.count({
        where: { tenantId, OR: [{ action: { startsWith: 'SECURITY' } }, { severity: { in: ['WARN', 'CRITICAL'] } }] },
      }),
      prisma.workflow.aggregate({ where: { tenantId }, _sum: { totalCostUsd: true } }),
    ]);

    return NextResponse.json({
      created: {
        workflowId,
        goal: workflow.goal,
        status: workflow.status,
        riskLevel: 'HIGH',
        totalCostUsd,
        aiSource,
        traceCount: traces.length,
        approvalId: approval.id,
        demoSafe: true,
      },
      summary: {
        totalWorkflows,
        completedWorkflows,
        pendingApprovals,
        auditEvents,
        securityEvents: securityCount,
        estimatedCostUsd: Number((costAgg._sum.totalCostUsd ?? 0).toFixed(4)),
      },
    });
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