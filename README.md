<div align="center">

# 🛡️ JackOps

### AI Operations Command Center for Secure, Auditable Agent Workflows

**Track:** Monetizable B2B App · **Hackathon:** H0 — Hack the Zero Stack with Vercel v0 and AWS Databases
**Frontend:** Vercel (Next.js) · **Database:** Amazon Aurora PostgreSQL · **Engine:** real SwarmRunner (LangGraph) running serverless on Vercel, calling live OpenAI/Gemini

[![H0](https://img.shields.io/badge/H0-Vercel_+_Amazon_Aurora_PostgreSQL-000?style=for-the-badge&logo=vercel&logoColor=white)](#-architecture)
[![Stack](https://img.shields.io/badge/Stack-Next.js_16_·_Prisma_·_pnpm-0ea5e9?style=for-the-badge&logo=next.js&logoColor=white)](#-tech-stack)
[![Demo](https://img.shields.io/badge/Demo-No_Signup_·_Instant_Access-22c55e?style=for-the-badge)](#-preconfigured-demo-workspace--no-auth)
[![Repo](https://img.shields.io/badge/Repo-inbharatai/JAKOps-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/inbharatai/JAKOps)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

</div>

---

## What JackOps is

JackOps is an **AI operations command center** that turns a plain-English business goal into a multi-step agent workflow that executes on a real LangGraph engine — with a **JAK Shield** human-in-the-loop approval gate that holds any high-risk external action (sending an email, writing to an external system) for human review *before* it is authorized, and an **append-only audit trail** that records every agent step, tool call, cost, and security decision.

It is deployed live on **Vercel** (Next.js) with **Amazon Aurora PostgreSQL** as the system of record. There is no login: a judge clicks **Try Demo** and lands directly in the real chat cockpit, which drives the real agent engine against the live database.

> This is the H0 hackathon build. It is a real, working product, not a click-through mock: the planner, workers, guardrail, and verifier are the genuine SwarmRunner graph; traces, approvals, and audit are persisted to Aurora; LLM spend is real. The one honest caveat is documented in [Scope & honesty](#-scope--honesty): server-only side effects (actually transmitting an email) cannot run inside a Vercel serverless function, so the *authorized decision* is recorded rather than the *transmission*. The gating, the review, and the audit are real.

### Why it exists

Autonomous agents that take real-world actions are dangerous without a chokepoint. JackOps' contribution is the **JAK Shield**: the engine does not just *plan* an external send — it **classifies the risk**, **pauses the workflow**, surfaces a structured approval card, and only proceeds when a human explicitly authorizes. Every step of that decision is written to an immutable audit log tied to the workflow, tenant, and reviewer. That is the difference between "an agent that can email your customers" and "an agent whose email your reviewer approved and the system can prove it."

---

## The live flow (what a judge sees)

1. **Try Demo** (top-right) → lands in `/workspace`, the real chat cockpit. No login, no signup.
2. Type a goal (e.g. *"A customer escalated a billing dispute — draft a reply and send it to them."*) and submit.
3. `POST /api/workflows` creates a `Workflow` row in Aurora with status `PENDING`.
4. The cockpit opens a Server-Sent Events connection to `GET /api/workflows/[id]/stream`, which runs the **real SwarmRunner** and streams live activity:
   `connected → plan_created → worker_started / worker_completed → tool_called / tool_completed → cost_updated → paused | completed | failed`
5. The **Planner** emits a real plan (e.g. *Draft a reply* — MEDIUM risk; *Send the email* — HIGH risk, `requiresApproval`).
6. Each task runs the **Commander → Router → Guardrail → Worker → Verifier** loop. The **Guardrail** is a real heuristic agent that detects PII / prompt-injection / forbidden tool combinations; for the HIGH-risk send it routes to the **Approval** node instead of executing.
7. The workflow reaches `AWAITING_APPROVAL` and the cockpit shows the **JAK Shield approval card** with the action, risk level, tool, external service, and expected result — plus a real `approvalId`.
8. The reviewer clicks **Approve** → `POST /api/approvals/[id]/decide` → the `ApprovalRequest` is marked `APPROVED` (reviewedBy the demo reviewer), the workflow moves to `COMPLETED`, and the audit trail records `APPROVAL_GRANTED` + `WORKFLOW_COMPLETED`.
   **Reject** → the workflow moves to `CANCELLED` with `APPROVAL_REJECTED` + `WORKFLOW_CANCELLED` in the audit log, and the external send is blocked.
9. The Run Inspector (`/runs`, `/traces`) shows the real agent traces, tool calls, token usage, and cost pulled from Aurora.

Everything in steps 3–8 is real: real LLM calls, real token cost in `totalCostUsd`, real `AgentTrace` rows, a real `ApprovalRequest` row, real `AuditLog` + `ApprovalAuditLog` rows.

---

## Architecture

```
                       Vercel (Next.js 16, App Router, Node runtime)
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  /                      Marketing landing — "Try Demo" → /workspace        │
  │  /workspace             Chat cockpit (ChatWorkspace + AppLayout)          │
  │  /runs  /traces         Run Inspector (reads Aurora)                      │
  │                                                                           │
  │  Same-origin Next.js Route Handlers (no separate API server):             │
  │   POST /api/workflows                  create Workflow (PENDING)           │
  │   GET  /api/workflows/[id]             workflow + planJson + traces       │
  │   GET  /api/workflows/[id]/stream      SSE bridge → runs real SwarmRunner │
  │   POST /api/approvals/[id]/decide      JAK Shield approve / reject        │
  │   GET  /api/traces  /api/workflows/[id]/traces   trace inspector          │
  └─────────────────────────────────────────────────────────────────────────┘
                    │  SSE: plan_created, worker_*, tool_*, cost_updated, paused
                    ▼
        packages/swarm  —  real SwarmRunner (LangGraph StateGraph)
        commander → planner → router → guardrail → (approval | worker) → verifier → END
        • live LLM via OPENAI_API_KEY / GEMINI_API_KEY
        • JAK Shield: high-risk external actions → ApprovalRequest (paused)
        • in-memory checkpointer (serverless); persistent-checkpointer path wired
                    │  persist genuine traces / approvals / audit
                    ▼
        Amazon Aurora PostgreSQL (Prisma 6)
        Workflow · AgentTrace · ApprovalRequest · ApprovalAuditLog
        AuditLog · Tenant · User · TenantMemory · WorkflowCheckpoint
```

Key design points (all true of the deployed build):

- **No separate API server.** The original jak-swarm ran a Fastify `apps/api` process; JackOps collapses the cockpit and the engine into one Vercel app. The chat cockpit calls same-origin Next.js Route Handlers, and the stream route runs `SwarmRunner.run()` directly inside the Vercel function.
- **Real engine, serverless.** `SwarmRunner` is the genuine LangGraph orchestrator (`packages/swarm`). It runs to completion (or to the approval pause) within a single `maxDuration = 120` serverless invocation, streaming activity over SSE as it goes. An in-memory checkpointer is used on Vercel because there is no long-lived process to resume from; the `hasPersistentCheckpointer` flag is wired so the original `apps/api` true-resume path (which passes a real Prisma checkpointer and calls LangGraph `interrupt()`) still works unchanged.
- **JAK Shield is the approval gate, not a mock.** The Guardrail agent classifies risk; HIGH-risk external sends produce a real `ApprovalRequest`; the workflow lands in `AWAITING_APPROVAL`; a human decision at `/api/approvals/[id]/decide` transitions the workflow and writes the audit trail.
- **Aurora is the system of record.** Every workflow, trace, approval, and audit event is persisted to Aurora via Prisma and survives across requests and reconnects. Reopening a finished workflow replays its terminal state from the database rather than re-running the engine.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16.2.6 (App Router, Turbopack), React, TypeScript |
| Monorepo | pnpm workspace + Turborepo (`apps/web`, `packages/*`) |
| Engine | `packages/swarm` — real LangGraph `StateGraph` (commander, planner, router, guardrail, approval, worker, verifier) |
| Agents | `packages/agents` — Guardrail, Planner, Router, Worker, Verifier, Approval agents |
| Shared types & tools | `packages/shared`, `packages/tools` |
| Database | Amazon Aurora PostgreSQL (`jackops-aurora.cluster-cshcoyu0kp38.us-east-1.rds.amazonaws.com:5432`, DB `jackops`) |
| ORM | Prisma 6.19.3 (`@prisma/client` singleton in `apps/web/src/lib/db.ts`) |
| Hosting | Vercel — project `jackops`, production alias `https://jackops.vercel.app`, root directory `apps/web` |
| LLM | OpenAI (default) or Gemini, via Vercel env vars — real calls, real cost |

---

## Preconfigured demo workspace (no auth)

For the hackathon there is **no authentication**. The top-right **Try Demo** button drops a judge straight into the real cockpit. Behind the scenes a single preconfigured workspace is used so every request resolves to a real tenant and user in Aurora (created idempotently on first run by `ensureDemoWorkspace()`):

| Constant | Value |
| --- | --- |
| Tenant ID | `h0-demo-tenant` |
| Tenant slug | `h0-demo` |
| Tenant name | `H0 Demo Company` |
| User ID | `h0-demo-user` |
| User email | `judge@jackops.demo` |
| User role | `TENANT_ADMIN` |
| Approval policy | `requireApprovals = true`, `approvalThreshold = HIGH` |

Auth routes (`/login`, `/register`, `/forgot-password`, `/reset-password`, `/trial`, `/onboarding`, `/auth/*`) redirect to `/workspace` in demo mode, and `/` renders the marketing landing page. `apps/web/src/proxy.ts` enforces this pass-through.

> Demo mode is for judge/instant-access convenience only and must not be enabled in a production deployment. It is controlled by `H0_DEMO_MODE` / `NEXT_PUBLIC_H0_DEMO_MODE`.

---

## Environment variables

Copy `.env.example` to `.env` for local development. **The deployed build requires** the following (set in Vercel Environment Variables, encrypted — never committed to git):

```
# Demo mode (no auth — judge access)
H0_DEMO_MODE=true
NEXT_PUBLIC_H0_DEMO_MODE=true

# Same-origin API for the cockpit
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_APP_NAME="JackOps"
NEXT_PUBLIC_APP_URL="https://jackops.vercel.app"

# Amazon Aurora PostgreSQL (pooled URL in DATABASE_URL, direct in DIRECT_URL)
DATABASE_URL="postgresql://jackops:PASSWORD@jackops-aurora.cluster-cshcoyu0kp38.us-east-1.rds.amazonaws.com:5432/jackops?sslmode=require"
DIRECT_URL ="postgresql://jackops:PASSWORD@jackops-aurora.cluster-cshcoyu0kp38.us-east-1.rds.amazonaws.com:5432/jackops?sslmode=require"

# LLM provider — the real engine requires at least one. OpenAI is preferred.
OPENAI_API_KEY="sk-..."
GEMINI_API_KEY="AIza..."   # optional fallback
```

`pickLlm()` selects OpenAI if `OPENAI_API_KEY` is set, otherwise Gemini. If neither is set the stream route returns `failed` with a clear message — the real engine cannot run without an LLM.

`.env.example` also documents many legacy/optional variables (Redis, voice, Gmail, CalDAV, Temporal, Paddle, Google ADK grounding). **None of those are required for this build** and most have no effect on the deployed cockpit. See [Scope & honesty](#-scope--honesty).

---

## Data model

The engine writes to these Prisma models in Aurora (see `packages/db/prisma/schema.prisma`):

- **Workflow** — `id, tenantId, userId, goal, industry, status, startedAt, completedAt, finalOutput, totalCostUsd, planJson, stateJson, error`. Statuses: `PENDING → RUNNING → AWAITING_APPROVAL → COMPLETED | CANCELLED | FAILED`.
- **AgentTrace** — one row per agent step: `traceId, runId, workflowId, agentRole, stepIndex, startedAt, completedAt, durationMs, inputJson, outputJson, toolCallsJson, handoffsJson, tokenUsage, error`. Roles include `COMMANDER`, `PLANNER`, `GUARDRAIL`, `WORKER`, `VERIFIER`, `APPROVAL`.
- **ApprovalRequest** — `id, workflowId, tenantId, taskId, agentRole, action, rationale, proposedDataJson, riskLevel, status (PENDING/APPROVED/REJECTED), toolName, filesAffected, externalService, expectedResult, reviewedBy, reviewedAt`.
- **ApprovalAuditLog** — append-only per-decision log tied to an approval (`decision`, `autoApproved`, `rationale`).
- **AuditLog** — tenant/workflow lifecycle events: `WORKFLOW_CREATED`, `WORKFLOW_PAUSED`, `WORKFLOW_COMPLETED`, `WORKFLOW_CANCELLED`, `WORKFLOW_FAILED`, `SECURITY_DECISION`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `APPROVAL_DEFERRED`.
- **Tenant / User** — the preconfigured demo workspace.
- **TenantMemory** — keyed tenant store; the cost ledger (`h0_cost_ledger`) records `lastRunCostUsd`, `lastRunId`, `llmProvider`.
- **WorkflowCheckpoint** — LangGraph checkpointer table (used by the original `apps/api` true-resume path; the Vercel build uses an in-memory checkpointer instead).

---

## API surface (deployed)

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/workflows` | Create a `Workflow` (PENDING). Body: `{ goal, industry?, roleModes? }`. |
| GET | `/api/workflows/[id]` | Workflow detail: status, `planJson`, traces, approvals (cockpit polling + plan replay). |
| GET | `/api/workflows/[id]/stream` | **SSE bridge** — runs the real SwarmRunner and streams activity, then persists traces/approvals/audit. `maxDuration = 120`. |
| POST | `/api/workflows/[id]/resume` | Resume a paused workflow (approve/reject). |
| POST | `/api/approvals/[id]/decide` | **JAK Shield decision** — `{ decision: 'APPROVED' | 'REJECTED', reviewedBy, comment? }` → COMPLETED/CANCELLED + audit. |
| GET | `/api/workflows/[id]/traces` | Traces for the Run Inspector. |
| GET | `/api/traces`, `/api/traces/[id]` | Global trace browser. |
| POST | `/api/approvals/[id]/sandbox-test` | Sandbox-test a proposed action. |
| GET/POST | `/api/settings/llm`, `/api/settings/llm/preferred-provider` | LLM provider preference. |

The `Authorization` header is ignored in demo mode — requests resolve to the preconfigured demo workspace.

### SSE event contract

The stream route writes `data: <json>\n\n` lines (and a `: heartbeat\n\n` every 15s). The cockpit discriminates by `type`:

| `type` | Payload (selected) |
| --- | --- |
| `connected` | `{ workflowId, status }` |
| `plan_created` | `{ workflowId, plan }` — the real Planner plan |
| `worker_started` / `worker_completed` | `{ agentRole, taskName, success, durationMs, error? }` |
| `tool_called` / `tool_completed` | `{ toolName, agentRole, inputSummary, outputSummary, success, outcome? }` |
| `cost_updated` | `{ workflowId, costUsd, promptTokens, completionTokens, model, runtime? }` |
| `paused` | `{ workflowId, approvalId, taskName, toolName, externalService, expectedResult, ... }` — JAK Shield gate fired |
| `completed` / `failed` / `cancelled` | `{ workflowId, error?, reason? }` |

Reconnecting to a terminal/paused workflow replays its final event from Aurora instead of re-running the engine (no double-charge, no duplicate traces).

---

## Serverless tool whitelist

The Vercel function cannot run heavy server-only tools (browser automation, file I/O, code execution, Gmail IMAP/SMTP, calendar). `SERVERLESS_ALLOWED_TOOLS` (in `apps/web/src/lib/swarm-persist.ts`) is the safe whitelist the engine is given:

```
draft_email, send_email, summarize_document, classify_text, classify_ticket,
web_search, web_fetch, memory_store, memory_retrieve, generate_report,
lookup_customer, search_knowledge, search_knowledge_base, score_lead,
verify_email_deliverability
```

`send_email` is intentionally included so the real JAK Shield approval gate engages: the engine classifies the external send as HIGH risk and routes it to human approval rather than executing — which is the exact production behavior we want to demonstrate. See [Scope & honesty](#-scope--honesty) for what "execution" means here.

---

## JAK Shield — the human-in-the-loop gate

The Guardrail agent (`packages/agents/src/roles/guardrail.agent.ts`) is a real heuristic agent. For each proposed action it evaluates:

- **PII detection** — flags any email address / phone / sensitive token in the action payload (PII is a *warning*, not an automatic block).
- **Prompt-injection detection** — flags instructions that look like an attempt to override the agent's policy; sets `injectionAttempted` and blocks.
- **Forbidden tool combinations / blocked actions** — blocks exact `send_email` mis-use or forbidden tool mixes; otherwise the action is *safe but requires approval*.

The routing (`packages/swarm/src/graph/edges.ts::afterGuardrail`): if blocked → end (FAILED); if the current task `requiresApproval` (HIGH risk) → `approval` node; otherwise → `worker`. For a legitimate external email, `blocked = false` and `requiresApproval = true`, so it routes to the **approval node**, which creates a real `ApprovalRequest` and pauses the workflow at `AWAITING_APPROVAL`.

On the serverless path the approval node skips LangGraph's `interrupt()` (which cannot persist a resumable pause without a long-lived checkpointer) and instead commits the `AWAITING_APPROVAL` + `pendingApprovals` state directly, ending the graph naturally with a real `approvalId`. The human decision at `/api/approvals/[id]/decide` then transitions the workflow and writes the full audit trail. (The original `apps/api` path, which passes a real Prisma checkpointer, still uses true LangGraph `interrupt()`/resume — both paths are wired through the `hasPersistentCheckpointer` flag.)

---

## Local development

```bash
# 1. Install
pnpm install

# 2. Configure env
cp .env.example .env   # then fill DATABASE_URL, DIRECT_URL, OPENAI_API_KEY, H0_DEMO_MODE, NEXT_PUBLIC_H0_DEMO_MODE, NEXT_PUBLIC_API_URL=/api

# 3. Database (generate client, apply migrations, seed the demo workspace)
pnpm h0:setup          # = db:generate + db:migrate:deploy + h0:seed

# 4. Run the web app
pnpm --filter @jak-swarm/web dev
```

### Useful scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Turborepo build of all packages |
| `pnpm dev` | Run all workspaces in parallel |
| `pnpm typecheck` | `turbo run typecheck` across the workspace |
| `pnpm lint` | `turbo run lint` |
| `pnpm h0:setup` | `db:generate` + `db:migrate:deploy` + `h0:seed` |
| `pnpm h0:seed` | Seed the preconfigured demo workspace into Aurora |
| `pnpm h0:check` | Verify the demo workspace + DB connectivity |
| `pnpm db:migrate:deploy` | Apply Prisma migrations (production/Aurora) |
| `pnpm db:studio` | Prisma Studio against the configured DB |
| `pnpm check:truth` | Docs-vs-code truth check |
| `pnpm audit:tools` | Audit the tool registry |
| `pnpm audit:approval-paths` | Audit every approval-gated tool path |

---

## Deploying to Vercel

The Vercel project is configured with:

- **Root directory:** `apps/web`
- **Install command** (`apps/web/vercel.json`): `pnpm install --frozen-lockfile=false && pnpm --filter @jak-swarm/db db:generate && pnpm turbo run build --filter=@jak-swarm/swarm...` — generates the Prisma client and builds the `@jak-swarm/swarm` dependency chain before the web app builds.
- **Production alias:** `https://jackops.vercel.app`
- **Environment variables:** the [required set above](#environment-variables), set in the Vercel dashboard (encrypted, never in git).

Deploy from the repo root:

```bash
vercel --prod --yes
```

Database migrations are applied with `pnpm db:migrate:deploy` against the Aurora `DATABASE_URL` (the demo workspace is seeded by `pnpm h0:seed`, or auto-created idempotently on first request by `ensureDemoWorkspace()`).

---

## Scope & honesty

This section exists because the H0 build makes one deliberate, clearly-bounded compromise, and it is stated here rather than hidden:

- **What is fully real:** the SwarmRunner LangGraph engine, the Commander/Planner/Router/Guardrail/Worker/Verifier/Approval agents, live LLM calls, real token usage and cost, the JAK Shield risk classification and approval gating, the `ApprovalRequest` lifecycle, and the append-only audit trail — all persisted to Aurora.
- **The one compromise:** `send_email` (and other external side effects) are **server-only tools** that cannot actually transmit from a Vercel serverless function (no Gmail credentials, no long-lived SMTP session). So when a reviewer **Approves** a send, JackOps records the **authorized decision** and marks the workflow `COMPLETED` with an audit entry — it does **not** claim the email was transmitted. The value being demonstrated is the *gating and the audit*, not the *delivery*. This is the same boundary any responsible autonomous-agent product draws before letting an LLM email a customer.
- **No synthetic data.** The cockpit runs the real engine against the real LLM and the real database. There is no canned "demo output" path in the deployed `/api/workflows/[id]/stream` route; if no LLM key is configured it fails honestly rather than faking a result.

The optional true-resume path (passing a real Prisma checkpointer to `SwarmRunner` so `interrupt()`/resume re-enters the graph at the approval node) is wired and available; it is not used on Vercel because resuming would re-execute the send step, which is exactly the action that cannot run serverlessly.

---

## Repository layout

```
apps/
  web/                      Next.js app (the deployed Vercel project)
    src/app/api/            Same-origin Route Handlers (workflows, approvals, traces, settings)
    src/app/(dashboard)/    Cockpit routes (/workspace, /runs, /traces, ...)
    src/components/         ChatWorkspace, AppLayout, marketing landing
    src/lib/                db.ts (Prisma), swarm-persist.ts, h0-demo.ts, auth.ts, proxy.ts
    vercel.json             install/build command
  api/                      Original Fastify backend — read-only reference, NOT deployed on Vercel
packages/
  swarm/                    Real SwarmRunner + LangGraph graph/nodes/edges + runtime
  agents/                   Guardrail, Planner, Router, Worker, Verifier, Approval agents
  tools/                    Tool registry + serverless-safe tools
  shared/                   Shared types, enums, ids
  db/                       Prisma schema + migrations
docs/
  H0_ARCHITECTURE.md        This build's architecture (detailed)
  H0_AURORA_SETUP.md        Aurora provisioning steps
  H0_DEMO_SCRIPT.md         Judge demo script
  H0_DEVPOST_SUBMISSION.md  Devpost submission text + assets
```

> Note: `apps/api` and many files under `docs/` predate the H0 build and describe the original full jak-swarm product (Cloud Run, Railway, Supabase auth, Temporal, voice, WhatsApp, etc.). They are kept as historical reference only. **Nothing in the deployed JackOps build depends on them.** The live product is the Vercel + Aurora cockpit described above.

---

## H0 submission assets

- **Live URL:** https://jackops.vercel.app
- **Vercel Team ID:** `team_MFiAsyuVGhfwkAZGqirV8ZAZ`
- **Database:** Amazon Aurora PostgreSQL — `jackops-aurora.cluster-cshcoyu0kp38.us-east-1.rds.amazonaws.com:5432` (DB `jackops`)
- **Architecture diagram:** `docs/architecture-diagram.mmd` (rendered above in [Architecture](#-architecture))
- **AWS DB screenshot:** see `docs/H0_DEVPOST_SUBMISSION.md`
- **Demo script:** `docs/H0_DEMO_SCRIPT.md`
- **Submission text:** `docs/H0_DEVPOST_SUBMISSION.md`

---

## License

MIT — see [LICENSE](LICENSE).