/**
 * Mappers from Prisma `AgentTrace` rows to the trace shapes the Run Inspector /
 * Trace Viewer UI expects (apps/web/src/types/index.ts: Trace, TraceStep,
 * ToolCall). The persisted rows are the REAL engine traces from Aurora.
 */

interface AgentTraceRow {
  id: string;
  traceId: string;
  runId: string;
  workflowId: string;
  tenantId: string;
  agentRole: string;
  stepIndex: number;
  inputJson: unknown;
  outputJson: unknown;
  toolCallsJson: unknown;
  handoffsJson: unknown;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  tokenUsage: unknown;
  error: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapToolCalls(rawCalls: unknown): Array<{
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}> {
  const calls = Array.isArray(rawCalls) ? rawCalls : [];
  return calls.map((c, i) => {
    const rec = asRecord(c) ?? {};
    const input = asRecord(rec['input']) ?? {};
    const output = asRecord(rec['output']);
    return {
      id: typeof rec['id'] === 'string' ? rec['id'] : `call_${i}`,
      toolName: typeof rec['toolName'] === 'string' ? rec['toolName'] : typeof rec['name'] === 'string' ? rec['name'] : 'tool',
      input,
      ...(output ? { output } : {}),
      ...(typeof rec['error'] === 'string' ? { error: rec['error'] } : {}),
      startedAt:
        typeof rec['startedAt'] === 'string'
          ? rec['startedAt']
          : rec['startTime'] != null
            ? String(rec['startTime'])
            : new Date(0).toISOString(),
      ...(rec['completedAt'] != null ? { completedAt: String(rec['completedAt']) } : {}),
      ...(num(rec['durationMs']) != null ? { durationMs: num(rec['durationMs']) } : {}),
    };
  });
}

/** Map a single AgentTrace row to a TraceStep. */
export function agentTraceToStep(row: AgentTraceRow): {
  id: string;
  traceId: string;
  stepNumber: number;
  agentRole: string;
  action: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCalls?: unknown[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: number;
  costUsd?: number;
  error?: string;
} {
  const toolCallsJson = asRecord(row.toolCallsJson);
  const calls = toolCallsJson ? toolCallsJson['calls'] : row.toolCallsJson;
  const tokenUsage = asRecord(row.tokenUsage);
  const input = asRecord(row.inputJson) ?? undefined;
  const output = asRecord(row.outputJson) ?? undefined;
  return {
    id: row.id,
    traceId: row.traceId,
    stepNumber: row.stepIndex,
    agentRole: row.agentRole,
    action: row.agentRole,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(Array.isArray(calls) && calls.length > 0 ? { toolCalls: mapToolCalls(calls) } : {}),
    startedAt: row.startedAt.toISOString(),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(num(row.durationMs) != null ? { durationMs: num(row.durationMs) } : {}),
    ...(tokenUsage && num(tokenUsage['totalTokens']) != null
      ? { tokenUsage: num(tokenUsage['totalTokens']) }
      : tokenUsage && num(tokenUsage['total']) != null
        ? { tokenUsage: num(tokenUsage['total']) }
        : {}),
    ...(tokenUsage && num(tokenUsage['costUsd']) != null ? { costUsd: num(tokenUsage['costUsd']) } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

export interface TraceShape {
  id: string;
  workflowId: string;
  tenantId: string;
  steps: ReturnType<typeof agentTraceToStep>[];
  totalDurationMs?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  createdAt: string;
}

/** Group AgentTrace rows by traceId and map each group to a Trace. */
export function groupTracesByTraceId(rows: AgentTraceRow[]): TraceShape[] {
  const byTrace = new Map<string, AgentTraceRow[]>();
  for (const row of rows) {
    const list = byTrace.get(row.traceId) ?? [];
    list.push(row);
    byTrace.set(row.traceId, list);
  }
  const traces: TraceShape[] = [];
  for (const [traceId, group] of byTrace) {
    const sorted = [...group].sort((a, b) => a.stepIndex - b.stepIndex);
    const steps = sorted.map(agentTraceToStep);
    const totalDurationMs = steps.reduce(
      (sum, s) => (typeof s.durationMs === 'number' ? sum + s.durationMs : sum),
      0,
    );
    const totalTokens = steps.reduce(
      (sum, s) => (typeof s.tokenUsage === 'number' ? sum + s.tokenUsage : sum),
      0,
    );
    const totalCostUsd = steps.reduce(
      (sum, s) => (typeof s.costUsd === 'number' ? sum + s.costUsd : sum),
      0,
    );
    traces.push({
      id: traceId,
      workflowId: sorted[0].workflowId,
      tenantId: sorted[0].tenantId,
      steps,
      ...(totalDurationMs > 0 ? { totalDurationMs } : {}),
      ...(totalTokens > 0 ? { totalTokens } : {}),
      ...(totalCostUsd > 0 ? { totalCostUsd } : {}),
      createdAt: sorted[0].startedAt.toISOString(),
    });
  }
  // Newest first.
  return traces.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Map a row to the lightweight TraceListItem the trace list shows. */
export function agentTraceToListItem(row: AgentTraceRow): {
  id: string;
  workflowId: string;
  agentRole?: string;
  startedAt?: string;
  createdAt?: string;
  durationMs?: number;
  error?: string | null;
} {
  return {
    id: row.traceId,
    workflowId: row.workflowId,
    agentRole: row.agentRole,
    startedAt: row.startedAt.toISOString(),
    createdAt: row.startedAt.toISOString(),
    ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
    ...(row.error != null ? { error: row.error } : {}),
  };
}

/**
 * Map a row to the `AgentTraceRecord` shape embedded in `Workflow.traces`
 * (apps/web/src/types/index.ts). The /swarm Runs Inspector renders a per-trace
 * timeline reading startedAt/completedAt/agentRole/id from each record.
 */
export function agentTraceToRecord(row: AgentTraceRow): {
  id: string;
  workflowId: string;
  tenantId: string;
  agentRole: string;
  status: string;
  steps: unknown[];
  output?: string;
  error?: string;
  durationMs?: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
} {
  const outputRec = asRecord(row.outputJson);
  let outputStr: string | undefined;
  if (typeof row.outputJson === 'string') {
    outputStr = row.outputJson;
  } else if (outputRec && typeof outputRec['text'] === 'string') {
    outputStr = outputRec['text'];
  } else if (outputRec && typeof outputRec['summary'] === 'string') {
    outputStr = outputRec['summary'];
  }
  return {
    id: row.id,
    workflowId: row.workflowId,
    tenantId: row.tenantId,
    agentRole: row.agentRole,
    status: row.error ? 'FAILED' : row.completedAt ? 'COMPLETED' : 'RUNNING',
    steps: [],
    ...(outputStr ? { output: outputStr } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.startedAt.toISOString(),
  };
}