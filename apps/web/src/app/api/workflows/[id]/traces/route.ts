import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';
import { groupTracesByTraceId } from '@/lib/trace-mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workflows/[id]/traces — all real agent traces for a workflow, grouped
 * by traceId into `Trace` objects (each with its steps). Backs
 * `workflowApi.traces(id)`. Returns a raw `Trace[]` (no envelope — apiDataFetch
 * unwraps envelopes but passes non-envelope payloads through). Demo workspace.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const rows = await prisma.agentTrace.findMany({
      where: { workflowId: id, tenantId: H0_DEMO_TENANT_ID },
      orderBy: [{ startedAt: 'asc' }, { stepIndex: 'asc' }],
    });

    return NextResponse.json(groupTracesByTraceId(rows as Parameters<typeof groupTracesByTraceId>[0]));
  } catch (error) {
    return NextResponse.json(
      { error: 'workflow_traces_failed', message: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}