# JackOps — H0 Demo Script (under 3 minutes)

A repeatable script for the H0 demo video. Total target: ~2:30. Proves every
claim the judges care about.

## Setup before recording

- Aurora migrated + seeded (`pnpm h0:seed && pnpm h0:check`).
- Vercel deployed with `H0_DEMO_MODE=true` + Aurora `DATABASE_URL`/`DIRECT_URL`.
- Have the AWS RDS console open in a tab for the Aurora screenshot.

## Script

**0:00 — Open the app instantly (no signup).**
> "This is JackOps, deployed on Vercel. The judge opens the URL and lands
> directly on the dashboard — no login, no signup. It's a preconfigured demo
> workspace for instant judge access."
> *Action: open the deployed `/h0` URL. The dashboard loads.*

**0:15 — Data loads from Aurora.**
> "Every metric here is read live from Amazon Aurora PostgreSQL through
> Prisma — workflows, approvals, audit events, security events, and
> estimated AI cost."
> *Action: point to the six metric cards and the architecture strip
> (Vercel Dashboard → Vercel API Routes → Amazon Aurora PostgreSQL →
> AI Workflow Records → Audit Replay).*

**0:35 — Workflow replay shows agent traces.**
> "Click any workflow and you see the full agent timeline — Commander,
> Planner, the Guardrail security layer, the Worker, the Verifier — with
> inputs, outputs, tool calls, token usage, and duration per step. This is
> the replay of an AI-agent run, straight from the database."
> *Action: click a completed workflow; scroll the Agent Timeline panel.*

**1:00 — Approval/security layer routes a risky action to review.**
> "The escalation workflow is paused because the agent tried to send an
> external customer email. JackOps' security layer classified that HIGH
> risk, blocked auto-execution, and routed it to the approval queue instead.
> No real email is sent — it's demo-safe."
> *Action: open the Approval Queue panel; open the Security & Governance
> panel and read out one SECURITY_DECISION event.*

**1:30 — Audit log shows database-backed evidence.**
> "Every decision is an append-only audit row in Aurora — workflow created,
> paused, retried, completed, and every security decision. This is the
> tamper-evident evidence trail."
> *Action: open the Audit Replay panel; scroll a few rows.*

**1:50 — Run Demo Workflow writes new records to Aurora.**
> "Now I'll click Run Demo Workflow. This writes a brand-new workflow,
> agent traces, an approval request, security decisions, and audit logs
> back into Aurora — then the dashboard refreshes."
> *Action: click "▶ Run Demo Workflow"; wait for the success message;
> show the new workflow at the top of the table and the new approval +
> audit + security rows.*

**2:25 — AWS Aurora screenshot confirms database usage.**
> "And here's the same data in the AWS Aurora PostgreSQL console — proving
> the records live in the AWS database, not an in-memory demo."
> *Action: switch to the RDS console / query the `workflows` and
> `audit_logs` tables to show the rows created this session.*

**2:40 — Wrap.**
> "JackOps: run, monitor, approve, secure, audit, and replay AI-agent
> workflows — built on Vercel and Amazon Aurora PostgreSQL."

## Devpost screenshot checklist

- [ ] `/h0` dashboard header with H0 / Vercel / Aurora badges
- [ ] Architecture strip
- [ ] Metrics cards (loaded from Aurora)
- [ ] Workflow table
- [ ] Agent timeline with token usage
- [ ] Approval queue (HIGH-risk external email)
- [ ] Security & Governance panel
- [ ] Audit replay
- [ ] Cost / usage ledger
- [ ] "Run Demo Workflow" success message + refreshed table
- [ ] AWS RDS console showing the rows in Aurora PostgreSQL