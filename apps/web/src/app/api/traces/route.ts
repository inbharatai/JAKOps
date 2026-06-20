import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';
import { agentTraceToListItem } from '@/lib/trace-mappers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/traces — list real agent traces from Aurora for the Run Inspector /
 * Trace Viewer (apps/web/src/app/(dashboard)/traces/page.tsx, via dataFetcher).
 * Supports the filters the page sends: workflowId, agentRole, dateFrom, dateTo,
 * hasErrors, page, limit/pageSize.
 *
 * Returns a raw `PaginatedResult<TraceListItem>` (NO {success,data} envelope):
 * `unwrapApiData` passes non-envelope payloads through unchanged, and the
 * secondary consumer `TerminalLogsModule` reads `data?.data` which safely
 * resolves to `undefined` here (no crash). Demo workspace — no auth.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId') ?? undefined;
    const agentRole = url.searchParams.get('agentRole') ?? undefined;
    const dateFrom = url.searchParams.get('dateFrom') ?? undefined;
    const dateTo = url.searchParams.get('dateTo') ?? undefined;
    const hasErrors = url.searchParams.get('hasErrors') === 'true';
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get('limit') ?? url.searchParams.get('pageSize') ?? '50') || 50),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { tenantId: H0_DEMO_TENANT_ID };
    if (workflowId) where.workflowId = workflowId;
    if (agentRole) where.agentRole = agentRole;
    if (hasErrors) where.error = { not: null };
    if (dateFrom || dateTo) {
      where.startedAt = {};
      if (dateFrom) where.startedAt.gte = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.startedAt.lte = new Date(`${dateTo}T23:59:59Z`);
    }

    const [total, rows] = await Promise.all([
      prisma.agentTrace.count({ where }),
      prisma.agentTrace.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Dedupe by traceId — one row per trace in the persisted set, but guard
    // against any duplicates so the list shows one item per trace.
    const seen = new Set<string>();
    const items = rows
      .filter((r) => (seen.has(r.traceId) ? false : (seen.add(r.traceId), true)))
      .map(agentTraceToListItem);

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
        limit: 50,
        hasMore: false,
        error: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}