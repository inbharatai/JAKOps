import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/h0/approvals
 * Approval queue for the demo tenant — pulled from Aurora approval_requests.
 */
export async function GET() {
  try {
    const tenantId = H0_DEMO_TENANT_ID;
    const approvals = await prisma.approvalRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const data = approvals.map((a) => ({
      id: a.id,
      workflowId: a.workflowId,
      taskAction: a.action,
      agentRole: a.agentRole,
      rationale: a.rationale,
      riskLevel: a.riskLevel,
      status: a.status,
      toolName: a.toolName ?? null,
      externalService: a.externalService ?? null,
      expectedResult: a.expectedResult ?? null,
      proposedData: a.proposedDataJson,
      createdAt: a.createdAt.toISOString(),
      reviewedAt: a.reviewedAt?.toISOString() ?? null,
    }));

    return NextResponse.json({ approvals: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'approvals_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}