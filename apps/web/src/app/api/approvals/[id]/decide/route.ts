import { NextResponse } from 'next/server';
import { applyApprovalDecision } from '@/lib/swarm-persist';

export const dynamic = 'force-dynamic';

/**
 * POST /api/approvals/[id]/decide — the JAK Shield approval gate decision.
 * The chat cockpit's InlineApprovalControls calls this (approvalApi.decide)
 * with `{ decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment? }` when the
 * SSE `paused` event carried an approvalId. Applies the decision, updates the
 * parent workflow lifecycle, and writes the full audit trail to Aurora.
 *
 * Demo workspace — no auth (preconfigured demo workspace for instant judge
 * access). The Authorization header is ignored.
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

    const updated = await applyApprovalDecision(id, decision, comment);
    if (!updated) {
      return NextResponse.json(
        { error: 'not_found', message: 'Approval request not found.' },
        { status: 404 },
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'decision_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 },
    );
  }
}