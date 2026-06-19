# JackOps — Devpost Submission

**Track:** Monetizable B2B App
**Hackathon:** H0: Hack the Zero Stack with Vercel v0 and AWS Databases
**Frontend / runtime:** Vercel (Next.js)
**Database:** Amazon Aurora PostgreSQL

## About the project

JackOps is an AI operations command center for startups and SMEs. It lets a
company run, monitor, approve, secure, audit, and replay AI-agent workflows
from one dashboard — so AI work is observable, governed, and provable instead
of a black box.

## Inspiration

Teams are putting AI agents on real work, but the tooling to *operate* those
agents has not caught up. Approvals happen in chat threads, costs pile up
untracked, and nobody can prove what an agent did or why. We wanted the
"control plane" that every ops team already has for servers and CI — but for
AI agents.

## What it does

- **Run** an agent workflow from one dashboard ("Run Demo Workflow" writes a
  full run into the database).
- **Monitor** live status, cost, and per-step agent traces.
- **Approve** high-risk actions through an approval queue (external email,
  destructive connector calls).
- **Secure** workflows with a Shield layer that classifies risk and blocks
  auto-execution of external/destructive actions.
- **Audit** every decision with a tamper-evident replay log.
- **Replay** any workflow end-to-end from the database.

## How we built it

- **Frontend:** Next.js on Vercel. A judge-facing `/h0` dashboard with no
  signup — a preconfigured demo workspace for instant judge access.
- **API:** Vercel API routes (`/api/h0/*`) talk to the database directly via
  Prisma. No external backend, no Cloud Run, no Railway.
- **Database:** Amazon Aurora PostgreSQL. The H0 slice reuses the existing
  Prisma schema (workflows, agent_traces, approval_requests, approval_audit_logs,
  audit_logs, tenant_memory) — no new tables.
- **AI:** Optional OpenAI/Gemini call from a Vercel server route for one short
  business output. Missing keys fall back to deterministic demo output.
- **Demo safety:** risky actions are blocked from auto-execution and routed to
  human approval; no real emails/Slack/GitHub/CRM writes ever happen.

## AWS database used

Amazon Aurora PostgreSQL (compatible PostgreSQL, serverless-ready). Connection
via `DATABASE_URL` (pooled/proxy) and `DIRECT_URL` (direct), with `sslmode=require`.

## Why Aurora PostgreSQL

- PostgreSQL compatibility means our existing Prisma schema runs unchanged.
- Aurora's managed, highly-available storage is the right home for durable
  audit logs and workflow evidence that must survive restarts.
- Connection pooling keeps Vercel serverless reads/writes efficient.
- It is a serious, production-grade database — appropriate for a B2B ops tool
  whose entire value proposition is "the evidence is in the database."

## Security/governance layer

The Shield layer classifies every action's risk and blocks auto-execution of
external/destructive/sensitive actions, converting them to an approval request
and a `SECURITY_DECISION` audit event. The dashboard surfaces:
- External customer email blocked pending approval
- Prompt-injection risk checked
- Destructive connector action converted to approval request
- High-risk workflow routed to human review
- Demo mode prevented external write action

## Challenges

- Reusing an existing Prisma schema without creating new tables, while still
  expressing cost/security demo data — solved by storing structured JSON in
  existing `planJson`/`stateJson`/`tokenUsage`/`details`/`value` fields.
- Keeping the Vercel serverless build light — solved with a thin `@prisma/client`
  singleton instead of importing the heavy monorepo db package.
- Making the demo instant for judges — solved with a preconfigured demo
  workspace (no auth) that still writes real records to Aurora.

## What we learned

- A serious B2B tool can be demoed convincingly without a backend service —
  Vercel API routes + Aurora are enough for the whole read/write loop.
- "Audit-grade" is mostly a data-modeling problem: if every decision is an
  append-only row, replay comes for free.

## What's next

- Real per-tenant auth and RBAC (the demo intentionally skips this).
- Live agent execution wired to the approval gate (currently demo-safe simulated).
- Cost alerts and budget caps per workflow.
- Exportable, signed evidence packs for compliance.

## Built with

Next.js, Vercel, Prisma, Amazon Aurora PostgreSQL, TypeScript, Tailwind CSS,
React. Optional: OpenAI / Google Gemini.

## Links

- Live demo: _<https://your-vercel-url.vercel.app/h0>_
- Repo: _<your GitHub repo URL>_
- Architecture: `docs/H0_ARCHITECTURE.md`
- Aurora setup: `docs/H0_AURORA_SETUP.md`
- Demo script: `docs/H0_DEMO_SCRIPT.md`