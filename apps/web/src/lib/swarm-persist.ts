/**
 * Shared server-side helpers for running the REAL JackOps SwarmRunner engine
 * on Vercel (serverless) and persisting its genuine traces, approvals and
 * audit events to Amazon Aurora PostgreSQL.
 *
 * Used by the same-origin chat cockpit routes under /api/workflows/* (and
 * available to /api/h0/workflows/run-demo). This is the real jak-swarm engine
 * — live LLM calls, real token usage/cost, real JAK Shield approval gating —
 * not a simulation.
 */
import { prisma } from '@/lib/db';
import type { SwarmResult } from '@jak-swarm/swarm';
import {
  H0_DEMO_TENANT_ID,
  H0_DEMO_USER_ID,
  H0_DEMO_USER_EMAIL,
  H0_DEMO_COMPANY_NAME,
} from '@/lib/h0-demo';

/**
 * In-process, serverless-safe tool whitelist. Heavy server-only tools
 * (browser_*, file_*, code_execute, gmail_*, post_to_*, read_email) cannot
 * run in a Vercel function and are excluded. `send_email` is intentionally
 * INCLUDED so the real JAK Shield approval gate engages — the engine
 * classifies the external send as HIGH risk and routes it to human approval
 * instead of executing, which is exactly the production behavior we want.
 */
export const SERVERLESS_ALLOWED_TOOLS = [
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
  'score_lead',
  'verify_email_deliverability',
];

/** Idempotent preconfigured demo workspace (tenant + user). */
export async function ensureDemoWorkspace(): Promise<void> {
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

/** Pick the first available real LLM key (OpenAI preferred, then Gemini). */
export function pickLlm(): { provider: 'openai' | 'gemini'; key: string } | null {
  const openai = process.env['OPENAI_API_KEY']?.trim();
  if (openai) return { provider: 'openai', key: openai };
  const gemini = process.env['GEMINI_API_KEY']?.trim();
  if (gemini) return { provider: 'gemini', key: gemini };
  return null;
}

/** Reduce the engine's structured outputs to a single text finalOutput. */
export function outputsToText(result: SwarmResult): string {
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

/** Workflow statuses that mean the run is over (no further transitions). */
export function isTerminalStatus(status: string): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'FAILED' ||
    status === 'CANCELLED' ||
    status === 'ROLLED_BACK' ||
    status === 'AWAITING_APPROVAL' ||
    status === 'PAUSED'
  );
}

export interface PersistContext {
  workflowId: string;
  tenantId: string;
  userId: string;
  goal: string;
  industry: string;
  llmProvider: 'openai' | 'gemini';
  /** The real plan (tasks) captured from the plan_created activity event, if any. */
  planJson?: unknown;
}

export interface PersistedApproval {
  id: string;
  taskId: string;
  action: string;
  riskLevel: string;
  status: string;
  toolName: string | null;
  filesAffected: string[];
  externalService: string | null;
  expectedResult: string | null;
}

export interface PersistOutcome {
  totalCostUsd: number;
  finalOutput: string | null;
  createdApprovals: PersistedApproval[];
}

/**
 * Persist a finished (or paused) SwarmRunner result to Aurora: upsert the
 * Workflow row with the final status/cost/plan, write every AgentTrace, write
 * ApprovalRequest + ApprovalAuditLog rows for any pending approvals, and
 * record the workflow lifecycle AuditLog + cost ledger. Idempotent on the
 * Workflow row (upsert by id) so it works whether the row was pre-created
 * (POST /api/workflows) or not (legacy run-demo path).
 */
