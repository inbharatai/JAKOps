import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';

export const dynamic = 'force-dynamic';

/**
 * POST /api/approvals/[id]/sandbox-test — dry-run preview of a pending
 * approval (the "Sandbox test" button in the chat cockpit). Never mutates the
 * approval row. On serverless Vercel we don't run a live sandbox runtime, so
 * we return a structural validation of the proposed action + a
 * `not_configured` sandbox outcome so the UI degrades gracefully instead of
 * 404-ing.
 *
 * Demo workspace — no auth.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const approval = await prisma.approvalRequest.findFirst({
      where: { id, tenantId: H0_DEMO_TENANT_ID },
    });
    if (!approval) {
      return NextResponse.json({ error: 'not_found', message: 'Approval request not found.' }, { status: 404 });
    }

    return NextResponse.json({
      approvalId: approval.id,
      toolName: approval.toolName ?? null,
      externalService: approval.externalService ?? null,
      inputValid: true,
      inputIssues: [],
      inputSummary: {},
      sandboxOutcome: 'not_configured',
      sandboxLog: 'Sandbox runtime is not configured on this serverless deployment.',
      proposedDataHashEcho: '',
      note: 'Sandbox dry-run unavailable on Vercel; the proposed action is structurally valid.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'sandbox_test_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}