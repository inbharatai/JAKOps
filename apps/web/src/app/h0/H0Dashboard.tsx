'use client';

/**
 * JackOps H0 dashboard — judge-facing command center.
 *
 * H0 demo mode skips authentication for judge/demo access only. Do not enable
 * in production. This surface talks to Vercel API routes that read/write
 * Amazon Aurora PostgreSQL via Prisma. No Supabase, no Cloud Run, no Railway.
 */

import { useCallback, useEffect, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Summary {
  totalWorkflows: number;
  completedWorkflows: number;
  pendingApprovals: number;
  auditEvents: number;
  securityEvents: number;
  estimatedCostUsd: number;
}

interface WorkflowRow {
  id: string;
  goal: string;
  status: string;
  riskLevel: string | null;
  totalCostUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  finalOutputPreview: string | null;
  traceCount: number;
  error: string | null;
}

interface TraceRow {
  id: string;
  stepIndex: number;
  agentRole: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  toolCalls: unknown;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  error: string | null;
}

interface ApprovalRow {
  id: string;
  workflowId: string;
  taskAction: string;
  agentRole: string;
  rationale: string;
  riskLevel: string;
  status: string;
  toolName: string | null;
  externalService: string | null;
  expectedResult: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  resource: string;
  severity: string;
  timestamp: string;
  details: unknown;
}

interface SecurityRow {
  id: string;
  event: string;
  severity: string;
  resource: string;
  timestamp: string;
  demoSafe: boolean;
  blockedAction: string | null;
  result: string | null;
  details: unknown;
}

interface WorkflowDetail {
  workflow: {
    id: string;
    goal: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    totalCostUsd: number;
    finalOutput: string | null;
    plan: unknown;
    state: unknown;
    error: string | null;
  };
  traces: TraceRow[];
  approvals: ApprovalRow[];
  totalTokens: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RISK_STYLES: Record<string, string> = {
  HIGH: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  MEDIUM: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  LOW: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
};

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  PAUSED: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  PENDING: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  FAILED: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  PENDING_APPROVAL: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  RETRIED: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
};

function badgeClass(value: string, map: Record<string, string>): string {
  return map[value] ?? 'text-slate-300 bg-white/5 border-white/10';
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function summarize(obj: unknown, max = 90): string {
  if (obj == null) return '—';
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return String(obj);
  }
}

// ─── Card primitives ─────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function H0Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [s, w, a, au, se] = await Promise.all([
        fetch('/api/h0/summary', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/h0/workflows', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/h0/approvals', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/h0/audit', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/h0/security-events', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setSummary(s);
      setWorkflows(w.workflows ?? []);
      setApprovals(a.approvals ?? []);
      setAudit(au.audit ?? []);
      setSecurityEvents(se.securityEvents ?? []);
      // Auto-select the most recent workflow if nothing selected.
      if (!selectedId && (w.workflows?.length ?? 0) > 0) {
        setSelectedId(w.workflows[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
    }
  }, [selectedId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    fetch(`/api/h0/workflows/${selectedId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const runDemo = useCallback(async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch('/api/h0/workflows/run-demo', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'run failed');
      setRunMsg(
        `✓ Created workflow "${json.created.goal}" (${json.created.status}, risk ${json.created.riskLevel}, ${json.created.traceCount} traces). AI source: ${json.created.aiSource}.`,
      );
      await fetchAll();
      if (json.created?.workflowId) setSelectedId(json.created.workflowId);
    } catch (e) {
      setRunMsg(`✗ ${e instanceof Error ? e.message : 'run failed'}`);
    } finally {
      setRunning(false);
    }
  }, [fetchAll]);

  return (
    <div className="min-h-screen bg-[#09090b] text-slate-100">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                JackOps
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                AI operations command center for secure, auditable agent workflows.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">H0 Demo</Pill>
              <Pill className="border-white/15 bg-white/5 text-slate-300">Vercel</Pill>
              <Pill className="border-sky-500/30 bg-sky-500/10 text-sky-300">Amazon Aurora PostgreSQL</Pill>
              <Pill className="border-amber-500/30 bg-amber-500/10 text-amber-300">Preconfigured Demo Workspace</Pill>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* ── Architecture strip ──────────────────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-medium text-slate-300">
            {['Vercel Dashboard', 'Vercel API Routes', 'Amazon Aurora PostgreSQL', 'AI Workflow Records', 'Audit Replay'].map(
              (step, i, arr) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1">{step}</span>
                  {i < arr.length - 1 && <span className="text-slate-600">→</span>}
                </span>
              ),
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* ── Metrics + Run Demo ──────────────────────────────────────────── */}
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Overview</h2>
            <button
              onClick={runDemo}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-amber-400 px-4 py-2 text-sm font-semibold text-[#09090b] transition hover:opacity-90 disabled:opacity-50"
            >
              {running ? 'Running…' : '▶ Run Demo Workflow'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Workflows" value={summary?.totalWorkflows ?? '—'} />
            <MetricCard label="Completed" value={summary?.completedWorkflows ?? '—'} />
            <MetricCard label="Pending Approvals" value={summary?.pendingApprovals ?? '—'} />
            <MetricCard label="Audit Events" value={summary?.auditEvents ?? '—'} />
            <MetricCard label="Security Events" value={summary?.securityEvents ?? '—'} />
            <MetricCard label="Est. AI Cost" value={summary ? `$${summary.estimatedCostUsd.toFixed(4)}` : '—'} sub="from Aurora" />
          </div>
          {runMsg && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">
              {runMsg}
            </div>
          )}
        </section>

        {/* ── Workflow table ──────────────────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Workflows</h2>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Goal</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Risk</th>
                  <th className="px-3 py-2.5 text-right">Cost</th>
                  <th className="px-3 py-2.5">Started</th>
                  <th className="px-3 py-2.5">Completed</th>
                  <th className="px-3 py-2.5">Traces</th>
                  <th className="px-3 py-2.5">Output</th>
                </tr>
              </thead>
              <tbody>
                {workflows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      No workflows yet. Click <span className="text-emerald-300">Run Demo Workflow</span> to write records into Aurora.
                    </td>
                  </tr>
                )}
                {workflows.map((w) => (
                  <tr
                    key={w.id}
                    onClick={() => setSelectedId(w.id)}
                    className={`cursor-pointer border-t border-white/5 hover:bg-white/[0.03] ${selectedId === w.id ? 'bg-white/[0.05]' : ''}`}
                  >
                    <td className="max-w-xs px-3 py-2.5 truncate text-slate-200" title={w.goal}>{w.goal}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(w.status, STATUS_STYLES)}`}>{w.status}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {w.riskLevel ? (
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(w.riskLevel, RISK_STYLES)}`}>{w.riskLevel}</span>
                      ) : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">${w.totalCostUsd.toFixed(4)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{fmtTime(w.startedAt)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{fmtTime(w.completedAt)}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-slate-300">{w.traceCount}</td>
                    <td className="max-w-[200px] px-3 py-2.5 truncate text-slate-400" title={w.finalOutputPreview ?? ''}>{w.finalOutputPreview ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── Agent timeline ────────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Agent Timeline {detail?.workflow ? `· ${detail.workflow.goal}` : ''}
            </h2>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              {loadingDetail && <div className="py-8 text-center text-sm text-slate-500">Loading traces…</div>}
              {!loadingDetail && !detail && <div className="py-8 text-center text-sm text-slate-500">Select a workflow.</div>}
              {detail && detail.traces.length === 0 && (
                <div className="py-8 text-center text-sm text-slate-500">No agent traces for this workflow.</div>
              )}
              {detail && detail.traces.length > 0 && (
                <ol className="space-y-2">
                  {detail.traces.map((t) => (
                    <li key={t.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-emerald-300">{t.stepIndex}. {t.agentRole}</span>
                        <span className="text-xs text-slate-500">{t.durationMs ? `${t.durationMs}ms` : '—'}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        <span className="text-slate-500">in:</span> {summarize(t.input)}
                      </div>
                      <div className="text-xs text-slate-400">
                        <span className="text-slate-500">out:</span> {summarize(t.output)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>tools: {summarize((t.toolCalls as { calls?: string[] } | null)?.calls ?? t.toolCalls, 60)}</span>
                        <span className="text-slate-600">·</span>
                        <span>tokens: {t.tokenUsage.totalTokens ?? 0}</span>
                      </div>
                      {t.error && <div className="mt-1 text-xs text-rose-300">error: {t.error}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {detail && (
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-slate-400">
                  <span>Total tokens: <span className="tabular-nums text-slate-200">{detail.totalTokens}</span></span>
                  <span>Cost: <span className="tabular-nums text-slate-200">${detail.workflow.totalCostUsd.toFixed(4)}</span></span>
                </div>
              )}
            </div>
          </section>

          {/* ── Approval queue ────────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Approval Queue</h2>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              {approvals.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No approval requests.</div>}
              <div className="space-y-2">
                {approvals.map((a) => (
                  <div key={a.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100">{a.taskAction}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(a.riskLevel, RISK_STYLES)}`}>{a.riskLevel}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(a.status, STATUS_STYLES)}`}>{a.status}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{a.rationale}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {a.toolName && <span>tool: <span className="text-slate-300">{a.toolName}</span></span>}
                      {a.externalService && <span>target: <span className="text-slate-300">{a.externalService}</span></span>}
                      <span>agent: <span className="text-slate-300">{a.agentRole}</span></span>
                    </div>
                    {a.expectedResult && <div className="mt-1 text-[11px] text-slate-500">expected: {a.expectedResult}</div>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Security / governance ─────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Security &amp; Governance</h2>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              {securityEvents.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No security events.</div>}
              <div className="space-y-2">
                {securityEvents.map((e) => (
                  <div key={e.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-100">{e.event}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(e.severity, STATUS_STYLES)}`}>{e.severity}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {e.blockedAction && <span>blocked: <span className="text-rose-300">{e.blockedAction}</span></span>}
                      {e.result && <span>result: <span className="text-emerald-300">{e.result}</span></span>}
                      {e.demoSafe && <span className="text-amber-300">demo-safe</span>}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{fmtDateTime(e.timestamp)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Audit replay ──────────────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Audit Replay</h2>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              {audit.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No audit records.</div>}
              <div className="max-h-96 space-y-1.5 overflow-y-auto">
                {audit.map((l) => (
                  <div key={l.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-sky-300">{l.action}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(l.severity, STATUS_STYLES)}`}>{l.severity}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                      <span>resource: <span className="text-slate-300">{l.resource}</span></span>
                      <span>{fmtDateTime(l.timestamp)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">{summarize(l.details, 120)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ── Cost / usage ledger ─────────────────────────────────────────── */}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Cost / Usage Ledger</h2>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Workflow</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Traces</th>
                  <th className="px-3 py-2.5 text-right">Tokens (selected)</th>
                  <th className="px-3 py-2.5 text-right">Cost USD</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id} className="border-t border-white/5">
                    <td className="max-w-xs truncate px-3 py-2.5 text-slate-300" title={w.goal}>{w.goal}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(w.status, STATUS_STYLES)}`}>{w.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{w.traceCount}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">
                      {detail?.workflow.id === w.id ? detail.totalTokens : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">${w.totalCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
                {workflows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">No cost records.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-10 border-t border-white/10 pt-6 text-xs text-slate-500">
          JackOps · H0: Hack the Zero Stack with Vercel v0 and AWS Databases · Vercel + Amazon Aurora PostgreSQL ·
          preconfigured demo workspace for instant judge access (no signup required).
        </footer>
      </main>
    </div>
  );
}