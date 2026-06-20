import { WorkflowStatus } from '@jak-swarm/shared';
import { PlannerAgent, AgentContext } from '@jak-swarm/agents';
import type { PlannerOutput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getActivityEmitter } from '../../supervisor/activity-registry.js';

export async function plannerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  if (!state.missionBrief) {
    return {
      error: 'Planner node received no mission brief',
      status: WorkflowStatus.FAILED,
    };
  }

  const agent = new PlannerAgent();

  const context = new AgentContext({
    agentRole: 'PLANNER',
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    idempotencyKey: state.idempotencyKey,
    allowedDomains: state.allowedDomains,
    ...(state.llmProvider ? { llmProvider: state.llmProvider } : {}),
  });

  const result = await agent.execute(state.missionBrief, context) as PlannerOutput;

  // Emit the plan to the live chat cockpit (agent graph + plan render) before
  // routing begins. Side-channel emitter (SwarmState can't carry Functions).
  // Fire-and-forget — telemetry must never break the planner.
  try {
    const emitter = getActivityEmitter(state.workflowId);
    if (emitter && result.plan) {
      emitter({
        type: 'plan_created',
        plan: result.plan,
        planId: `${state.workflowId}-plan`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // non-fatal
  }

  const traces = context.getTraces();

  return {
    plan: result.plan,
    status: WorkflowStatus.ROUTING,
    traces,
  };
}
