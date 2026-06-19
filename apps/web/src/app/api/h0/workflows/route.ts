import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/workflows
 * List workflows for the demo tenant with trace counts and risk level
 * sourced from the seeded plan/state JSON. Read directly from Aurora.
 */
export async function GET() {
  try {
    const tenantId = H0_DEMO_TENANT_ID;

    const workflows = await prisma.workflow.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    const traceCounts = await prisma.agentTrace.groupBy({
      by: ['workflowId'],
      where: { tenantId, workflowId: { in: workflows.map((w) => w.id) } },
      _count: { _all: true },
    });
    const traceCountMap = new Map(
      traceCounts.map((t) => [t.workflowId, t._count._all]),
    );

    const data = workflows.map((w) => {
      const plan = (w.planJson ?? {}) as Record<string, unknown>;
      const state = (w.stateJson ?? {}) as Record<string, unknown>;
      const riskLevel =
        (plan['riskLevel'] as string | undefined) ??
        (state['riskLevel'] as string | undefined) ??
        null;
      const goal = w.goal ?? '';
      return {
        id: w.id,
        goal,
        status: w.status,
        riskLevel,
        totalCostUsd: w.totalCostUsd,
        startedAt: w.startedAt?.toISOString() ?? null,
        completedAt: w.completedAt?.toISOString() ?? null,
        finalOutputPreview: w.finalOutput ? w.finalOutput.slice(0, 160) : null,
        traceCount: traceCountMap.get(w.id) ?? 0,
        error: w.error ?? null,
      };
    });

    return NextResponse.json({ workflows: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'workflows_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}