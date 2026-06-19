import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/audit
 * Audit replay records — tamper-evident evidence pulled from Aurora audit_logs.
 * Optionally scoped to a single workflow via ?workflowId=.
 */
export async function GET(request: Request) {
  try {
    const tenantId = H0_DEMO_TENANT_ID;
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');

    const where = workflowId
      ? { tenantId, resource: `workflow:${workflowId}` }
      : { tenantId };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const data = logs.map((l) => ({
      id: l.id,
      action: l.action,
      resource: l.resource,
      resourceId: l.resourceId ?? null,
      severity: l.severity,
      timestamp: l.createdAt.toISOString(),
      details: l.details,
    }));

    return NextResponse.json({ audit: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'audit_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}