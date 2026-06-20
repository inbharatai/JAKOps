import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';
import { agentTraceToStep } from '@/lib/trace-mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/traces/[id] — full trace detail (with steps) for the Run Inspector
 * detail panel. `id` is the traceId (what GET /api/traces returns as the list
 * item `id`). Returns a raw `Trace` shape (no envelope — unwrapApiData passes
 * it through). Demo workspace — no auth.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const rows = await prisma.agentTrace.findMany({
      where: { traceId: id, tenantId: H0_DEMO_TENANT_ID },
      orderBy: { stepIndex: 'asc' },
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'not_found', message: 'Trace not found.' }, { status: 404 });
    }

    const sorted = [...rows].sort((a, b) => a.stepIndex - b.stepIndex);
    const steps = sorted.map(agentTraceToStep);
    const totalDurationMs = steps.reduce(
      (sum, s) => (typeof s.durationMs === 'number' ? sum + s.durationMs : sum),
      0,
    );
    const totalTokens = steps.reduce(
      (sum, s) => (typeof s.tokenUsage === 'number' ? sum + s.tokenUsage : sum),
      0,
    );
    const totalCostUsd = steps.reduce(
      (sum, s) => (typeof s.costUsd === 'number' ? sum + s.costUsd : sum),
      0,
    );

    return NextResponse.json({
      id: sorted[0].traceId,
      workflowId: sorted[0].workflowId,
      tenantId: sorted[0].tenantId,
      steps,
      ...(totalDurationMs > 0 ? { totalDurationMs } : {}),
      ...(totalTokens > 0 ? { totalTokens } : {}),
      ...(totalCostUsd > 0 ? { totalCostUsd } : {}),
      createdAt: sorted[0].startedAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'trace_detail_failed', message: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}