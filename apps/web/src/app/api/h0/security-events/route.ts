import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/security-events
 * JackOps Shield-style security/governance decisions. Stored as audit_logs
 * rows with action starting with 'SECURITY' (plus WARN/CRITICAL severity
 * events), so no dedicated security table is required. Pulled from Aurora.
 */
export async function GET() {
  try {
    const tenantId = H0_DEMO_TENANT_ID;

    const events = await prisma.auditLog.findMany({
      where: {
        tenantId,
        OR: [
          { action: { startsWith: 'SECURITY' } },
          { severity: { in: ['WARN', 'CRITICAL'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const data = events.map((e) => {
      const details = (e.details ?? {}) as Record<string, unknown>;
      const eventLabel =
        (details['event'] as string | undefined) ?? e.action;
      return {
        id: e.id,
        event: eventLabel,
        severity: e.severity,
        resource: e.resource,
        timestamp: e.createdAt.toISOString(),
        demoSafe: (details['demoSafe'] as boolean | undefined) ?? false,
        blockedAction: (details['blockedAction'] as string | undefined) ?? null,
        result: (details['result'] as string | undefined) ?? null,
        approvalId: (details['approvalId'] as string | undefined) ?? null,
        details,
      };
    });

    return NextResponse.json({ securityEvents: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'security_events_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}