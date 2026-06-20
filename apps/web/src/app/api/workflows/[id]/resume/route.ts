import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { H0_DEMO_TENANT_ID } from '@/lib/h0-demo';
import { applyApprovalDecision } from '@/lib/swarm-persist';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workflows/[id]/resume — fallback approval-decision endpoint the
 * cockpit calls (workflowApi.resume) when a `paused` SSE event did NOT carry
 * an approvalId. Looks up the workflow's PENDING approval and applies the
 * decision via the same `applyApprovalDecision` path as
 * /api/approvals/[id]/decide, so both entry points share the audit trail.
 *
 * Body: `{ decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment? }`.
 * Demo workspace — no auth.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    let body: { decision?: unknown; comment?: unknown };
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const decision = typeof body.decision === 'string' ? body.decision.toUpperCase() : '';
    if (decision !== 'APPROVED' && decision !== 'REJECTED' && decision !== 'DEFERRED') {
      return NextResponse.json(
        { error: 'invalid_decision', message: "decision must be 'APPROVED', 'REJECTED', or 'DEFERRED'." },
        { status: 400 },
      );
    }

    const comment =
      typeof body.comment === 'string' && body.comment.trim().length > 0 ? body.comment.trim() : null;

    const workflow = await prisma.workflow.findFirst({ where: { id, tenantId: H0_DEMO_TENANT_ID } });
    if (!workflow) {
      return NextResponse.json({ error: 'not_found', message: 'Workflow not found.' }, { status: 404 });
    }

    const pendingApproval = await prisma.approvalRequest.findFirst({
      where: { workflowId: id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pendingApproval) {
      return NextResponse.json(
        { error: 'no_pending_approval', message: 'This workflow has no pending approval to decide on.' },
        { status: 409 },
      );
    }

    const updated = await applyApprovalDecision(pendingApproval.id, decision, comment);
    return NextResponse.json(updated ?? { ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'resume_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}