import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/workflows/[id]
 * Single workflow + its agent trace timeline (for the agent timeline panel)
 * and per-step token usage (for the cost/usage ledger). Read from Aurora.
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
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const traces = await prisma.agentTrace.findMany({
      where: { workflowId: id },
      orderBy: { stepIndex: 'asc' },
    });

    const approvals = await prisma.approvalRequest.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: 'asc' },
    });

    const traceData = traces.map((t) => {
      const tokens = (t.tokenUsage ?? {}) as {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      return {
        id: t.id,
        stepIndex: t.stepIndex,
        agentRole: t.agentRole,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        durationMs: t.durationMs ?? null,
        input: t.inputJson,
        output: t.outputJson,
        toolCalls: t.toolCallsJson,
        tokenUsage: tokens,
        error: t.error ?? null,
      };
    });

    const totalTokens = traceData.reduce(
      (sum, t) => sum + (t.tokenUsage.totalTokens ?? 0),
      0,
    );

    return NextResponse.json({
      workflow: {
        id: workflow.id,
        goal: workflow.goal,
        status: workflow.status,
        startedAt: workflow.startedAt?.toISOString() ?? null,
        completedAt: workflow.completedAt?.toISOString() ?? null,
        totalCostUsd: workflow.totalCostUsd,
        finalOutput: workflow.finalOutput ?? null,
        plan: workflow.planJson,
        state: workflow.stateJson,
        error: workflow.error ?? null,
      },
      traces: traceData,
      approvals: approvals.map((a) => ({
        id: a.id,
        action: a.action,
        riskLevel: a.riskLevel,
        status: a.status,
        toolName: a.toolName ?? null,
        externalService: a.externalService ?? null,
        rationale: a.rationale,
        expectedResult: a.expectedResult ?? null,
      })),
      totalTokens,
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