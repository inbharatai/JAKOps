/**
 * seed-h0-demo.ts — idempotent seed for the JackOps H0 demo workspace.
 *
 * Provisions the preconfigured demo workspace (no signup required for judges)
 * and three realistic workflows with agent traces, approval requests,
 * approval audit logs, audit logs, security/governance decisions, and
 * cost/token-usage data — all in Amazon Aurora PostgreSQL via Prisma.
 *
 * Run:  pnpm h0:seed   (or)   tsx scripts/seed-h0-demo.ts
 *
 * Idempotent: re-running wipes the demo tenant's child rows and re-creates
 * them, so the demo tenant/user are never duplicated.
 *
 * H0 demo mode skips authentication for judge/demo access only. Do not enable
 * in production.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = 'h0-demo-tenant';
const TENANT_SLUG = 'h0-demo';
const USER_ID = 'h0-demo-user';
const USER_EMAIL = 'judge@jackops.demo';
const COMPANY = 'H0 Demo Company';

interface TraceSpec {
  role: string;
  stepIndex: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  toolCalls: string[];
  durationMs: number;
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}

async function wipeDemo() {
  // Order respects FKs. Audit/approval-audit have no cascade from workflow,
  // so delete them explicitly. Traces/jobs/approvals cascade from workflow
  // but we delete them explicitly too for clarity.
  await prisma.tenantMemory.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.auditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.approvalAuditLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.approvalRequest.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.agentTrace.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.workflowJob.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.workflow.deleteMany({ where: { tenantId: TENANT_ID } });
}

async function ensureTenantUser() {
  await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { id: TENANT_ID, name: COMPANY, industry: 'TECHNOLOGY', approvalThreshold: 'HIGH', requireApprovals: true },
    create: {
      id: TENANT_ID,
      slug: TENANT_SLUG,
      name: COMPANY,
      industry: 'TECHNOLOGY',
      status: 'ACTIVE',
      plan: 'ENTERPRISE',
      requireApprovals: true,
      approvalThreshold: 'HIGH',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: TENANT_ID, email: USER_EMAIL } },
    update: { id: USER_ID, name: 'H0 Judge', role: 'TENANT_ADMIN', active: true },
    create: {
      id: USER_ID,
      tenantId: TENANT_ID,
      email: USER_EMAIL,
      name: 'H0 Judge',
      role: 'TENANT_ADMIN',
      active: true,
    },
  });
}

async function createTraces(workflowId: string, runId: string, startedAt: Date, traces: TraceSpec[]) {
  let elapsed = 0;
  for (const t of traces) {
    const tStarted = new Date(startedAt.getTime() + elapsed);
    elapsed += t.durationMs;
    await prisma.agentTrace.create({
      data: {
        traceId: `trc_${workflowId}_${t.stepIndex}`,
        runId,
        workflowId,
        tenantId: TENANT_ID,
        agentRole: t.role,
        stepIndex: t.stepIndex,
        startedAt: tStarted,
        completedAt: new Date(tStarted.getTime() + t.durationMs),
        durationMs: t.durationMs,
        inputJson: t.input as object,
        outputJson: t.output as object,
        toolCallsJson: { calls: t.toolCalls } as object,
        tokenUsage: t.tokens as object,
        ...(t.error ? { error: t.error } : {}),
      },
    });
  }
}

async function logAudit(action: string, resource: string, severity: string, details: object) {
  await prisma.auditLog.create({
    data: { tenantId: TENANT_ID, userId: USER_ID, action, resource, severity, details },
  });
}

async function seedWorkflow1() {
  // COMPLETED · MEDIUM · full audit replay.
  const startedAt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const completedAt = new Date(startedAt.getTime() + 4 * 60 * 1000);
  const w = await prisma.workflow.create({
    data: {
      tenantId: TENANT_ID,
      userId: USER_ID,
      goal: 'Create Q2 market analysis for enterprise AI operations',
      industry: 'TECHNOLOGY',
      status: 'COMPLETED',
      startedAt,
      completedAt,
      totalCostUsd: 0.0231,
      planJson: { riskLevel: 'MEDIUM', steps: ['research', 'synth', 'review', 'deliver'] } as object,
      stateJson: { riskLevel: 'MEDIUM', demoSafe: true } as object,
      finalOutput:
        'Q2 enterprise AI ops market analysis: demand for approval-gated agent platforms grew 38% QoQ. Top buyer priorities are audit trails, cost controls, and human-in-the-loop on destructive actions. Recommend positioning JackOps around governance + replay.',
    },
  });
  await createTraces(w.id, `run_${w.id}`, startedAt, [
    { role: 'COMMANDER', stepIndex: 0, input: { goal: 'Q2 market analysis' }, output: { plan: 'research -> synth -> review -> deliver' }, toolCalls: [], durationMs: 1100, tokens: { promptTokens: 130, completionTokens: 70, totalTokens: 200 } },
    { role: 'PLANNER', stepIndex: 1, input: { goal: 'Q2 market analysis' }, output: { steps: ['gather sources', 'synthesize trends', 'recommend positioning'] }, toolCalls: ['planner.decompose'], durationMs: 1600, tokens: { promptTokens: 200, completionTokens: 120, totalTokens: 320 } },
    { role: 'GUARDRAIL', stepIndex: 2, input: { action: 'internal_report' }, output: { riskLevel: 'MEDIUM', decision: 'auto_allow_internal' }, toolCalls: ['shield.classify'], durationMs: 820, tokens: { promptTokens: 90, completionTokens: 40, totalTokens: 130 } },
    { role: 'WORKER_RESEARCH', stepIndex: 3, input: { task: 'synthesize trends' }, output: { growth: '38% QoQ', buyers: ['audit trails', 'cost controls', 'HITL'] }, toolCalls: ['research.search', 'research.synth'], durationMs: 3200, tokens: { promptTokens: 410, completionTokens: 300, totalTokens: 710 } },
    { role: 'VERIFIER', stepIndex: 4, input: { draft: 'market analysis' }, output: { verdict: 'verified', claimsChecked: 6 }, toolCalls: ['verifier.check'], durationMs: 1400, tokens: { promptTokens: 180, completionTokens: 90, totalTokens: 270 } },
  ]);
  await logAudit('WORKFLOW_CREATED', `workflow:${w.id}`, 'INFO', { goal: w.goal });
  await logAudit('WORKFLOW_COMPLETED', `workflow:${w.id}`, 'INFO', { durationMs: 240000 });
  await logAudit('SECURITY_DECISION', `workflow:${w.id}`, 'INFO', { event: 'Prompt injection risk checked on source documents', result: 'no injection detected' });
}

async function seedWorkflow2() {
  // PAUSED / PENDING_APPROVAL · HIGH · approval for external customer communication.
  const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const w = await prisma.workflow.create({
    data: {
      tenantId: TENANT_ID,
      userId: USER_ID,
      goal: 'Review customer escalation and draft response',
      industry: 'TECHNOLOGY',
      status: 'PAUSED',
      startedAt,
      totalCostUsd: 0.0142,
      planJson: { riskLevel: 'HIGH', steps: ['commander', 'planner', 'security', 'worker', 'approval gate'] } as object,
      stateJson: { riskLevel: 'HIGH', demoSafe: true, pendingAction: 'send_customer_email', blockedExternalWrite: true } as object,
      finalOutput:
        'Hi — thank you for flagging this. Your AI billing report was delayed because a scheduled data sync from the payments connector stalled; we retried it and the report is regenerating now. You will receive the updated report within 30 minutes.',
    },
  });
  await createTraces(w.id, `run_${w.id}`, startedAt, [
    { role: 'COMMANDER', stepIndex: 0, input: { goal: 'Review customer escalation and draft response' }, output: { plan: 'intake -> classify -> draft -> approve -> deliver' }, toolCalls: [], durationMs: 980, tokens: { promptTokens: 120, completionTokens: 60, totalTokens: 180 } },
    { role: 'PLANNER', stepIndex: 1, input: { goal: 'draft response' }, output: { steps: ['classify risk', 'draft response', 'route external send to approval'] }, toolCalls: ['planner.decompose'], durationMs: 1450, tokens: { promptTokens: 180, completionTokens: 110, totalTokens: 290 } },
    { role: 'GUARDRAIL', stepIndex: 2, input: { action: 'send_customer_email', target: 'external customer' }, output: { riskLevel: 'HIGH', decision: 'block_auto_execute', routeToApproval: true }, toolCalls: ['shield.classify', 'shield.promptInjectionCheck'], durationMs: 760, tokens: { promptTokens: 90, completionTokens: 40, totalTokens: 130 } },
    { role: 'WORKER_DOCUMENT', stepIndex: 3, input: { task: 'draft empathetic response (<=120 words)' }, output: { draft: 'Hi — thank you for flagging this…' }, toolCalls: ['demo.draft'], durationMs: 2100, tokens: { promptTokens: 260, completionTokens: 190, totalTokens: 450 } },
  ]);
  const approval = await prisma.approvalRequest.create({
    data: {
      workflowId: w.id,
      tenantId: TENANT_ID,
      taskId: `task_${w.id}_send`,
      agentRole: 'WORKER_DOCUMENT',
      action: 'Send drafted response to external customer email',
      rationale: 'External customer communication is HIGH risk. Auto-execution blocked by JackOps security layer; routed to human approval. Demo-safe: no real email is sent.',
      riskLevel: 'HIGH',
      status: 'PENDING',
      toolName: 'send_email',
      externalService: 'Customer Email (external)',
      expectedResult: 'One outbound email to the escalated customer (held pending approval)',
      proposedDataJson: { to: 'customer@example.com', subject: 'Re: delayed AI billing report' } as object,
      filesAffected: [],
    },
  });
  await prisma.approvalAuditLog.create({
    data: {
      approvalId: approval.id,
      workflowId: w.id,
      tenantId: TENANT_ID,
      taskId: `task_${w.id}_send`,
      agentRole: 'GUARDRAIL',
      riskLevel: 'HIGH',
      decision: 'DEFERRED',
      autoApproved: false,
      rationale: 'Routed to human review — external/destructive action blocked in demo mode.',
    },
  });
  await logAudit('WORKFLOW_CREATED', `workflow:${w.id}`, 'INFO', { goal: w.goal });
  await logAudit('WORKFLOW_PAUSED', `workflow:${w.id}`, 'WARN', { reason: 'High-risk external action awaiting approval', approvalId: approval.id });
  await logAudit('SECURITY_DECISION', `workflow:${w.id}`, 'WARN', { event: 'External customer email blocked pending approval', approvalId: approval.id, demoSafe: true });
  await logAudit('SECURITY_DECISION', `workflow:${w.id}`, 'INFO', { event: 'Prompt injection risk checked on customer escalation text', result: 'no injection detected' });
  await logAudit('SECURITY_DECISION', `workflow:${w.id}`, 'CRITICAL', { event: 'Destructive connector action converted to approval request', blockedAction: 'send_customer_email' });
}

async function seedWorkflow3() {
  // FAILED -> RETRIED -> COMPLETED · LOW/MEDIUM · retry/error trace.
  const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const completedAt = new Date(startedAt.getTime() + 9 * 60 * 1000);
  const w = await prisma.workflow.create({
    data: {
      tenantId: TENANT_ID,
      userId: USER_ID,
      goal: 'Analyze weekly sales pipeline and recommend follow-ups',
      industry: 'TECHNOLOGY',
      status: 'COMPLETED',
      startedAt,
      completedAt,
      totalCostUsd: 0.0098,
      planJson: { riskLevel: 'MEDIUM', steps: ['pull pipeline', 'analyze', 'recommend', 'deliver'], retries: 1 } as object,
      stateJson: { riskLevel: 'MEDIUM', demoSafe: true, retried: true } as object,
      finalOutput:
        'Weekly pipeline: 42 open deals, 8 stalled >14 days. Recommend follow-ups on 5 high-value stalled deals and a nurture sequence for 14 cold leads. Top risk: 2 deals in negotiation past close date.',
    },
  });
  await createTraces(w.id, `run_${w.id}`, startedAt, [
    { role: 'COMMANDER', stepIndex: 0, input: { goal: 'Analyze weekly sales pipeline' }, output: { plan: 'pull -> analyze -> recommend' }, toolCalls: [], durationMs: 900, tokens: { promptTokens: 110, completionTokens: 50, totalTokens: 160 } },
    { role: 'WORKER_RESEARCH', stepIndex: 1, input: { task: 'pull pipeline from CRM' }, output: {}, toolCalls: ['crm.fetchPipeline'], durationMs: 1800, tokens: { promptTokens: 150, completionTokens: 0, totalTokens: 150 }, error: 'crm.fetchPipeline timed out after 5000ms (transient)' },
    { role: 'COMMANDER', stepIndex: 2, input: { retry: true, attempt: 2 }, output: { decision: 'retry with backoff' }, toolCalls: ['runtime.retry'], durationMs: 600, tokens: { promptTokens: 60, completionTokens: 20, totalTokens: 80 } },
    { role: 'WORKER_RESEARCH', stepIndex: 3, input: { task: 'pull pipeline from CRM (retry)' }, output: { deals: 42, stalled: 8 }, toolCalls: ['crm.fetchPipeline'], durationMs: 2400, tokens: { promptTokens: 180, completionTokens: 220, totalTokens: 400 } },
    { role: 'VERIFIER', stepIndex: 4, input: { draft: 'pipeline recommendations' }, output: { verdict: 'verified', recommendations: 5 }, toolCalls: ['verifier.check'], durationMs: 1300, tokens: { promptTokens: 160, completionTokens: 80, totalTokens: 240 } },
  ]);
  await logAudit('WORKFLOW_CREATED', `workflow:${w.id}`, 'INFO', { goal: w.goal });
  await logAudit('WORKFLOW_TASK_FAILED', `workflow:${w.id}`, 'ERROR', { task: 'crm.fetchPipeline', reason: 'timeout (transient)' });
  await logAudit('WORKFLOW_RETRIED', `workflow:${w.id}`, 'WARN', { attempt: 2 });
  await logAudit('WORKFLOW_COMPLETED', `workflow:${w.id}`, 'INFO', { recommendations: 5 });
  await logAudit('SECURITY_DECISION', `workflow:${w.id}`, 'INFO', { event: 'High-risk workflow routed to human review', result: 'no external write attempted' });
}

async function seedCostLedger() {
  await prisma.tenantMemory.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: 'h0_cost_ledger' } },
    update: {
      value: {
        ledger: 'see workflow.totalCostUsd + agent_traces.tokenUsage',
        seededTotalCostUsd: 0.0471,
        note: 'Cost derived from Workflow.totalCostUsd and AgentTrace.tokenUsage. No separate cost table required.',
      } as object,
    },
    create: {
      tenantId: TENANT_ID,
      key: 'h0_cost_ledger',
      value: { ledger: 'see workflow.totalCostUsd + agent_traces.tokenUsage', seededTotalCostUsd: 0.0471 } as object,
      memoryType: 'KNOWLEDGE',
      source: 'H0_DEMO',
    },
  });
  await prisma.tenantMemory.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: 'h0_security_policy' } },
    update: {
      value: {
        policy: 'External/destructive/sensitive actions are blocked from auto-execution and routed to human approval.',
        demoSafe: true,
        rules: ['no real emails', 'no slack writes', 'no github writes', 'no CRM mutations', 'no payments'],
      } as object,
    },
    create: {
      tenantId: TENANT_ID,
      key: 'h0_security_policy',
      value: { policy: 'External/destructive/sensitive actions blocked -> human approval.', demoSafe: true } as object,
      memoryType: 'POLICY',
      source: 'ADMIN',
    },
  });
}

async function main() {
  console.log('JackOps H0 seed: wiping existing demo rows…');
  await wipeDemo();
  console.log('JackOps H0 seed: ensuring demo tenant + user…');
  await ensureTenantUser();
  console.log('JackOps H0 seed: creating workflows…');
  await seedWorkflow1();
  await seedWorkflow2();
  await seedWorkflow3();
  await seedCostLedger();
  console.log('✓ JackOps H0 demo workspace seeded (tenant=h0-demo-tenant, user=judge@jackops.demo, 3 workflows).');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });