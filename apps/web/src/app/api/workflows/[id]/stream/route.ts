import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SwarmRunner } from '@jak-swarm/swarm';
import type { SwarmResult } from '@jak-swarm/swarm';
import { H0_DEMO_TENANT_ID, H0_DEMO_USER_ID } from '@/lib/h0-demo';
import {
  ensureDemoWorkspace,
  pickLlm,
  persistSwarmResult,
  SERVERLESS_ALLOWED_TOOLS,
  isTerminalStatus,
} from '@/lib/swarm-persist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The real SwarmRunner loop makes several sequential LLM calls (planner,
// commander, workers, guardrail, verifier) — a 6-task plan easily exceeds
// 55s. Allow up to 120s so multi-task goals and the JAK Shield approval path
// can complete instead of being killed mid-run. (Vercel caps at the plan's
// max — Hobby=60s, Pro=300s — so this is a safe upper bound.)
export const maxDuration = 120;

/**
 * GET /api/workflows/[id]/stream — Server-Sent Events bridge that runs the
 * REAL JackOps SwarmRunner engine against the live LLM + Aurora and streams
 * live agent activity to the chat cockpit:
 *
 *   connected → plan_created → worker_started/completed →
 *   tool_called/completed → cost_updated → paused | completed | failed | cancelled
 *
 * The cockpit's SSE parser (sse-fetch.ts) reads `data: <json>\n\n` lines and
 * discriminates by `ev.type`. This route translates the engine's
 * `onAgentActivity` events into that contract and persists the genuine
 * traces/approvals/audit to Aurora when the run finishes (or pauses).
 *
 * Demo workspace — no auth (preconfigured demo workspace for instant judge
 * access). The Authorization header is ignored.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workflowId } = await params;
  const tenantId = H0_DEMO_TENANT_ID;
  const userId = H0_DEMO_USER_ID;

  const encoder = new TextEncoder();
  let closed = false;

  function send(controller: ReadableStreamDefaultController, data: unknown): void {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      closed = true;
    }
  }

  function heartbeat(controller: ReadableStreamDefaultController): void {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(': heartbeat\n\n'));
    } catch {
      closed = true;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const hb = setInterval(() => heartbeat(controller), 15_000);

      const onAbort = () => {
        clearInterval(hb);
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener('abort', onAbort, { once: true });

      void (async () => {
        try {
          await ensureDemoWorkspace();

          const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId } });
          if (!workflow) {
            send(controller, { type: 'failed', workflowId, error: 'Workflow not found.' });
            return;
          }

          // Reconnect / refresh: if the run already reached a terminal or
          // paused state, replay it from Aurora instead of re-running (which
          // would double-charge and duplicate traces).
          if (isTerminalStatus(workflow.status)) {
            send(controller, {
              type: 'connected',
              workflowId,
              status: workflow.status,
              replay: true,
            });
            await emitTerminalFromDb((d) => send(controller, d), workflowId);
            return;
          }

          send(controller, { type: 'connected', workflowId, status: workflow.status });

          // Mark the row in-progress so polling fallback sees activity.
          await prisma.workflow.update({ where: { id: workflowId }, data: { status: 'RUNNING' } });

          const llm = pickLlm();
          if (!llm) {
            await persistFailed(workflowId, tenantId, userId, 'No LLM API key configured (OPENAI_API_KEY or GEMINI_API_KEY).');
            send(controller, { type: 'failed', workflowId, error: 'No LLM API key configured.' });
            return;
          }

          // Capture the plan from the plan_created activity event so we can
          // persist it for the polling fallback replay.
          let capturedPlan: unknown = null;

          const onAgentActivity = (data: unknown): void => {
            if (!data || typeof data !== 'object') return;
            const ev = data as Record<string, unknown>;
            const evType = ev['type'] as string | undefined;
            switch (evType) {
              case 'plan_created': {
                capturedPlan = ev['plan'] ?? null;
                send(controller, { type: 'plan_created', workflowId, plan: ev['plan'] });
                break;
              }
              case 'worker_started': {
                send(controller, {
                  type: 'worker_started',
                  agentRole: ev['agentRole'],
                  taskName: (ev['taskName'] as string | undefined) ?? (ev['taskId'] as string | undefined) ?? 'task',
                });
                break;
              }
              case 'worker_completed': {
                send(controller, {
                  type: 'worker_completed',
                  agentRole: ev['agentRole'],
                  taskName: (ev['taskName'] as string | undefined) ?? (ev['taskId'] as string | undefined) ?? 'task',
                  success: ev['success'] !== false,
                  ...(typeof ev['durationMs'] === 'number' ? { durationMs: ev['durationMs'] } : {}),
                  ...(typeof ev['error'] === 'string' && ev['error'].length > 0 ? { error: ev['error'] } : {}),
                });
                break;
              }
              case 'tool_called': {
                send(controller, {
                  type: 'tool_called',
                  toolName: ev['toolName'],
                  inputSummary: ev['inputSummary'] ?? '',
                  agentRole: ev['agentRole'],
                });
                break;
              }
              case 'tool_completed': {
                send(controller, {
                  type: 'tool_completed',
                  toolName: ev['toolName'],
                  agentRole: ev['agentRole'],
                  success: ev['success'] !== false,
                  ...(typeof ev['durationMs'] === 'number' ? { durationMs: ev['durationMs'] } : {}),
                  ...(typeof ev['error'] === 'string' && ev['error'].length > 0 ? { error: ev['error'] } : {}),
                  outputSummary: ev['outputSummary'] ?? '',
                  ...(ev['outcome'] != null ? { outcome: ev['outcome'] } : {}),
                });
                break;
              }
              case 'cost_updated': {
                send(controller, {
                  type: 'cost_updated',
                  workflowId,
                  costUsd: ev['costUsd'] ?? 0,
                  promptTokens: ev['promptTokens'] ?? 0,
                  completionTokens: ev['completionTokens'] ?? 0,
                  ...(ev['runtime'] != null ? { runtime: ev['runtime'] } : {}),
                  ...(ev['model'] != null ? { model: ev['model'] } : {}),
                });
                break;
              }
              default:
                // Unhandled activity events (verification_started/completed,
                // agent_assigned, tool_approval_required) are not rendered by the
                // cockpit today — ignore rather than forward raw payloads.
                break;
            }
          };

          const runner = new SwarmRunner({ defaultTimeoutMs: 105_000, maxConcurrentWorkflows: 5 });

          // Nudge the engine to proceed autonomously. The cockpit has no
          // clarification handler, so a clarification result would leave it
          // stuck. The DB `goal` stays the user's text; this suffix only goes
          // to the engine. (Safety net below still handles the rare case.)
          const engineGoal =
            workflow.goal && workflow.goal.length > 0
              ? `${workflow.goal}\n\n(Proceed autonomously with reasonable assumptions; do not ask clarifying questions.)`
              : workflow.goal;

          let result: SwarmResult;
          try {
            result = await runner.run({
              goal: engineGoal,
              tenantId,
              userId,
              workflowId,
              industry: workflow.industry ?? 'TECHNOLOGY',
              allowedToolNames: SERVERLESS_ALLOWED_TOOLS,
              browserAutomationEnabled: false,
              autoApproveEnabled: false,
              approvalThreshold: 'HIGH',
              maxCostUsd: 0.5,
              timeoutMs: 105_000,
              llmProvider: llm.provider,
              llmApiKey: llm.key,
              onAgentActivity,
            });
          } catch (engineErr) {
            const message = engineErr instanceof Error ? engineErr.message : 'Engine error';
            // eslint-disable-next-line no-console
            console.error('[workflow stream] real engine threw:', engineErr);
            await persistFailed(workflowId, tenantId, userId, message);
            send(controller, { type: 'failed', workflowId, error: message });
            return;
          }

          // Safety net: the engine asked for clarification. The cockpit has
          // no clarification flow, so surface the question as the final answer
          // (status COMPLETED) so the user can rephrase in a new turn instead
          // of staring at a stuck "Thinking…" spinner.
          if (result.clarificationNeeded && result.clarificationQuestion) {
            await persistClarification(workflowId, tenantId, userId, result);
            send(controller, { type: 'completed', workflowId });
            return;
          }

          // Persist the genuine run to Aurora. Persists the workflow row
          // (upsert by id), every AgentTrace, any ApprovalRequest rows, and the
          // lifecycle AuditLog + cost ledger. Returns the DB approval rows so
          // the `paused` event can carry a real approvalId.
          const outcome = await persistSwarmResult(result, {
            workflowId,
            tenantId,
            userId,
            goal: workflow.goal,
            industry: workflow.industry ?? 'TECHNOLOGY',
            llmProvider: llm.provider,
            planJson: capturedPlan,
          });

          const ap = result.pendingApprovals[0];

          switch (result.status) {
            case 'COMPLETED':
              send(controller, { type: 'completed', workflowId });
              break;
            case 'AWAITING_APPROVAL':
              send(controller, {
                type: 'paused',
                workflowId,
                ...(outcome.createdApprovals[0]?.id
                  ? {
                      approvalId: outcome.createdApprovals[0].id,
                      approvalRequestId: outcome.createdApprovals[0].id,
                    }
                  : {}),
                reason: ap?.action ?? 'a high-risk action',
                taskName: ap?.action ?? 'a high-risk action',
                ...(ap?.toolName ? { toolName: ap.toolName } : {}),
                ...(ap?.filesAffected && ap.filesAffected.length > 0 ? { filesAffected: ap.filesAffected } : {}),
                ...(ap?.externalService ? { externalService: ap.externalService } : {}),
                ...(ap?.expectedResult ? { expectedResult: ap.expectedResult } : {}),
                ...(ap?.proposedDataHash ? { proposedDataHash: ap.proposedDataHash } : {}),
              });
              break;
            case 'CANCELLED':
            case 'ROLLED_BACK':
              send(controller, { type: 'cancelled', workflowId, reason: result.error ?? 'Workflow cancelled' });
              break;
            case 'FAILED':
              send(controller, { type: 'failed', workflowId, error: result.error ?? 'Workflow failed' });
              break;
            default:
              // RUNNING / timed out without a terminal resolution.
              send(controller, {
                type: 'failed',
                workflowId,
                error: result.error ?? 'Workflow did not complete within the time budget.',
              });
              break;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Stream error';
          // eslint-disable-next-line no-console
          console.error('[workflow stream] error:', error);
          try {
            send(controller as ReadableStreamDefaultController, { type: 'failed', workflowId, error: message });
          } catch { /* controller may be closed */ }
        } finally {
          clearInterval(hb);
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Mark a workflow FAILED in Aurora with an error message. */
async function persistFailed(
  workflowId: string,
  tenantId: string,
  userId: string,
  message: string,
): Promise<void> {
  try {
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: 'FAILED',
        error: message,
        completedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'WORKFLOW_FAILED',
        resource: `workflow:${workflowId}`,
        severity: 'WARN',
        details: { error: message, realEngine: true } as object,
      },
    });
  } catch {
    // non-fatal — the SSE error event was already sent
  }
}

/** Persist a clarification-needed result as a COMPLETED workflow whose
 *  finalOutput is the clarifying question (so the cockpit shows it). */
async function persistClarification(
  workflowId: string,
  tenantId: string,
  userId: string,
  result: SwarmResult,
): Promise<void> {
  const question = result.clarificationQuestion ?? 'Please provide more detail so I can run this workflow.';
  try {
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: 'COMPLETED',
        finalOutput: question,
        completedAt: new Date(),
        totalCostUsd: Math.max(
          0.001,
          result.traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
        ),
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'WORKFLOW_COMPLETED',
        resource: `workflow:${workflowId}`,
        severity: 'INFO',
        details: { clarificationNeeded: true, realEngine: true } as object,
      },
    });
  } catch {
    // non-fatal
  }
}

/** Replay a terminal/paused workflow's final event from Aurora (reconnect). */
async function emitTerminalFromDb(
  send: (data: unknown) => void,
  workflowId: string,
): Promise<void> {
  try {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      send({ type: 'failed', workflowId, error: 'Workflow not found.' });
      return;
    }
    const approvals = await prisma.approvalRequest.findMany({
      where: { workflowId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    switch (workflow.status) {
      case 'COMPLETED':
        send({ type: 'completed', workflowId });
        break;
      case 'AWAITING_APPROVAL': {
        const ap = approvals[0];
        send({
          type: 'paused',
          workflowId,
          ...(ap ? { approvalId: ap.id, approvalRequestId: ap.id } : {}),
          reason: ap?.action ?? 'a high-risk action',
          taskName: ap?.action ?? 'a high-risk action',
          ...(ap?.toolName ? { toolName: ap.toolName } : {}),
          ...(ap?.filesAffected && ap.filesAffected.length > 0 ? { filesAffected: ap.filesAffected } : {}),
          ...(ap?.externalService ? { externalService: ap.externalService } : {}),
          ...(ap?.expectedResult ? { expectedResult: ap.expectedResult } : {}),
        });
        break;
      }
      case 'CANCELLED':
      case 'ROLLED_BACK':
        send({ type: 'cancelled', workflowId, reason: workflow.error ?? 'Workflow cancelled' });
        break;
      case 'FAILED':
        send({ type: 'failed', workflowId, error: workflow.error ?? 'Workflow failed' });
        break;
      default:
        send({ type: 'completed', workflowId });
        break;
    }
  } catch {
    // non-fatal
  }
}