export async function persistSwarmResult(
  result: SwarmResult,
  ctx: PersistContext,
): Promise<PersistOutcome> {
  const { workflowId, tenantId, userId, goal, industry, llmProvider } = ctx;

  const runId = result.traces[0]?.runId ?? `run_${workflowId}`;
  const totalCostUsd = Math.max(
    0.001,
    result.traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
  );
  const terminal = isTerminalStatus(result.status);
  // The engine can return a non-terminal status (e.g. EXECUTING/RUNNING) when
  // it stalls or hits its internal timeout mid-flight. Coerce those to FAILED
  // so the workflow row reaches a terminal state — otherwise the cockpit's
  // polling fallback reads "EXECUTING" forever and the Run Inspector shows a
  // stuck run. Keep the engine's error message when present.
  const persistedStatus = terminal
    ? result.status
    : 'FAILED';
  const persistedError =
    result.error ??
    (terminal
      ? null
      : 'Workflow did not reach a terminal state (engine stall or timeout).');
  const finalOutput = outputsToText(result) || null;

  const planJsonValue =
    ctx.planJson != null
      ? (ctx.planJson as object)
      : ({
          realEngine: true,
          llmProvider,
          traceCount: result.traces.length,
          approvalCount: result.pendingApprovals.length,
        } as object);

  await prisma.workflow.upsert({
    where: { id: workflowId },
    update: {
      status: persistedStatus,
      ...(terminal ? { completedAt: result.completedAt } : { completedAt: new Date() }),
      error: persistedError,
      planJson: planJsonValue,
      stateJson: {
        realEngine: true,
        status: persistedStatus,
        engineStatus: result.status,
        pendingApprovals: result.pendingApprovals.length,
        error: persistedError,
        demoSafe: true,
      } as object,
      finalOutput,
      totalCostUsd,
    },
    create: {
      id: workflowId,
      tenantId,
      userId,
      goal,
      industry,
      status: persistedStatus,
      startedAt: result.startedAt,
      ...(terminal ? { completedAt: result.completedAt } : { completedAt: new Date() }),
      error: persistedError,
      planJson: planJsonValue,
      stateJson: {
        realEngine: true,
        status: persistedStatus,
        engineStatus: result.status,
        pendingApprovals: result.pendingApprovals.length,
        error: persistedError,
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
  const createdApprovals: PersistedApproval[] = [];
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

    createdApprovals.push({
      id: created.id,
      taskId: ap.taskId,
      action: ap.action,
      riskLevel: String(ap.riskLevel),
      status: ap.status,
      toolName: ap.toolName ?? null,
      filesAffected: ap.filesAffected ?? [],
      externalService: ap.externalService ?? null,
      expectedResult: ap.expectedResult ?? null,
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
      details: { goal, llmProvider, realEngine: true } as object,
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
  if (persistedStatus === 'FAILED' && result.status !== 'FAILED') {
    workflowAudit.push({
      action: 'WORKFLOW_FAILED',
      severity: 'WARN',
      details: {
        error: persistedError ?? 'unknown',
        engineStatus: result.status,
        reason: 'Coerced to FAILED (engine did not reach a terminal state)',
        realEngine: true,
      } as object,
    });
  } else if (result.status === 'FAILED') {
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
        llmProvider,
      } as object,
    },
    create: {
      tenantId,
      key: 'h0_cost_ledger',
      value: {
        ledger: 'real engine — see workflow.totalCostUsd + agent_traces.tokenUsage',
        lastRunCostUsd: totalCostUsd,
        lastRunId: runId,
        llmProvider,
      } as object,
      memoryType: 'KNOWLEDGE',
      source: 'H0_DEMO',
    },
  });

  return { totalCostUsd, finalOutput, createdApprovals };
}

export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'DEFERRED';

export interface DecidedApproval {
  id: string;
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  riskLevel: string;
  status: string;
  reviewedBy: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  toolName: string | null;
  externalService: string | null;
  expectedResult: string | null;
}

/**
 * Apply a human decision to a pending ApprovalRequest (the JAK Shield gate),
 * update the parent Workflow's lifecycle, and write the full audit trail.
 * Pragmatic serverless completion: APPROVED records the authorized send and
 * completes the workflow (send_email is a server-only tool that cannot
 * transmit from a Vercel function, so we record the authorized decision +
 * audit rather than executing). REJECTED cancels the workflow. DEFERRED
 * leaves the approval pending and records the deferral.
 *
 * Returns the updated approval row (cockpit `ApprovalRequest` shape) or
 * `null` if the approval row was not found.
 */
export async function applyApprovalDecision(
  approvalId: string,
  decision: ApprovalDecision,
  comment: string | null,
): Promise<DecidedApproval | null> {
  const approval = await prisma.approvalRequest.findFirst({
    where: { id: approvalId, tenantId: H0_DEMO_TENANT_ID },
  });
  if (!approval) return null;

  const tenantId = approval.tenantId;
  const userId = H0_DEMO_USER_ID;
  const now = new Date();
  const commentValue = comment && comment.trim().length > 0 ? comment.trim() : null;

  if (decision === 'DEFERRED') {
    await prisma.approvalAuditLog.create({
      data: {
        approvalId: approval.id,
        workflowId: approval.workflowId,
        tenantId,
        taskId: approval.taskId,
        agentRole: approval.agentRole,
        riskLevel: approval.riskLevel,
        decision: 'DEFERRED',
        autoApproved: false,
        rationale: commentValue ?? 'Deferred by reviewer',
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'APPROVAL_DEFERRED',
        resource: `approval:${approval.id}`,
        severity: 'INFO',
        details: { workflowId: approval.workflowId, comment: commentValue, realEngine: true } as object,
      },
    });
    return mapApproval(approval);
  }

  const isApproved = decision === 'APPROVED';
  const newStatus = isApproved ? 'APPROVED' : 'REJECTED';

  await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status: newStatus,
      reviewedBy: userId,
      reviewedAt: now,
    },
  });

  await prisma.approvalAuditLog.create({
    data: {
      approvalId: approval.id,
      workflowId: approval.workflowId,
      tenantId,
      taskId: approval.taskId,
      agentRole: approval.agentRole,
      riskLevel: approval.riskLevel,
      decision: newStatus,
      autoApproved: false,
      rationale: commentValue ?? (isApproved ? 'Approved by reviewer' : 'Rejected by reviewer'),
    },
  });

  if (isApproved) {
    await prisma.workflow.update({
      where: { id: approval.workflowId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        finalOutput:
          'Approved by reviewer — external send authorized and recorded. (JAK Shield held the send for human approval; the authorized decision is persisted to the audit trail.)',
      },
    });
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId,
          userId,
          action: 'APPROVAL_GRANTED',
          resource: `approval:${approval.id}`,
          severity: 'INFO',
          details: {
            workflowId: approval.workflowId,
            tool: approval.toolName,
            externalService: approval.externalService,
            comment: commentValue,
            realEngine: true,
          } as object,
        },
        {
          tenantId,
          userId,
          action: 'WORKFLOW_COMPLETED',
          resource: `workflow:${approval.workflowId}`,
          severity: 'INFO',
          details: { reason: 'Approval granted — authorized send recorded', realEngine: true } as object,
        },
      ],
    });
  } else {
    await prisma.workflow.update({
      where: { id: approval.workflowId },
      data: {
        status: 'CANCELLED',
        completedAt: now,
        error: 'Rejected by reviewer — external send blocked by JAK Shield.',
      },
    });
    await prisma.auditLog.createMany({
      data: [
        {
          tenantId,
          userId,
          action: 'APPROVAL_REJECTED',
          resource: `approval:${approval.id}`,
          severity: 'WARN',
          details: {
            workflowId: approval.workflowId,
            tool: approval.toolName,
            externalService: approval.externalService,
            comment: commentValue,
            realEngine: true,
          } as object,
        },
        {
          tenantId,
          userId,
          action: 'WORKFLOW_CANCELLED',
          resource: `workflow:${approval.workflowId}`,
          severity: 'WARN',
          details: { reason: 'Approval rejected', realEngine: true } as object,
        },
      ],
    });
  }

  const refreshed = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
  return mapApproval(refreshed ?? approval);
}

function mapApproval(a: {
  id: string;
  workflowId: string;
  tenantId: string;
  taskId: string;
  agentRole: string;
  action: string;
  rationale: string;
  riskLevel: string;
  status: string;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  toolName: string | null;
  externalService: string | null;
  expectedResult: string | null;
}): DecidedApproval {
  return {
    id: a.id,
    workflowId: a.workflowId,
    tenantId: a.tenantId,
    taskId: a.taskId,
    agentRole: a.agentRole,
    action: a.action,
    rationale: a.rationale,
    riskLevel: a.riskLevel,
    status: a.status,
    reviewedBy: a.reviewedBy,
    comment: null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    toolName: a.toolName,
    externalService: a.externalService,
    expectedResult: a.expectedResult,
  };
}