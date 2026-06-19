import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/summary
 * Aggregate metrics for the JackOps H0 dashboard, read directly from
 * Amazon Aurora PostgreSQL via Prisma. No external API, no Supabase.
 */
export async function GET() {
  try {
    const tenantId = H0_DEMO_TENANT_ID;

    const [
      totalWorkflows,
      completedWorkflows,
      pendingApprovals,
      auditEvents,
      securityEvents,
      costAgg,
    ] = await Promise.all([
      prisma.workflow.count({ where: { tenantId } }),
      prisma.workflow.count({ where: { tenantId, status: 'COMPLETED' } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.auditLog.count({ where: { tenantId } }),
      prisma.auditLog.count({
        where: {
          tenantId,
          OR: [
            { action: { startsWith: 'SECURITY' } },
            { severity: { in: ['WARN', 'CRITICAL'] } },
          ],
        },
      }),
      prisma.workflow.aggregate({
        where: { tenantId },
        _sum: { totalCostUsd: true },
      }),
    ]);

    const estimatedCostUsd = costAgg._sum.totalCostUsd ?? 0;

    return NextResponse.json({
      tenantId,
      totalWorkflows,
      completedWorkflows,
      pendingApprovals,
      auditEvents,
      securityEvents,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'summary_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}