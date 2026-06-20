import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateId, WorkflowStatus } from '@jak-swarm/shared';
import {
  H0_DEMO_TENANT_ID,
  H0_DEMO_USER_ID,
} from '@/lib/h0-demo';
import { ensureDemoWorkspace, pickLlm } from '@/lib/swarm-persist';
import { agentTraceToRecord } from '@/lib/trace-mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows — list real workflows from Aurora for the Runs Inspector
 * (/swarm, via useWorkflows → workflowApi.list). Returns a
 * `PaginatedResult<Workflow>` with `traces` (AgentTraceRecord[]) and `traceCount`
 * embedded per workflow so the Runs page renders per-trace timelines without
 * N+1 fetches. Supports `status`, `page`, `limit` filters. Demo workspace.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { tenantId: H0_DEMO_TENANT_ID };
    if (status) where.status = status;

    const [total, workflows] = await Promise.all([
      prisma.workflow.count({ where }),
      prisma.workflow.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const workflowIds = workflows.map((w) => w.id);
    const [allTraces, allApprovals] = await Promise.all([
      workflowIds.length
        ? prisma.agentTrace.findMany({
            where: { workflowId: { in: workflowIds } },
            orderBy: [{ startedAt: 'asc' }, { stepIndex: 'asc' }],
          })
        : Promise.resolve([]),
      workflowIds.length
        ? prisma.approvalRequest.findMany({
            where: { workflowId: { in: workflowIds } },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const tracesByWf = new Map<string, typeof allTraces>();
    for (const t of allTraces) {
      const list = tracesByWf.get(t.workflowId) ?? [];
      list.push(t);
      tracesByWf.set(t.workflowId, list);
    }
    const approvalsByWf = new Map<string, typeof allApprovals>();
    for (const a of allApprovals) {
      const list = approvalsByWf.get(a.workflowId) ?? [];
      list.push(a);
      approvalsByWf.set(a.workflowId, list);
    }

    const items = workflows.map((w) => ({
      id: w.id,
      tenantId: w.tenantId,
      createdBy: w.userId,
      goal: w.goal,
      industry: w.industry,
      status: w.status,
      result: w.finalOutput,
      finalOutput: w.finalOutput ?? null,
      error: w.error ?? null,
      errorMessage: w.error ?? null,
      startedAt: w.startedAt?.toISOString() ?? null,
      completedAt: w.completedAt?.toISOString() ?? null,
      createdAt: (w.startedAt ?? w.updatedAt).toISOString(),
      updatedAt: w.updatedAt.toISOString(),
      plan: (w.planJson as Record<string, unknown> | null) ?? undefined,
      traces: (tracesByWf.get(w.id) ?? []).map((t) =>
        agentTraceToRecord(t as Parameters<typeof agentTraceToRecord>[0]),
      ),
      traceCount: tracesByWf.get(w.id)?.length ?? 0,
      approvals: (approvalsByWf.get(w.id) ?? []).map((a) => ({
        id: a.id,
        workflowId: a.workflowId,
        tenantId: a.tenantId,
        taskId: a.taskId,
        agentRole: a.agentRole,
        action: a.action,
        rationale: a.rationale,
        riskLevel: a.riskLevel,
        status: a.status,
        reviewedBy: a.reviewedBy ?? null,
        comment: null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        toolName: a.toolName ?? null,
        externalService: a.externalService ?? null,
        expectedResult: a.expectedResult ?? null,
      })),
      costUsd: w.totalCostUsd,
    }));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (error) {
    return NextResponse.json(
      {
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        hasMore: false,
        error: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/workflows — create a new workflow row (PENDING) and hand back the
 * workflow id. The chat cockpit immediately opens an SSE stream to
 * /api/workflows/[id]/stream which runs the REAL SwarmRunner engine against
 * the live LLM + Aurora. This route stays fast (no engine work) so the cockpit
 * can start streaming live agent activity without waiting for a long POST.
 *
 * Demo workspace: tenantId/userId are the preconfigured demo workspace
 * (preconfigured demo workspace for instant judge access — no auth).
 */
export async function POST(request: Request) {
  try {
    await ensureDemoWorkspace();

    let body: { goal?: unknown; industry?: unknown; roleModes?: unknown; conversationId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json', message: 'Request body must be JSON.' }, { status: 400 });
    }

    const goalRaw = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!goalRaw) {
      return NextResponse.json({ error: 'invalid_goal', message: 'A non-empty goal is required.' }, { status: 400 });
    }
    if (goalRaw.length > 2000) {
      return NextResponse.json({ error: 'invalid_goal', message: 'Goal must be 2000 characters or fewer.' }, { status: 400 });
    }

    const industry =
      typeof body.industry === 'string' && body.industry.trim().length > 0
        ? body.industry.trim()
        : 'TECHNOLOGY';

    const roleModes =
      Array.isArray(body.roleModes)
        ? body.roleModes.filter((r): r is string => typeof r === 'string').slice(0, 10)
        : undefined;

    const llm = pickLlm();
    const workflowId = generateId('wf_');
    const tenantId = H0_DEMO_TENANT_ID;
    const userId = H0_DEMO_USER_ID;
    const now = new Date();

    await prisma.workflow.create({
      data: {
        id: workflowId,
        tenantId,
        userId,
        goal: goalRaw,
        industry,
        status: WorkflowStatus.PENDING,
        startedAt: now,
        totalCostUsd: 0,
      },
    });

    const isoNow = now.toISOString();

    // WorkflowCreatedResponse shape — the cockpit reads `workflowId`/`id`
    // via getWorkflowIdFromCreateResponse and then uses `workflow.id` for the
    // SSE/poll URLs. kind !== 'followup_executed' so it is treated as a fresh run.
    return NextResponse.json({
      kind: 'workflow_created',
      workflowId,
      id: workflowId,
      tenantId,
      createdBy: userId,
      goal: goalRaw,
      industry,
      status: WorkflowStatus.PENDING,
      result: null,
      finalOutput: null,
      error: null,
      startedAt: isoNow,
      completedAt: null,
      createdAt: isoNow,
      updatedAt: isoNow,
      traceCount: 0,
      approvals: [],
      taskType: 'AGENT_RUN',
      model: llm ? (llm.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash') : 'unknown',
      ...(roleModes && roleModes.length > 0 ? { roleModes } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'workflow_create_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}