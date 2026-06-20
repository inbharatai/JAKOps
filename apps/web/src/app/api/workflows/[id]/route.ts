import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';
import { agentTraceToRecord } from '@/lib/trace-mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows/[id] — single workflow in the chat cockpit's `Workflow`
 * shape. The cockpit polls this on SSE-failure fallback and on the terminal
 * `completed`/`failed` events to read `finalOutput`, `status`, and `planJson`
 * (the raw plan with `tasks` — replayed into the live agent graph when SSE
 * missed the plan_created event). Read from Aurora.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tenantId = H0_DEMO_TENANT_ID;

    const workflow = await prisma.workflow.findFirst({
      where: { id, tenantId },
    });
    if (!workflow) {
      return NextResponse.json({ error: 'not_found', message: 'Workflow not found.' }, { status: 404 });
    }

    const traceCount = await prisma.agentTrace.count({ where: { workflowId: id } });
    const traces = await prisma.agentTrace.findMany({
      where: { workflowId: id },
      orderBy: [{ startedAt: 'asc' }, { stepIndex: 'asc' }],
    });
    const approvals = await prisma.approvalRequest.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'asc' },
    });

    const startedAtIso = workflow.startedAt?.toISOString() ?? null;
    const completedAtIso = workflow.completedAt?.toISOString() ?? null;
    const updatedAtIso = workflow.updatedAt.toISOString();

    return NextResponse.json({
      id: workflow.id,
      tenantId: workflow.tenantId,
      createdBy: workflow.userId,
      goal: workflow.goal,
      industry: workflow.industry,
      status: workflow.status,
      result: workflow.finalOutput,
      finalOutput: workflow.finalOutput ?? null,
      error: workflow.error ?? null,
      errorMessage: workflow.error ?? null,
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      createdAt: startedAtIso ?? updatedAtIso,
      updatedAt: updatedAtIso,
      // Raw plan (tasks array) — the cockpit polling replays this into the
      // live agent graph when SSE missed plan_created.
      planJson: workflow.planJson,
      state: workflow.stateJson,
      traces: traces.map((t) => agentTraceToRecord(t as Parameters<typeof agentTraceToRecord>[0])),
      traceCount,
      approvals: approvals.map((a) => ({
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
      tokenUsage: 0,
      costUsd: workflow.totalCostUsd,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'workflow_detail_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}