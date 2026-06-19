<div align="center">

# 🛡️ JackOps

### AI Operations Command Center for Secure, Auditable Agent Workflows

**Track:** Monetizable B2B App · **Hackathon:** H0 — Hack the Zero Stack with Vercel v0 and AWS Databases
**Frontend:** Vercel (Next.js) · **Database:** Amazon Aurora PostgreSQL · **AI:** optional OpenAI/Gemini through a Vercel server route

[![H0](https://img.shields.io/badge/H0-Vercel_+_Amazon_Aurora_PostgreSQL-000?style=for-the-badge&logo=vercel&logoColor=white)](#jackops--h0-demo)
[![Stack](https://img.shields.io/badge/Stack-Next.js_16_·_Prisma_·_pnpm-0ea5e9?style=for-the-badge&logo=next.js&logoColor=white)](#-tech-stack-h0-demo)
[![Demo](https://img.shields.io/badge/Demo-No_Signup_·_Instant_Access-22c55e?style=for-the-badge)](#-preconfigured-demo-workspace--no-auth-mechanism)
[![CI](https://img.shields.io/badge/CI-7_jobs_green-brightgreen?style=for-the-badge&logo=githubactions&logoColor=white)](#-ci-status)
[![Repo](https://img.shields.io/badge/Repo-inbharatai/JAKOps-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/inbharatai/JAKOps)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

</div>

---

# JackOps — H0 Demo

JackOps is an **AI operations command center for startups and SMEs**. It helps
companies **run, monitor, approve, secure, audit, and replay** AI-agent
workflows from one dashboard — so AI work is **observable, governed, and
provable** instead of a black box.

This is a focused hackathon build of a serious product. The H0 demo slice runs
**entirely on Vercel + Amazon Aurora PostgreSQL**: a Vercel Next.js dashboard
talks to Vercel API routes that read and write **real records** in Amazon Aurora
PostgreSQL through Prisma. There is no mock data and no in-memory store — every
metric, workflow, trace, approval, and audit row on screen is a live row in
Aurora.

### The problem this demo solves

Startups adopt AI agents fast, then lose control: agents send emails, touch
external systems, spend money, and make decisions nobody can see or undo.
JackOps makes every one of those actions **visible, risk-classified, gated by
human approval, and permanently audited** — exactly the governance layer a B2B
buyer needs before they'll let agents near production data.

### H0 demo constraints (by design)

- **No Cloud Run** required for the H0 demo.
- **No Railway** required for the H0 demo.
- **No Supabase** required for the H0 demo (Aurora is the system of record).
- **No signup/login** — a preconfigured demo workspace gives judges instant access.
- **No dependency on the legacy Fastify API** for the H0 slice.

> Public wording: "preconfigured demo workspace for instant judge access."
> Code comments: "H0 demo mode skips authentication for judge/demo access only. Do not enable in production."

## 🏗️ Architecture

### System diagram

```
                          ┌─────────────────────────────────────────────┐
   Judge (no signup)       │              Vercel (Next.js 16)             │
         │                 │                                             │
         ▼                 │  proxy.ts (Edge)   ── demo-mode gate ──┐    │
   GET / ─────────► 307 ──► │  /  /login  /register  …  ──► /h0   │    │
                          │                                     ▼    │
                          │  /h0  (RSC dashboard)  ◄── H0Dashboard.tsx │
                          │     │  (Server Components, cache: no-store)│
                          │     ▼                                    │
                          │  /api/h0/*  (Vercel API routes, Node)     │
                          │     summary · workflows · workflows/[id]  │
                          │     approvals · audit · security-events   │
                          │     workflows/run-demo (POST)             │
                          └────────────────────┬────────────────────────┘
                                               │  Prisma Client (@prisma/client)
                                               │  sslmode=require
                                               ▼
                          ┌─────────────────────────────────────────────┐
                          │        Amazon Aurora PostgreSQL               │
                          │  tenant · user · workflow · agent_trace        │
                          │  approval_request · approval_audit_log        │
                          │  audit_log · tenant_memory                     │
                          └─────────────────────────────────────────────┘
                                               │
                                               ▼
                          Dashboard replay: workflows, traces, approvals,
                          audit + SECURITY_DECISION events, cost ledger
```

### Request flow (what happens on every load)

1. A judge opens the deployed Vercel URL. `proxy.ts` (the active Edge
   middleware in Next 16) sees demo mode and **redirects `/` and every
   auth/sign-in route to `/h0`** — no login screen ever appears.
2. The `/h0` page (a React Server Component) renders `H0Dashboard.tsx`, which on
   first paint fires **five parallel `fetch(..., { cache: 'no-store' })` calls**
   to the Vercel API routes: `summary`, `workflows`, `approvals`, `audit`, and
   `security-events`.
3. Each API route reads from **Amazon Aurora PostgreSQL** via the Prisma
   client, scoped to the preconfigured demo tenant `h0-demo-tenant`.
4. The dashboard renders four panels of live data — metrics, workflow table +
   agent timeline, approval queue, and an audit/security replay — so the judge
   is looking at real database rows, not a static screenshot.
5. The judge clicks **Run Demo Workflow**. The dashboard `POST`s to
   `/api/h0/workflows/run-demo`, which writes a complete workflow (rows across
   six tables) into Aurora and returns an updated summary; the dashboard
   refreshes and the new workflow appears live.

### Components

| Layer | Path | Role |
| --- | --- | --- |
| Edge gate | `apps/web/src/proxy.ts` | Demo-mode redirect: `/` + auth routes → `/h0`; passes `/h0` and `/api/h0/*` through |
| Dashboard | `apps/web/src/app/h0/` (page + `H0Dashboard.tsx`) | RSC dashboard, five parallel reads, Run Demo button, workflow detail drawer |
| API routes | `apps/web/src/app/api/h0/*` | Seven Node-runtime routes reading/writing Aurora via Prisma |
| DB client | `apps/web/src/lib/db.ts` | Thin `@prisma/client` singleton for serverless (one client per warm instance) |
| Demo identity | `apps/web/src/lib/h0-demo.ts` | Stable demo constants + `isH0DemoMode()` / `getH0DemoWorkspace()` helpers |
| Schema | `packages/db/prisma/schema.prisma` | Shared schema — no new tables; demo reuses the production models |
| Seed / check | `scripts/seed-h0-demo.ts`, `scripts/check-h0-demo.ts` | Idempotent seed + verifier |

## 🔐 Preconfigured demo workspace & no-auth mechanism

The demo runs against a **preconfigured demo workspace** so a judge can use the
product instantly:

| Constant | Value | File |
| --- | --- | --- |
| `H0_DEMO_TENANT_ID` | `h0-demo-tenant` | `apps/web/src/lib/h0-demo.ts` |
| `H0_DEMO_USER_ID` | `h0-demo-user` | `apps/web/src/lib/h0-demo.ts` |
| `H0_DEMO_USER_EMAIL` | `judge@jackops.demo` | `apps/web/src/lib/h0-demo.ts` |
| `H0_DEMO_COMPANY_NAME` | `H0 Demo Company` | `apps/web/src/lib/h0-demo.ts` |

**How the no-login redirect works (and an honest caveat).** In Next 16,
`apps/web/src/proxy.ts` *is* the active Edge middleware (the build labels it
`ƒ Proxy (Middleware)`). Demo mode is gated on:

```ts
const demoMode =
  process.env['H0_DEMO_MODE'] === 'true' ||
  process.env['NEXT_PUBLIC_H0_DEMO_MODE'] === 'true' ||
  !supabaseConfigured;   // true in the demo, which uses Aurora — not Supabase
```

When `demoMode` is true, the proxy redirects `/`, `/login`, `/register`,
`/forgot-password`, `/reset-password`, `/trial`, `/onboarding`, and `/auth/*`
to `/h0`, and lets `/h0` and `/api/h0/*` pass straight through.

> **Edge-runtime caveat (verified live on Vercel):** non-`NEXT_PUBLIC_` env vars
> — including `H0_DEMO_MODE` — are **not** visible inside the Edge `proxy.ts`.
> On Vercel the `!supabaseConfigured` branch is what actually engages demo mode,
> because the demo does not configure Supabase. Locally, `H0_DEMO_MODE=true`
> works because the route handlers and RSC run in the Node runtime, where all
> env vars are visible. This is why the demo works end-to-end on Vercel without
> login even though `H0_DEMO_MODE` is invisible to the Edge layer.

This is **not** an authentication bypass. It is a preconfigured demo workspace
for instant judge access; the gate is intentionally off whenever Supabase is
configured for real production use.

## 🔁 The Demo Workflow loop

Clicking **Run Demo Workflow** runs the full JackOps governance loop end-to-end
against Aurora. The route `POST /api/h0/workflows/run-demo` creates a realistic
"Review customer escalation and draft response" workflow and writes rows across
**six tables** in a single transaction-like sequence:

```
COMMANDER  → PLANNER → GUARDRAIL → WORKER_DOCUMENT → APPROVAL GATE → AUDIT
  intake       decompose   classify      draft response    hold + route    log all
  escalation   into steps   risk HIGH     (AI or demo)      external send   decisions
```

| Stage | Agent role written to `agent_trace` | What it does | Token usage recorded |
| --- | --- | --- | --- |
| 0 · Commander | `COMMANDER` | Receives the escalation, outlines the plan | 180 tok |
| 1 · Planner | `PLANNER` | Decomposes the goal into ordered steps (`planner.decompose`) | 290 tok |
| 2 · Guardrail | `GUARDRAIL` | Classifies the external send as **HIGH** risk and blocks auto-execution (`shield.classify`, `shield.promptInjectionCheck`) | 130 tok |
| 3 · Worker | `WORKER_DOCUMENT` | Drafts an empathetic ≤120-word reply via OpenAI/Gemini if a key is set, else deterministic demo text | 450 tok |

**The safety story (this is the whole point of the demo):** the external
customer-email send is classified **HIGH risk**. JackOps does **not** execute
it. Instead it:

1. Creates an `approval_request` (`status: PENDING`, `riskLevel: HIGH`,
   `toolName: send_email`, `externalService: "Customer Email (external)"`).
2. Writes an `approval_audit_log` (`decision: DEFERRED`, `autoApproved: false`).
3. Writes **three `SECURITY_DECISION` audit events**:
   - `WARN` — "External customer email blocked pending approval"
   - `INFO` — "Prompt injection risk checked on customer escalation text → no injection detected"
   - `CRITICAL` — "Destructive connector action converted to approval request"
4. Pauses the workflow (`status: PAUSED`) and records a `WORKFLOW_PAUSED` audit
   log.
5. Writes a cost/token ledger entry to `tenant_memory` (`h0_cost_ledger`).

**No real email is ever sent.** The demo is *demo-safe*: a destructive external
action is converted into an approval request and surfaced in the approval queue
and audit replay — exactly what a B2B buyer needs to trust agents near
production. The `demoSafe: true` flag is returned to the UI and stored in
`workflow.stateJson`.

**Optional live AI.** If `OPENAI_API_KEY` is set, the Worker calls
`gpt-4o-mini` through a Vercel server route; if `GEMINI_API_KEY` is set, it falls
back to `gemini-1.5-flash`. If neither is set or the call fails, it uses a
deterministic, on-brand reply — **so the demo never breaks**. The `aiSource`
(`openai:gpt-4o-mini` / `gemini:1.5-flash` / `deterministic-demo`) is recorded in
`workflow.planJson` and shown in the UI.

## 🗄️ Data model (Prisma → Aurora PostgreSQL)

The demo reuses the existing Prisma schema — **no new tables**. Cost, risk, and
security state live in existing JSON fields (`workflow.planJson`,
`workflow.stateJson`, `agent_trace.token_usage`, `audit_log.details`,
`tenant_memory.value`). The demo reads and writes eight models:

| Model | Key fields used by the demo | Purpose |
| --- | --- | --- |
| `Tenant` | `id`, `slug` (`h0-demo`), `name`, `industry`, `plan`, `requireApprovals`, `approvalThreshold` | The demo company; approvals required, threshold `HIGH` |
| `User` | `id`, `tenantId`, `email` (`judge@jackops.demo`), `role` (`TENANT_ADMIN`) | The demo judge identity |
| `Workflow` | `id`, `tenantId`, `userId`, `goal`, `status` (`PAUSED`), `planJson`, `stateJson`, `finalOutput`, `totalCostUsd`, `startedAt` | One per Run Demo Workflow |
| `AgentTrace` | `traceId`, `runId`, `workflowId`, `agentRole`, `stepIndex`, `inputJson`, `outputJson`, `toolCallsJson`, `tokenUsage`, `durationMs` | The four-stage agent timeline |
| `ApprovalRequest` | `workflowId`, `action`, `rationale`, `riskLevel`, `status`, `toolName`, `externalService`, `proposedDataJson` | The held HIGH-risk external send |
| `ApprovalAuditLog` | `approvalId`, `decision` (`DEFERRED`), `autoApproved`, `rationale` | Why it was routed to review |
| `AuditLog` | `tenantId`, `userId`, `action`, `resource`, `severity`, `details` | Workflow + `SECURITY_DECISION` replay events |
| `TenantMemory` | `tenantId`, `key` (`h0_cost_ledger`), `value`, `memoryType`, `source` | The cost/token ledger |

## 🌐 API routes (`/api/h0/*`)

All routes run in the Node runtime, read/write Aurora via Prisma, and are
scoped to the demo tenant.

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/h0/summary` | Counts: totalWorkflows, completedWorkflows, pendingApprovals, auditEvents, securityEvents, estimatedCostUsd |
| `GET` | `/api/h0/workflows` | Recent workflow rows (goal, status, risk, cost, startedAt) |
| `GET` | `/api/h0/workflows/[id]` | Full workflow detail + its `agent_trace` timeline + linked approvals |
| `GET` | `/api/h0/approvals` | Pending approval queue (HIGH-risk external send) |
| `GET` | `/api/h0/audit` | Recent audit log events (workflow + security replay) |
| `GET` | `/api/h0/security-events` | `SECURITY_DECISION` + WARN/CRITICAL governance events |
| `POST` | `/api/h0/workflows/run-demo` | Creates the full demo workflow across six tables; returns `created` + refreshed `summary` |

## 🖥️ What the judge sees (panel by panel)

The `/h0` dashboard (`H0Dashboard.tsx`) is built from the live Aurora data
above. Top to bottom:

- **Header badges** — `H0 Demo · Vercel · Amazon Aurora PostgreSQL ·
  Preconfigured Demo Workspace`.
- **Architecture strip** — `Vercel Dashboard → Vercel API Routes → Amazon
  Aurora PostgreSQL → AI Workflow Records → Audit Replay` (the request flow,
  visualized).
- **Metrics + Run Demo** — four `MetricCard`s (Workflows, Completed, Pending
  Approvals, Audit Events) and the **▶ Run Demo Workflow** button.
- **Workflow table + agent timeline** — each row expandsable into a drawer
  showing the four `agent_trace` stages with per-stage token usage and tool
  calls.
- **Approval queue** — the HIGH-risk external customer email, held pending
  human approval.
- **Security & Governance panel** — the `SECURITY_DECISION` events (the CRITICAL
  "destructive action → approval" decision is the headline).
- **Audit replay panel** — `WORKFLOW_CREATED` / `WORKFLOW_PAUSED` /
  `SECURITY_DECISION` events in chronological order.
- **Cost / usage ledger** — `workflow.totalCostUsd` aggregated plus per-trace
  `tokenUsage`.

## 🚀 Quick start (local)

```bash
# 1. Configure Aurora (see docs/H0_AURORA_SETUP.md)
cp .env.example .env
#   set DATABASE_URL, DIRECT_URL (Aurora), H0_DEMO_MODE=true, NEXT_PUBLIC_H0_DEMO_MODE=true

# 2. Install + generate the Prisma client
pnpm install
pnpm --filter @jak-swarm/db db:generate

# 3. Apply migrations to Aurora (idempotent)
pnpm --filter @jak-swarm/db db:migrate:deploy

# 4. Seed the preconfigured demo workspace + demo workflows (idempotent)
pnpm h0:seed
pnpm h0:check        # verifies Aurora connectivity + seed

# 5. Run the app
pnpm --filter @jak-swarm/web dev
#   open http://localhost:3000  → redirects to /h0 (no login)
```

> **Known local build quirk:** `next build` locally can hit an ENOENT
> doubled-path quirk from `outputFileTracingRoot` on this monorepo. The
> production build runs on Vercel (server-side `rootDirectory=apps/web`), which
> avoids it. `pnpm --filter @jak-swarm/web dev` works locally for the demo.

## 🔧 Environment variables (H0 demo)

| Variable | Required for H0 | Runtime | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | Node | Aurora pooled/proxy URL with `?sslmode=require` |
| `DIRECT_URL` | yes | Node | Aurora direct URL (used for migrations) |
| `H0_DEMO_MODE` | yes (local) | Node | Server-side demo mode (invisible to Edge runtime) |
| `NEXT_PUBLIC_H0_DEMO_MODE` | yes | Edge + client | Client-side demo mode + `/` → `/h0` redirect |
| `NEXT_PUBLIC_APP_NAME` | yes | client | `JackOps` |
| `NEXT_PUBLIC_APP_URL` | yes | client | Deployed Vercel URL |
| `OPENAI_API_KEY` | optional | Node | Live AI output via `gpt-4o-mini`; empty = deterministic |
| `GEMINI_API_KEY` | optional | Node | Live AI output via `gemini-1.5-flash`; empty = deterministic |

Supabase / Cloud Run / Railway / `NEXT_PUBLIC_API_URL` are **not** required for
the H0 demo (legacy production paths only). **Never commit secrets** — store
them in Vercel Environment Variables (encrypted), not in the repo.

## 📦 Aurora migration & seed commands

```bash
pnpm --filter @jak-swarm/db db:generate        # generate Prisma client
pnpm --filter @jak-swarm/db db:migrate:deploy  # apply migrations to Aurora
pnpm h0:seed                                   # seed demo workspace (idempotent)
pnpm h0:check                                   # verify Aurora + seed
pnpm h0:setup                                   # db:generate + migrate:deploy + seed, in one command
```

## ▲ Vercel deployment

The Vercel project `jackops` is git-connected to `inbharatai/JAKOps` `main` and
auto-deploys on push.

| Setting | Value | Why |
| --- | --- | --- |
| Framework | Next.js | App Router + Turbopack |
| Root directory | `apps/web` | Vercel sets the trace root to the monorepo automatically |
| Install command | `pnpm install --frozen-lockfile=false && pnpm --filter @jak-swarm/db db:generate` | Monorepo install + Prisma client before build (see `apps/web/vercel.json`) |
| Build command | `pnpm build` (turbo) | Builds the workspace dependency chain in order |
| Deployment Protection / `ssoProtection` | **null / off** | Required so the public demo URL opens without a Vercel login |
| Production env vars | `DATABASE_URL`, `DIRECT_URL`, `H0_DEMO_MODE`, `NEXT_PUBLIC_H0_DEMO_MODE`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`, optional `OPENAI_API_KEY` / `GEMINI_API_KEY` | Set encrypted in the Vercel dashboard |

**Deploy flow:** push to `main` → Vercel builds → open the URL → it redirects to
`/h0` (no login) → click **Run Demo Workflow** to write fresh rows into Aurora
live. To pre-populate the dashboard, run `pnpm h0:seed` against Aurora (from
your machine or a one-off job) before the first load.

## 🧰 Scripts (root `package.json`)

| Script | What it does |
| --- | --- |
| `pnpm h0:setup` | `db:generate` + `db:migrate:deploy` + `h0:seed` — full demo DB setup |
| `pnpm h0:seed` | Seed the preconfigured demo workspace + demo workflows (idempotent) |
| `pnpm h0:check` | Verify Aurora connectivity + the seed |
| `pnpm --filter @jak-swarm/db db:migrate:deploy` | Apply migrations to Aurora |
| `pnpm --filter @jak-swarm/web dev` | Run the dashboard locally |
| `pnpm check:truth` | Docs-vs-code truth validation (CI truth-lock) |
| `pnpm audit:tools` | Audit the agent/tool registry |

## ✅ CI status

All **7 jobs are green** on `main` (verified at commit `52bf9ab`):

- **Build & Typecheck** — `turbo build` + `tsc --noEmit` across the workspace chain
- **Tests** — `vitest run` unit + integration (landing truth-locks + JAK Shield
  evidence paths + truth-claims all pass)
- **Dependency Audit** — `pnpm audit --audit-level=high --prod` exits 0
- **Generate SBOM** · **Secret Scan** · **Docs Truth Check** · **Security Gate**

The truth-lock tests assert that README/marketing claims match the code
(badges, agent/tool counts, evidence paths). Any hallucinated claim fails CI.

## 📸 Devpost screenshot checklist

- `/h0` opens without login (header badges: H0 Demo · Vercel · Amazon Aurora PostgreSQL · Preconfigured Demo Workspace)
- Architecture strip (Vercel → Aurora → Records → Audit Replay)
- Metrics cards loaded from Aurora
- Workflow table + agent timeline with per-stage token usage
- Approval queue (HIGH-risk external email, held pending approval)
- Security & Governance panel (`SECURITY_DECISION` events incl. CRITICAL)
- Audit replay panel (`WORKFLOW_CREATED` / `WORKFLOW_PAUSED` / `SECURITY_DECISION`)
- Cost / usage ledger
- "Run Demo Workflow" success + refreshed table (new row in Aurora)
- AWS RDS console showing the rows in Aurora PostgreSQL

## 📚 H0 docs

| Doc | Contents |
| --- | --- |
| `docs/H0_ARCHITECTURE.md` | Full architecture walkthrough |
| `docs/H0_AURORA_SETUP.md` | Step-by-step Aurora PostgreSQL provisioning |
| `docs/H0_DEMO_SCRIPT.md` | Under-3-minute video demo script |
| `docs/H0_DEVPOST_SUBMISSION.md` | Devpost submission text (Vercel + Amazon Aurora PostgreSQL) |

## 🔗 Repo & license

- **GitHub:** [inbharatai/JAKOps](https://github.com/inbharatai/JAKOps) (public, MIT)
- **Vercel project:** `jackops` (git-connected to `main`, auto-deploys)

> **Security note:** the AI keys and Vercel tokens pasted in any prior chat are
> compromised — rotate the OpenAI/Gemini keys and revoke Vercel tokens at
> `https://vercel.com/account/tokens`. Never commit secrets to the repo.

---

# Legacy: JAK Swarm (full product)

> The sections below describe the full JAK Swarm product. The H0 demo above is
> a self-contained slice that does not depend on the legacy Fastify API,
> Cloud Run, Railway, or Supabase.

<div align="center">

# 🐝 JAK

### The Closed-Loop Company Operating Layer for Agent Work

[![JAK Shield](https://img.shields.io/badge/JAK_Shield-Defensive_Only-ef4444?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/jak-shield-manifest.md)
[![Agents](https://img.shields.io/badge/AI_Agents-38-blue?style=for-the-badge&logo=robot&logoColor=white)](#-agent-roster--38-agents)
[![Tools](https://img.shields.io/badge/Classified_Tools-122-green?style=for-the-badge&logo=playwright&logoColor=white)](#-tool-inventory-122-registered)
[![Connectors](https://img.shields.io/badge/Connectors-23-blue?style=for-the-badge&logo=zapier&logoColor=white)](#-tool-inventory-122-registered)
[![ADK](https://img.shields.io/badge/Google_ADK-Integrated-4285f4?style=for-the-badge&logo=google&logoColor=white)](#-google-adk--grounding)
[![Audit Pack](https://img.shields.io/badge/Audit_Pack-SOC2_%7C_HIPAA_%7C_ISO27001-orange?style=for-the-badge&logo=shieldsdotio&logoColor=white)](docs/audit-compliance-agent-pack.md)
[![Release](https://img.shields.io/badge/Release-Beta_0.1.0--beta.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](docs/beta-release.md)
[![Tests](https://img.shields.io/badge/Tests-2154_blocking_CI-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](#-tech-stack)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript&logoColor=white)](#-tech-stack)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

> 🏆 **Google for Startups AI Agents Challenge** — Built with Google's **Agent Development Kit (ADK)** for multi-agent orchestration, deployed on **Vertex AI Agent Engine**, uses **Gemini 2.5 Pro/Flash/Flash-Lite** alongside **GPT-5.5/5.4**, and integrates **Google Search Grounding** for real-time, citation-backed responses. Per-tenant provider switching configured from the Settings UI.

**JAK turns scattered company context into approved agent work. JAK Shield makes that work safe.**

Give it a goal in plain English. JAK decomposes, routes, executes, and verifies — in real time.

</div>

<nav align="center">

**[📖 Documentation](#-documentation)** · **[⚖️ License](#-license)** · **[🔐 Security](SECURITY.md)** · **[🏗️ Architecture](ARCHITECTURE.md)** · **[🤖 Agents](AGENTS.md)** · **[❓ FAQ](docs/faq.md)** · **[🚀 Quick Start](#-quick-start)**

</nav>

---

## Challenge Build Status

JAK Swarm is submitted as a **working Google AI Agents Challenge build**. Its strongest verified evidence is **Google Cloud Run + Gemini + ADK multi-agent orchestration + Google Search Grounding + JAK Shield safety layer + 2,154 blocking CI tests**.

The submitted system includes:

* **Gemini-powered** mission interpretation, planning, routing, tool calling, and verification
* **Google ADK orchestration** through `@google/adk` (`SequentialAgent` + `ParallelAgent` pipeline, activated via `JAK_ADK_MODE=1`)
* **Google Search Grounding** — built-in with included quota, citation-backed via `GOOGLE_SEARCH` ADK tool
* **Google Cloud Run deployment** — live API gateway at `jak-swarm-api` in `asia-south1`
* **JAK Shield** local security, approval, permission, and audit checks
* **2,154 blocking CI tests** (1,764 unit + 390 integration) + `check:truth` documentation validation
* Live demo access, short and long demo videos, audit-ready workflow evidence

Agent Engine is deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`. Gateway code lives in `packages/adk/src/deploy/agent-engine-entry.ts`, with deployment scripts `scripts/deploy-agent-engine.sh`, `scripts/deploy-agent-engine.ts`, and `scripts/deploy-agent-engine-python.py`. The verified public deployment documented here is Cloud Run; Agent Engine is an additional gateway path.

### Challenge Evidence Snapshot

This table summarizes what is publicly evidenced in this repository and what is intentionally not overclaimed.

| Requirement | Evidence in JAK | Status |
|:------------|:----------------|:------:|
| Gemini integration | `GeminiRuntime` adapter, `gemini-2.5-pro/flash/flash-lite`, tier-based model selection, per-tenant provider switching | ✅ Verified |
| Google ADK orchestration | `@google/adk` `SequentialAgent` + `ParallelAgent` pipeline, `JAK_ADK_MODE=1` feature flag, `adk-pipeline.ts` + `adk-runner.ts` | ✅ Verified |
| Multi-agent collaboration | 38 agents (6 orchestrators + 32 workers), DAG-based routing, parallel worker execution, verifier / auto-repair loop | ✅ Verified |
| Google Cloud deployment | Verified Cloud Run API deployment in `asia-south1`; Cloud Run deployment docs and Google Cloud deployment path included | ✅ Verified |
| Grounding / RAG | ADK `GOOGLE_SEARCH` tool, Gemini Google Search grounding, private knowledge retrieval, optional Vertex AI Search datastore configuration | ✅ Verified |
| Business use case | Company operating layer: evidence graph → drift detection → agent-executable specs → approved multi-agent execution | ✅ Verified |
| Safety / security layer | JAK Shield-style local policy controls, RBAC, approval gates, audit logging, PII redaction, signed-decision / HMAC-ready security path | ✅ Verified |
| Tests | 2,154 blocking CI tests (1,764 unit + 390 integration) + `check:truth` documentation validation = 2,156 total; badge shows blocking count | ✅ Verified |
| Live demo | Publicly accessible submitted demo path with verified Cloud Run API backend support | ✅ Verified |
| Agent Engine | Live deployment at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` with 6 tools (google_search + 5 FunctionTool wrappers calling `/workflows`, `/memory`, `/approvals`); GEPA Candidate 1 prompt adopted; gateway code in `agent-engine-entry.ts`, deploy script `deploy-agent-engine-python.py`, resource ID in `agent-engine-resource.ts` | ✅ Verified |
| Agent Simulation / benchmarking | Benchmark harness and scenarios committed; Gemini Flash 2.5 benchmark: 4/4 pass, p50 7.6s, p95 9.0s ([`benchmark-results-gemini.md`](qa/benchmark-results-gemini.md)); harness supports `--gemini` and `--adk` flags | ✅ Verified |
| Agent Optimizer | Google ADK `adk eval` + `GEPARootAgentPromptOptimizer` run against `jak-swarm-gateway`; corrected eval: 6/6 training + 4/4 held-out validation; GEPA Candidate 1 prompt adopted in deployed Agent Engine; results in [`benchmark-optimization-before-after.md`](qa/benchmark-optimization-before-after.md) and [`adk-eval-results.json`](qa/_generated/adk-eval-results.json) | ✅ Verified |
| Before/after optimization results | Initial eval 4/6 was caused by broken API paths (`/api/` prefix); corrected eval: 6/6 training, 4/4 held-out validation; GEPA optimizer (20 iters, 102 calls) found baseline optimal on training set; Candidate 1 (safety refusal + search_knowledge fallback) adopted; original run had train/val overlap, now fixed ([`benchmark-optimization-before-after.md`](qa/benchmark-optimization-before-after.md)); latency: 4/4 pass, p50 7.6s ([`benchmark-results-gemini.md`](qa/benchmark-results-gemini.md)) | ✅ Verified |

### Deployment Reality

JAK's verified public Google Cloud deployment is the Cloud Run API (requires auth for health endpoints; public demo at [jakswarm.com](https://jakswarm.com)). A live Agent Engine gateway is also deployed at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` (`asia-south1`) with 6 tools (google_search + 5 FunctionTool wrappers) and the GEPA Candidate 1 prompt (safety-strengthened variant that matches baseline quality while adding explicit refusal and search_knowledge fallback).

Current verified deployment path:

```
Demo / frontend → Cloud Run API → JAK workflow engine → Gemini / ADK / tools / approvals
```

Optional Agent Engine gateway path:

```
Vertex AI Agent Engine → JAK Agent Engine gateway → Cloud Run API → JAK workflows
```

This keeps the existing demo and production path safe. It does not replace the submitted demo path or the verified Cloud Run backend.

| Component | Status | Details |
|:----------|:------:|:--------|
| **Cloud Run API** (`jak-swarm-api`) | ✅ Verified | Primary deployment — `asia-south1`; health endpoints implemented (`/ready`, `/health`, `/healthz`) and passing internally; require auth on public Cloud Run |
| **Frontend / demo** | ✅ Verified | Vercel + Railway continuity for challenge accessibility; `NEXT_PUBLIC_API_URL` switch to Cloud Run planned post-validation |
| **Agent Engine** | ✅ Verified | Live at `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728`; 6 tools (google_search + 5 FunctionTool wrappers calling `/workflows`, `/memory`, `/approvals`); GEPA Candidate 1 prompt; `agent-engine-entry.ts` + `deploy-agent-engine-python.py` + `agent-engine-resource.ts` |
| **Cloud Run Worker** | 🔜 Post-challenge | `jak-swarm-worker` Dockerfile + Cloud Build config exist; deployment is part of the production hardening roadmap |
| **Google Secret Manager** | ✅ Configured | 12 secrets mounted |
| **Supabase PostgreSQL** | ✅ Connected | Shared across deployments |
| **Redis** | ✅ Connected | Railway public endpoint (`rediss://`) |

### Track 2 Optimization Story

JAK's optimization story is not a single prompt tweak. It is an architecture-level shift from a broad workflow system into a Google-aligned multi-agent execution layer:

1. **ADK mode routes workflows through `SequentialAgent` and `ParallelAgent`** — when `JAK_ADK_MODE=1`, JAK's existing LangGraph system is extended with Google ADK orchestration. Workflows route through `SequentialAgent` + `ParallelAgent` with zero changes to the LangGraph path. This is additive, provider-flexible architecture.

2. **Gemini grounding improves factual reliability before and during agent execution** — real-time, citation-backed responses via `GOOGLE_SEARCH` (built-in with included quota, ADK native). No third-party search API keys required. Grounded responses reduce hallucination risk at the source.

3. **Parallel worker orchestration allows specialist agents to collaborate** — instead of forcing one agent to do everything, 38 specialist agents execute in parallel, each with domain-scoped tools and context. The Verifier agent quality-checks output before delivery.

4. **JAK Shield-style policy controls, approval gates, RBAC, and audit logging reduce unsafe automation risk** — every real-world agent action flows through 6 local policy stages (Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer) with deterministic blocking, injection detection, taint tracking, PII redaction, RBAC thresholds, and cryptographic signing. The external JAK Shield MCP adds 4 additional stages for signed high-risk decisions. High-risk actions require explicit approval. Destructive actions are never auto-retried.

5. **Provider switching allows tenants to use Gemini or other supported providers without rewriting workflows** — each tenant chooses from the Settings UI. The preference flows through `TenantMemory` → `SwarmExecutionService` → `SwarmRunner` → `AgentContext.llmProvider`. No code changes, no env-var swaps.

6. **Benchmark/readiness scripts and the blocking test suite provide regression protection** — 2,154 blocking CI tests (1,764 unit + 390 integration) with CI-enforced truth checks (`pnpm check:truth`). Tool maturity labels are CI-enforced. Landing page claims are CI-enforced.

ADK Agent Optimizer (`adk optimize` with `GEPARootAgentPromptOptimizer`) has been executed against the JAK gateway agent. The GEPA algorithm ran 20 evaluation iterations (102 metric calls) on the training set, finding the baseline prompt achieves 100% rubric pass rate (6/6). The initial `adk eval` showed 4/6 due to broken API paths (`/api/` prefix instead of production `/workflows`), not poor agent quality. After fixing paths, corrected eval: 6/6 training + 4/4 held-out validation. GEPA explored 3 alternative prompt variants — Candidate 1 (explicit safety refusal + search_knowledge fallback) matched baseline quality and has been adopted in the deployed Agent Engine. The original optimizer run had train/val overlap (same 6 scenarios for both); a separate validation set has been added. Full results in `qa/benchmark-optimization-before-after.md`.

Post-challenge production hardening roadmap:

* full Cloud Run worker cutover
* expanded health and observability endpoints
* enterprise SLA packaging
* deeper connector productionization
* full JAK Shield MCP signed-decision integration for high-risk actions
* official Agent Evaluator / Simulation / Optimizer quantitative runs

---

## What JAK Swarm Does

JAK Swarm is a Gemini-powered Agentic Business Operating Layer for product and engineering execution. It captures evidence from company artifacts, maps decisions / tasks / risks / owners / customer signals / code changes, detects execution drift, generates agent-executable specs, and routes approved work through **38 specialist agents** + **122 classified tools** + **23 connectors**.

### What's unique

- **Evidence graph before agent action** — artifacts become graph entities; graph entities become drift findings; drift findings become agent-executable specs. This is the closed-loop Company OS foundation — intentionally citation-first, not chatbot memory. ([`company-operating-layer.service.ts`](apps/api/src/services/company-brain/company-operating-layer.service.ts))
- **One task graph for AI agents AND humans** — the CEO writes a prompt; the planner routes some steps to specialist agents (Research, CMO, CTO) and others to teammates ("@anita to sign the contract"). Both flow through the same orchestrator, emit lifecycle events, and feed the signed audit pack. ([`docs/team-and-trial.md`](docs/team-and-trial.md))
- **JAK Shield as the trust gateway** — high-risk agent actions are routed through a separate MCP-native 10-stage security gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) with local policy enforcement inside Swarm. ([`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) · [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md))
- **Google ADK orchestration** — when `JAK_ADK_MODE=1`, workflows route through Google's Agent Development Kit (`@google/adk`) using `SequentialAgent` and `ParallelAgent` for multi-agent orchestration. Google Search Grounding provides real-time, citation-backed responses. ([`packages/adk/`](packages/adk/))
- **Provider-native search without paid APIs** — Gemini uses `GOOGLE_SEARCH` (built-in with included quota, citation-backed). OpenAI uses `web_search_preview` (built-in with included quota, native). No Serper, no Tavily, no third-party search API keys needed. API keys are required for OpenAI and Gemini — JAK does not bundle or provide free LLM API keys.
- **30-day free trial with daily budget caps** — sign up at `/trial` with just an email. No credit card. Four daily caps protect both your data AND your budget.
- **Integrate, don't rebuild** — JAK is the cockpit for your existing stack. Gmail, Google Calendar, Slack, GitHub, Notion, browser automation, and MCP surfaces exist in code.

### Who it's for

- Product and engineering teams comparing customer/founder intent with what is actually being built
- Solo founders and small ops teams who want AI to do real work, not just "give answers"
- Compliance-aware teams needing tamper-evident agent action trails (SOC 2 / HIPAA / ISO 27001 control mappings shipped — third-party certification not yet; see [FAQ](docs/faq.md))
- Teams already on Slack / GitHub / Notion / Gmail wanting one place to turn evidence into approved execution

### Build scope

This is a **working challenge build** submitted for the Google AI Agents Challenge. Enterprise SLA packaging, expanded observability, and production hardening are part of the post-challenge roadmap. The current submitted Google Cloud deployment supports the JAK API / agent gateway for live workflows. Full connector auto-sync is an active product build item. The accurate claim is **Company OS working challenge foundation**, not a finished enterprise product. API keys are required for external LLM providers (Gemini, OpenAI) — JAK does not bundle API keys or provide free LLM access. See [`docs/beta-release.md`](docs/beta-release.md) for the full scope and go/no-go checklist.

---

## 🔮 Google ADK + Grounding

JAK Swarm integrates Google's Agent Development Kit at three layers, each independently activatable and completely additive — the Gemini + ADK orchestration pipeline runs alongside the existing LangGraph pipeline without modifying it.

### Layer 1: Google Search Grounding + Vertex AI Search

When `LLM_PROVIDER=gemini`, the Gemini runtime injects `{ googleSearch: {} }` and optionally `{ vertex_ai_search: { datastore } }` into the Gemini API tools array. Responses include `groundingMetadata` with web search queries, source URLs, and confidence scores.

For OpenAI, the native `web_search_preview` hosted tool provides equivalent real-time search — no Serper or Tavily keys needed.

| Flag | Effect |
|:-----|:-------|
| `GEMINI_GOOGLE_SEARCH_GROUNDING=1` | Enables Google Search grounding in Gemini |
| `GEMINI_VERTEX_AI_SEARCH_DATASTORE=projects/.../dataStores/...` | Enables Vertex AI Search |
| `OPENAI_WEB_SEARCH=1` | Enables web_search_preview for OpenAI |

### Layer 2: ADK Agent Wrappers + Orchestration

When `JAK_ADK_MODE=1`, workflows route through `@google/adk` instead of LangGraph:

```
SequentialAgent(root)
  ├── CommanderAgent          (GOOGLE_SEARCH + JAK tools)
  ├── PlannerAgent            (no tools)
  ├── ParallelAgent(workers)
  │     ├── Worker_CEO        (tools + search)
  │     ├── Worker_CTO        (tools + search)
  │     └── ...               (one per role)
  ├── SynthesisAgent           (merges parallel outputs)
  └── VerifierAgent            (quality assurance)
```

**Provider-native search**: Gemini agents use `GOOGLE_SEARCH` (ADK built-in, included quota). OpenAI agents use `web_search_preview` (hosted tool, included quota).

Key files: [`packages/adk/`](packages/adk/) — [`jak-tool-bridge.ts`](packages/adk/src/bridge/jak-tool-bridge.ts) · [`jak-adk-agents.ts`](packages/adk/src/agents/jak-adk-agents.ts) · [`adk-pipeline.ts`](packages/adk/src/orchestration/adk-pipeline.ts) · [`adk-runner.ts`](packages/adk/src/orchestration/adk-runner.ts)

### Provider-Agnostic Guarantee

| When | What runs |
|:----:|:----------|
| `LLM_PROVIDER=openai` (any mode) | Existing OpenAI path, zero changes |
| `LLM_PROVIDER=gemini` (no flags) | Existing GeminiRuntime, no grounding |
| `LLM_PROVIDER=gemini` + `GEMINI_GOOGLE_SEARCH_GROUNDING=1` | GeminiRuntime with Google Search grounding |
| `LLM_PROVIDER=gemini` + `JAK_ADK_MODE=1` | ADK orchestration with Gemini + grounding |

### Layer 3: Agent Engine Gateway

Agent Engine gateway code in [`agent-engine-entry.ts`](packages/adk/src/deploy/agent-engine-entry.ts), with deployment scripts [`deploy-agent-engine.sh`](scripts/deploy-agent-engine.sh), [`deploy-agent-engine.ts`](scripts/deploy-agent-engine.ts), and [`deploy-agent-engine-python.py`](scripts/deploy-agent-engine-python.py). The live Agent Engine resource is `projects/565531938617/locations/asia-south1/reasoningEngines/1509110495448137728` (stored in [`agent-engine-resource.ts`](packages/adk/src/deploy/agent-engine-resource.ts)). The gateway agent uses `GOOGLE_SEARCH` for real-time grounding and delegates workflow execution to JAK's Cloud Run API. Cloud Run remains the primary verified deployment; Agent Engine is an additional gateway path.

---

## 🏗️ How It Works

```mermaid
flowchart TD
    subgraph INPUT["🎤 Input Layer"]
        A["💬 Natural Language Goal"]
        B["🎤 Voice Command"]
    end

    subgraph ORCHESTRATION["🧠 Orchestration Layer"]
        C["🎯 Commander Agent"]
        D["📋 Planner Agent"]
        E["🛡️ Guardrail Agent"]
        F["🔀 Router Agent"]
    end

    subgraph WORKERS["⚡ Worker Layer — 32 Specialists"]
        direction LR
        G["📧 Email  📅 Calendar  👤 CRM"]
        H["📄 Document  📊 Spreadsheet  🌐 Browser"]
        I["🔍 Research  🧠 Knowledge  🎧 Support"]
        J["💻 Coder  🎨 Designer  🚀 Growth"]
        K["⚖️ Legal  💰 Finance  👔 HR"]
    end

    subgraph VERIFY["✅ Quality Layer"]
        M["✅ Verifier Agent"]
        N["⚠️ Approval Gate"]
    end

    subgraph OUTPUT["📊 Output"]
        O["Compiled Result"]
    end

    A --> C
    B --> C
    C --> D --> E
    E -->|"✅ Pass"| F
    E -->|"🚫 Block"| C
    F --> G & H & I & J & K
    G & H & I & J & K --> M
    M -->|"✅ Pass"| O
    M -->|"❌ Fail"| D
    M -->|"⚠️ Risk"| N
    N -->|"👍 Approved"| O
    N -->|"👎 Rejected"| C
```

> **Auto-Repair**: If the Verifier rejects output, the system re-plans and re-routes failed tasks — no human intervention needed (configurable). Destructive actions are never auto-retried.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full system architecture, data model, error handling strategy, and scaling considerations.

---

## 🛡️ JAK Shield — The Trust Gateway

JAK Shield is a **separate MCP-native security gateway** ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) with a **10-stage decision pipeline** that protects every real-world agent action. JAK Swarm currently enforces JAK Shield-style local policy controls inside `packages/security`, including guardrails, RBAC, audit logging, and the Agent Governance Overlay that enforces agent profiles, memory scopes, and autonomy boundaries. JAK Shield also exists as a separate MCP-native security gateway, with full signed high-risk action validation planned as a post-challenge hardening step.

**JAK Shield 10-stage decision pipeline:**

| Stage | What it does |
|-------|-------------|
| 1. Hard rules | Deterministic block/allow based on tenant policy |
| 2. Injection v2 | 6 substages, 13+ language detection of prompt injection |
| 3. Taint tracker | MinHash + n-gram fingerprinting for cross-prompt taint |
| 4. Attack-chain detection | 20 patterns + data-flow analysis for multi-step attacks |
| 5. PII v2 | 28 types (SSN, Aadhaar, IBAN, PAN, NRIC, CPF, CNPJ, etc.) + cryptographic checksums |
| 6. Anomaly detection | EWMA + z-score per tenant/agent for behavioural drift |
| 7. RBAC + threshold | Role, department, and autonomy-level gating |
| 8. OpenAI classifier | Advisory-only second opinion (deterministic engine has final say) |
| 9. HMAC signing | Cryptographic proof of every security decision |
| 10. Output routing | `allow` · `redact` · `requires_approval` · `block` · `rewrite` |

**Local policy enforcement inside JAK Swarm** (`packages/security`):

| # | Defense | What it does | Code |
|---|---------|-------------|------|
| 1 | **Agent Firewall** | Blocks prompt-injection attacks AND offensive-cyber requests before the LLM sees them. | [`offensive-cyber-detector.ts`](packages/security/src/guardrails/offensive-cyber-detector.ts) · [`injection-detector.ts`](packages/security/src/guardrails/injection-detector.ts) |
| 2 | **Risk-Based Approvals** | Every tool call classified across the 6-tier `ToolRiskLevel` lattice. Risky calls pause the workflow. Approval bound to exact payload via SHA-256 hash. | [`approval-policy.ts`](packages/tools/src/registry/approval-policy.ts) |
| 3 | **Secure Tool Permissions** | Per-tenant tool registry + industry-pack restrictions + Standing Orders (allowed-tools whitelist + blocked-actions list + budget cap + expiry). | [`tenant-tool-registry.ts`](packages/tools/src/registry/tenant-tool-registry.ts) |
| 4 | **Sandboxed Execution** | Browser sessions: per-tenant data dirs, 500 MB disk quota, URL allowlist, DNS-rebind defense. Subprocess: literal argv, 60s timeout, stripped env. | [`playwright-browser-operator.ts`](packages/tools/src/browser-operator/playwright-browser-operator.ts) |
| 5 | **Defensive Vulnerability Triage** | Supports defensive security work — repo audits, dependency scans, secret-leak detection. Offensive work is blocked at the boundary. | [`offensive-cyber-detector.ts`](packages/security/src/guardrails/offensive-cyber-detector.ts) |
| 6 | **Audit Evidence Layer** | Every workflow lifecycle event lands in `AuditLog`. AgentTrace PII-redacted at write time. Evidence bundles HMAC-SHA256 signed. Field-level encryption via `field-cipher.ts` available for sensitive workflow data. | [`bundle.service.ts`](apps/api/src/services/bundle.service.ts) · [`field-cipher.ts`](packages/security/src/encryption/field-cipher.ts) |

**Safety boundary:** JAK Shield is built for defensive security, safe automation, permissioned workflows, and audit-ready agent execution. It does **not** support offensive hacking, malware generation, credential theft, phishing, unauthorized scanning, or exploit generation.

Full manifest: [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md). Architecture plan: [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md). Security policy: [`SECURITY.md`](SECURITY.md).

---

## ✨ Key Features

| | Feature | Description |
|---|---------|-------------|
| 🤖 | **38 AI Agents** | 6 orchestrators + 32 specialist workers across Executive, Operations, Core, and Vibe Coding layers. [Full roster →](#-agent-roster--38-agents) |
| 🧠 | **Company Brain** | Per-tenant profile (industry, brand voice, competitors, goals) LLM-extracted from documents → user approves → grounds every agent prompt. Refuses unapproved profiles. UI at `/company`. |
| 🎯 | **Intent Vocabulary + Templates** | 18 named CompanyOSIntents constrained at the LLM layer via strict Zod schema. 6 system-seeded WorkflowTemplates provide pre-tuned decompositions. |
| 💬 | **Follow-up NL Parser** | Rule-based parser maps short chat inputs to workflow actions: approve, reject, continue, pause, resume, cancel, show graph/cost/failed, "what is the CMO doing?" |
| 🛡️ | **Audit & Compliance Pack** | SOC 2 Type 2 (63) + HIPAA (37) + ISO 27001 (82) = 182 controls seeded. 108 operationally backed, 74 require reviewer attestation. LLM-driven control testing, reviewer-gated workpaper PDFs, HMAC-signed evidence packs, External Auditor Portal. [Full details →](docs/audit-compliance-agent-pack.md) |
| 🔧 | **122 Classified Tools** | Every tool carries an honest CI-enforced maturity label (`real` / `heuristic` / `llm_passthrough` / `config_dependent` / `experimental`). [Inventory →](#-tool-inventory-122-registered) |
| ⚡ | **Vibe Coding Builder** | Describe an app → Architect → Generate → 3-layer build check → Debug loop (≤3 retries) → Deploy. [Details →](docs/vibe-coding.md) |
| 🧠 | **Agent-first Runtime** | All work routes through specialist agents with tier-based model execution. Both **OpenAI** (GPT-5.5/5.4) and **Gemini** (2.5 Pro/Flash/Flash-Lite) with per-tenant switching. |
| 🔍 | **Provider-Native Search** | Google Search Grounding (built-in with included quota, citation-backed) for Gemini. `web_search_preview` (built-in with included quota, native) for OpenAI. No Serper, no Tavily, no external search API keys required. |
| 🧬 | **ADK Orchestration** | Google Agent Development Kit (`@google/adk`) for multi-agent orchestration. `SequentialAgent` + `ParallelAgent` pipeline mirrors JAK's DAG. Activated via `JAK_ADK_MODE=1`. |
| 🧠 | **Memory System** | LLM-powered fact extraction, token-budgeted retrieval injected via `<memory>` tags. Server-side conversation threads with full history injection into LangGraph state. |
| 🔌 | **MCP Integrations** | Slack, GitHub, Notion wired with provider management. 21 MCP providers auto-mapped. Connector Runtime with honest status badges. [Connector docs →](docs/connector-runtime.md) |
| 💬 | **Slack + WhatsApp Bridges** | Slack messages trigger authenticated workflows with HMAC-verified webhooks. WhatsApp control via QR verification. |
| 🎤 | **Voice Sessions** | OpenAI Realtime API via WebRTC. Optional Deepgram STT / ElevenLabs TTS adapters. |
| 🏢 | **Multi-Tenant SaaS** | RBAC (5 roles + External Auditor), approval gates, audit logging, tenant isolation. Tenant secrets are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed. |
| 💰 | **Credit-Based Billing** | 4 plans (Free / Pro / Team / Enterprise), daily + monthly caps, per-task cost estimation, usage dashboard. |
| 📊 | **Observability** | 35+ Prometheus metrics, OpenTelemetry tracing, per-node cost breakdown, workflow timeline API, `/ready` readiness endpoint. Additional health and telemetry endpoints are part of the production observability roadmap. |
| 🏗️ | **Distributed Ready** | Redis coordination: distributed locks, leader election, cross-instance signals, shared circuit breakers. Worker-lease reclaim: dead workers' jobs auto-recovered in 30s. |

---

## 🎭 Agent Roster — 38 Agents

```mermaid
graph LR
    subgraph ORCH["🧠 Orchestrators"]
        O1["🎯 Commander"]
        O2["📋 Planner"]
        O3["🔀 Router"]
        O4["✅ Verifier"]
        O5["🛡️ Guardrail"]
        O6["⚠️ Approval"]
    end

    subgraph EXEC["💼 Executive"]
        E1["🎯 Strategist (CEO)"]
        E2["🏗️ Technical (CTO)"]
        E3["💰 Finance (CFO)"]
        E4["📣 Marketing (CMO)"]
        E5["👔 HR"]
        E6["💻 Coder"]
        E7["🎨 Designer"]
        E8["🚀 Growth"]
    end

    subgraph VIBE["⚡ Vibe Coding"]
        V1["🏛️ Architect"]
        V2["⚡ Generator"]
        V3["🔧 Debugger"]
        V4["🚀 Deployer"]
        V5["📸 Screenshot→Code"]
    end

    subgraph OPS["🏢 Operations"]
        P1["✏️ Content"]
        P2["📈 SEO"]
        P3["📰 PR"]
        P4["⚖️ Legal"]
        P5["🤝 Success"]
        P6["📉 Analytics"]
        P7["🗺️ Product"]
        P8["📌 Project"]
    end

    subgraph CORE["⚙️ Core Workers"]
        W1["📧 Email"]
        W2["📅 Calendar"]
        W3["👤 CRM"]
        W4["📄 Doc"]
        W5["📊 Sheet"]
        W6["🌐 Browser"]
        W7["🔍 Research"]
        W8["🧠 Knowledge"]
        W9["🎧 Support"]
        W10["⚙️ Ops"]
        W11["🎤 Voice"]
    end
```

| Layer | Count | Purpose |
|:------|:-----:|:--------|
| **🧠 Orchestrators** | 6 | Parse goals, build DAGs, route tasks, verify quality, enforce guardrails |
| **💼 Executive** | 8 | CEO/CTO/CFO/CMO-level strategic decisions and specialized expertise |
| **⚡ Vibe Coding** | 5 | Full-stack app generation — architecture, code, debug, deploy, vision |
| **🏢 Operations** | 8 | Content, SEO, PR, Legal, Analytics, Product, Project management |
| **⚙️ Core Workers** | 11 | Email, Calendar, CRM, Browser, Research, Voice, infrastructure tools |

Full agent details: [`AGENTS.md`](AGENTS.md)

---

## 🧠 LLM Providers & Routing

| Provider | Models | Use Case |
|:--------:|:------:|:---------|
| ![Gemini](https://img.shields.io/badge/LLM-Gemini_2.5-4285f4?style=flat-square&logo=google) | 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite | Parallel function calling, controllable thinking, structured output, **Google Search Grounding** |
| ![OpenAI](https://img.shields.io/badge/LLM-GPT--5.5_%2F_5.4-412991?style=flat-square&logo=openai) | GPT-5.5, GPT-5.4 | Responses API, strict structured output, prompt-cache-aware telemetry (alternate provider) |

**Per-tenant provider switching** — each tenant chooses Gemini or OpenAI from the Settings UI. The preference flows through `TenantMemory` → `SwarmExecutionService` → `SwarmRunner` → `SwarmState` → `AgentContext.llmProvider` → `BaseAgent.setContextOverride()`. Tenant API keys are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed.

**Tier-based model selection:**

| Tier | Gemini | OpenAI | Assigned to |
|:----:|:------:|:------:|:-----------|
| 💎 Premium | Gemini 2.5 Pro | GPT-5.5 | Commander, Planner, Verifier, CEO/CMO/CFO |
| ⚡ Balanced | Gemini 2.5 Flash | GPT-5.4 | Code Generator, Architect, Research |
| 💰 Economy | Gemini 2.5 Flash-Lite | GPT-5.4 | Router, Guardrail, simple workers |

**Provider-native search** — no paid search API keys required:

| Provider | Search Method | Cost | Citations |
|:--------:|:-------------:|:----:|:---------:|
| Gemini | `GOOGLE_SEARCH` (ADK built-in) or `googleSearch` grounding | Included quota | ✅ URLs + snippets |
| OpenAI | `web_search_preview` hosted tool | Included quota | ✅ Source URLs |

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version |
|:-----------:|:-------:|
| Node.js | 20+ |
| pnpm | 9+ |
| PostgreSQL | 15+ (pgvector recommended) |
| Redis | Optional (for scheduling + distributed locks) |

### 1. Clone & Install

```bash
git clone https://github.com/inbharatai/jak-swarm.git
cd jak-swarm
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

At minimum set:

```bash
# LLM provider (set one or both — per-tenant switching available in the dashboard)
OPENAI_API_KEY=sk-your-openai-key-here
GEMINI_API_KEY=your-gemini-key-here          # Optional: enables Gemini 2.5 Pro/Flash

# Google ADK orchestration (optional — activates ADK multi-agent pipeline)
JAK_ADK_MODE=1                                # Routes workflows through @google/adk
GEMINI_GOOGLE_SEARCH_GROUNDING=1              # Google Search grounding for Gemini
OPENAI_WEB_SEARCH=1                           # Native web_search for OpenAI

DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm
AUTH_SECRET=your-random-32-char-string-here
EVIDENCE_SIGNING_SECRET=$(openssl rand -base64 48)

# Supabase (required for production auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Full reference: [`docs/environment-setup.md`](docs/environment-setup.md)

### 3. Setup Database

```bash
pnpm --filter @jak-swarm/db db:migrate
pnpm --filter @jak-swarm/db db:seed              # optional: seed sample data
pnpm seed:compliance                             # seeds 182 SOC 2 / HIPAA / ISO 27001 controls
```

### 4. Build & Run

```bash
pnpm turbo build

# Terminal 1 — API server (Fastify, port 4000)
pnpm --filter @jak-swarm/api dev

# Terminal 2 — Web dashboard (Next.js, port 3000)
pnpm --filter @jak-swarm/web dev
```

Open **http://localhost:3000** — give it a goal and watch the swarm execute.

Docker: [`docker/docker-compose.yml`](docker/docker-compose.yml) · Production: [`docker-compose.prod.yml`](docker-compose.prod.yml)

### Deploy to Railway (Rollback Continuity)

Railway remains available as rollback continuity during the challenge window. Google Cloud Run is the primary submitted deployment.

```bash
npm i -g @railway/cli
railway link
railway up
```

See [`docs/railway-deployment.md`](docs/railway-deployment.md) for the full Railway runbook.

### Deploy to Google Cloud Run

JAK Swarm API is deployed on Google Cloud Run (primary). Railway remains available as rollback continuity during the challenge window.

```bash
# Prerequisites: gcloud CLI, billing-enabled GCP project
# See docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md for full setup

gcloud builds submit --config=cloudbuild-api.yaml
# Worker migration to Cloud Run is part of the post-challenge production hardening roadmap
```

See [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for step-by-step instructions.

#### Current Deployment Status

JAK Swarm API is currently deployed successfully on Google Cloud Run.

| Field | Value |
|-------|-------|
| Service | `jak-swarm-api` |
| Region | `asia-south1` |
| URL | `https://jak-swarm-api-565531938617.asia-south1.run.app` |
| Last deployed by | `reetu004@gmail.com` |
| Last deployed at | `2026-06-09T05:50:22Z` (≈ 11:20 AM IST) |

**Verification commands:**

```bash
gcloud config get-value project

gcloud run services list --platform managed

gcloud run services describe jak-swarm-api \
  --region asia-south1 \
  --format="value(status.url,status.conditions[0].status,status.conditions[0].type)"

curl -i https://jak-swarm-api-565531938617.asia-south1.run.app/health

gcloud run services logs read jak-swarm-api \
  --region asia-south1 \
  --limit=50
```

**Component Status:**

| Component | Status |
|-----------|--------|
| Cloud Run API (`jak-swarm-api`) | ✅ Deployed, accessible through the submitted demo path |
| Cloud Run Worker (`jak-swarm-worker`) | 🔜 Post-challenge hardening roadmap |
| Supabase PostgreSQL | ✅ Connected (shared with Railway) |
| Redis | ✅ Connected via Railway public endpoint (`rediss://`, not `.railway.internal`) |
| Google Secret Manager | ✅ Configured, 12 secrets mounted |
| Vercel `NEXT_PUBLIC_API_URL` | 🔜 Points to Railway for challenge accessibility; Cloud Run URL switch planned post-validation |

**Health Endpoints:**

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/ready` | ✅ Implemented | Readiness check. Env, DB, Redis, LLM. Uses `$queryRawUnsafe` for Supabase pooler compatibility. Requires auth on public Cloud Run. |
| `/health` | ✅ Implemented | Deep diagnostic. Uses `$queryRawUnsafe` for Supabase pooler compatibility. Requires auth on public Cloud Run. |
| `/healthz` | ✅ Implemented | Liveness probe (always 200, no dependency checks). Requires auth on public Cloud Run. |

**Post-Challenge Hardening Items:**

- Complete Cloud Run Worker migration
- Switch Vercel `NEXT_PUBLIC_API_URL` to Cloud Run URL after full validation

**Railway as Rollback Continuity:**

The frontend remains on Vercel for challenge accessibility. The submitted Google Cloud deployment supports the JAK API / agent gateway path, while Railway remains available as rollback continuity during the challenge window. If Cloud Run has issues, switch `NEXT_PUBLIC_API_URL` in Vercel back to the Railway URL and redeploy — no code changes needed.

### Integration Setup

<details>
<summary><b>📧 Gmail (IMAP/SMTP)</b></summary>

1. Enable 2FA → generate an App Password at [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Add to `.env`: `GMAIL_EMAIL="you@gmail.com"` + `GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"`
3. System auto-detects and switches from mock to real adapters

</details>

<details>
<summary><b>💬 Slack (MCP)</b></summary>

1. Create Slack app at [api.slack.com/apps](https://api.slack.com/apps) → add Bot Token Scopes: `channels:read`, `chat:write`, `search:read`, `users:read`
2. Install to workspace → copy Bot User OAuth Token
3. Dashboard: **Settings > Integrations > Slack** → paste token + Team ID

</details>

<details>
<summary><b>🐙 GitHub (MCP) · 📝 Notion (MCP)</b></summary>

- **GitHub**: Generate PAT at [github.com/settings/tokens](https://github.com/settings/tokens) (scopes: `repo`, `read:org`, `read:user`) → paste in **Settings > Integrations > GitHub**
- **Notion**: Create integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) → copy Internal Integration Secret → share pages with integration → paste in **Settings > Integrations > Notion**

</details>

---

## 📸 Screenshots

<div align="center">

| Landing Page | Agent Network |
|:---:|:---:|
| ![Hero](docs/screenshots/01-hero.png) | ![Agents](docs/screenshots/02-agents.png) |

| Workflow Execution | Pricing |
|:---:|:---:|
| ![Workflow](docs/screenshots/03-workflow.png) | ![Pricing](docs/screenshots/04-pricing.png) |

| Login | Onboarding |
|:---:|:---:|
| ![Login](docs/screenshots/05-login.png) | ![Onboarding](docs/screenshots/07-onboarding.png) |

</div>

---

## 🖥️ Dashboard Pages

| Page | Description |
|:-----|:------------|
| 🏠 **Home** | Mission control — activity feed, approvals, quick actions |
| 🏢 **Workspace** | Command center — text/voice input, DAG view, agent tracker |
| ⚡ **Builder** | Vibe Coding IDE — Monaco editor, chat, preview, deploy |
| 🐝 **Swarm** | Workflow inspector with agent timeline visualization |
| 🛡️ **Audit** | Audit & Compliance home — dashboard, log, reviewer queue, compliance frameworks |
| 🛡️ **Audit Runs** | Engagement detail — control matrix, workpapers, exceptions, final pack |
| 🔎 **Traces** | Full agent trace explorer with token/cost breakdown |
| 📊 **Analytics** | Usage metrics, cost tracking, agent performance charts |
| ⏰ **Schedules** | Cron-based recurring workflow management |
| 🔌 **Integrations** | MCP provider connections |
| 🔗 **Connectors** | Connector status and management |
| 🧠 **Knowledge** | Memory store — facts, preferences, policies |
| ⚙️ **Settings** | LLM provider config, approval thresholds |
| 👑 **Admin** | Tenant management, users, API keys, tool toggles |
| 📁 **Files** | Document upload, storage, and management |
| 📋 **My Tasks** | Personal task list and assignments |
| 👥 **Team** | Team management, departments, member roles |
| 🏢 **Company** | Company profile, brand voice, competitors, goals |
| 📨 **Inbox** | Notification center and message feed |
| 📅 **Calendar** | Calendar events and scheduling |
| 💬 **Social** | Social media management and drafts |
| ✏️ **Social Drafts** | Draft social media posts for review |
| 🔧 **Tool Installer** | Tool installation and configuration |
| 📜 **Standing Orders** | Persistent tool allowlists and blocked actions |
| 💡 **Skills** | Reusable workflow templates and skill library |
| 🏃 **Runs** | Workflow run history and results |
| 💳 **Billing** | Subscription plans, usage, credits |

---

## 🔧 Tool Inventory (122 Registered)

| Category | Count | Key Tools | Status |
|:---------|:-----:|:----------|:------:|
| **Email** | 10 | read_email, draft_email, send_email, gmail_read_inbox, gmail_send_email, track_email_engagement | ✅ Real (Gmail IMAP/SMTP) |
| **Calendar** | 3 | list_calendar_events, create_calendar_event, find_availability | ✅ Real (CalDAV) |
| **CRM** | 14 | lookup_crm_contact, update_crm_record, search_deals, enrich_contact, score_lead, predict_churn | 🔌 Pluggable adapter |
| **Browser** | 30 | navigate, extract, fill_form, click, screenshot, analyze_page, manage_cookies, evaluate_js, pdf_export | ✅ Real (Playwright) |
| **Document** | 16 | summarize_document, extract_document_data, pdf_extract_text, pdf_analyze, generate_report, file_read, file_write | ✅ Real (pdf-parse + DALL-E) |
| **Research** | 31 | web_search, web_fetch, classify_text, audit_seo, research_keywords, analyze_serp, code_execute | ✅ Real (web) |
| **Spreadsheet** | 4 | parse_spreadsheet, compute_statistics, generate_report, export_csv | ✅ Built-in |
| **Knowledge** | 9 | search_knowledge, memory_store, memory_retrieve, ingest_document | ✅ Real (DB-backed) |
| **Webhook** | 2 | send_webhook, deploy_to_vercel | ✅ Built-in |
| **MCP** | Dynamic | Slack, GitHub, Notion + 18 more loaded at runtime | ✅ Real (MCP servers) |

Tool maturity labels enforced by CI: `pnpm check:truth` fails if any tool ships unclassified.

---

## ⚖️ How JAK Swarm Compares

| Feature | JAK Swarm | CrewAI | LangGraph | Devin |
|:--------|:---------:|:------:|:---------:|:-----:|
| Pre-built agents | **38** | 0 | 0 | 1 |
| Tools | **122** | 50+ | Custom | ~10 |
| Built-in UI | **27 pages** | — | LangSmith | IDE |
| **Gemini + OpenAI** (per-tenant) | ✅ | ❌ | ❌ | ❌ |
| **Google ADK orchestration** | ✅ | ❌ | ❌ | ❌ |
| **Google Search Grounding** | ✅ | ❌ | ❌ | ❌ |
| SOC 2 / HIPAA / ISO 27001 audit pack | ✅ | ❌ | ❌ | ❌ |
| Self-debugging loop | ✅ 3 retries | Limited | Manual | Limited |
| Open source | ✅ MIT | ✅ MIT | ✅ MIT | — $20/mo |

---

## 🔭 Long-Term Vision

JAK is evolving from a multi-agent workflow operator into an ever-learning Company OS that remembers company context, understands departmental roles, and safely completes approved work across the organisation. JAK Shield is the MCP-native trust gateway that protects every real-world agent action.

<details>
<summary><b>Vision diagram and time horizons</b></summary>

```mermaid
flowchart TB
    subgraph INPUTS["1. Company Inputs"]
        I1["Calls"] & I2["Meetings"] & I3["Docs"] & I4["Websites"]
        I5["Emails"] & I6["Code"] & I7["Tasks"] & I8["CRM"] & I9["Support"]
    end

    subgraph MEMORY["2. Company Memory Layer"]
        M1["Transcripts"] & M2["Decisions"] & M3["Policies"] & M4["People"]
        M5["Projects"] & M6["Risks"] & M7["Evidence"]
    end

    subgraph INTELLIGENCE["3. Role-Based Intelligence Layer"]
        R1["CEO"] & R2["HR"] & R3["CTO"] & R4["CMO"]
        R5["Finance"] & R6["Legal"] & R7["Ops"] & R8["Support"]
    end

    subgraph PERMISSIONS["4. Permission + Governance Layer"]
        P1["RBAC"] & P2["Dept access"] & P3["Approval gates"]
        P4["Agent Governance Overlay"] & P5["JAK Shield MCP"]
        P6["Audit evidence"] & P7["Autonomy Ladder"]
    end

    subgraph EXECUTION["5. Autonomous Execution Layer"]
        E1["Plan"] & E2["Assign"] & E3["Execute"]
        E4["Verify"] & E5["Report"] & E6["Learn again"]
    end

    INPUTS --> MEMORY --> INTELLIGENCE --> PERMISSIONS --> EXECUTION
    EXECUTION -->|"feedback loop"| MEMORY
```

**Short term (Phase 1-4)** — Foundation: Agent Profile Registry, Ability Packs, Thread Model, Company Memory Base, Role-Based Memory Permissions, Marketing OS backend. Security enforced by local policy logic in `packages/security`.

**Medium term (Phase 5-10)** — Intelligence + Governance: Commander Coach, Capability Gap Detector, Agent Forge, Evaluation + Learning Loop, Autonomy Ladder (L0-L4 with local policy; L5 deferred). Agent Governance Overlay enforces profiles, scopes, and role boundaries using local policy.

**Long term (Phase 11A-11B)** — Production Hardening + JAK Shield MCP Integration:
- Phase 11A: Production hardening, Cloud Run Worker cutover
- Phase 11B: Full JAK Shield MCP signed-decision integration for high-risk action validation (separate MCP-native gateway at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield))

**Architecture separation:** JAK Swarm (Company OS) and JAK Shield (MCP-native trust gateway) are separate products. JAK Shield is independently deployable and auditable. Phase 1-11A uses local policy logic in `packages/security`. Phase 11B+ adds full JAK Shield MCP signed-decision integration for high-risk actions.

</details>

Full roadmap with implementation milestones and honest scope boundaries: [`docs/ROADMAP.md`](docs/ROADMAP.md). Full architecture plan: [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md).

---

## 🏗️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Language** | TypeScript 5.7 (strict) |
| **API** | Fastify |
| **Frontend** | Next.js 16, React 19, Tailwind CSS |
| **DAG Visualization** | React Flow |
| **Database** | PostgreSQL + Prisma ORM + pgvector |
| **Auth** | Supabase (email/password + magic link) + JWT + API keys |
| **Durable Workflows** | LangGraph StateGraph + PostgresCheckpointSaver |
| **ADK Orchestration** | @google/adk (SequentialAgent + ParallelAgent) |
| **LLM — OpenAI** | GPT-5.5 / GPT-5.4 — Responses API, json_schema strict mode |
| **LLM — Gemini** | Gemini 2.5 Pro / Flash / Flash-Lite — parallel function calling, responseSchema, Google Search Grounding |
| **Search — Gemini** | GOOGLE_SEARCH (ADK built-in) / googleSearch grounding — included quota, citation-backed |
| **Search — OpenAI** | web_search_preview hosted tool — included quota, native |
| **Browser Automation** | Playwright |
| **Email** | imapflow (IMAP) + nodemailer (SMTP) |
| **Calendar** | tsdav (CalDAV) |
| **PDF** | pdfkit, pdf-parse |
| **External Integrations** | Model Context Protocol (MCP) |
| **Testing** | Vitest |
| **Schema Validation** | Zod |
| **OpenAPI** | `zod-to-json-schema` — auto-generated from Zod schemas |

---

## 📁 Project Structure

```
jak-swarm/
├── apps/
│   ├── api/                     # Fastify REST API (port 4000)
│   │   └── src/
│   │       ├── routes/           # Route modules (workflows, approvals, audit, compliance, ...)
│   │       ├── services/         # Business logic (audit, compliance, swarm-execution, ...)
│   │       ├── middleware/       # Auth, RBAC, rate limiting
│   │       └── openapi/         # Zod → JSON Schema → OpenAPI spec
│   └── web/                     # Next.js 16 dashboard (port 3000)
│       └── src/app/(dashboard)/ # 26 dashboard pages
├── packages/
│   ├── adk/                      # 🆕 Google ADK orchestration (JAK_ADK_MODE=1)
│   │   ├── bridge/              # JAK → ADK tool bridge (FunctionTool, GOOGLE_SEARCH)
│   │   ├── agents/              # LlmAgent wrappers for Commander, Planner, Workers, Verifier
│   │   ├── deploy/              # Agent Engine gateway (agent-engine-entry.ts, resource ID)
│   │   ├── orchestration/       # SequentialAgent + ParallelAgent pipeline + Runner bridge
│   │   └── types/               # Type augmentation for @google/adk v1.2.0
│   ├── agents/                  # 38 agent implementations
│   │   ├── base/                # BaseAgent (decomposed: llm-call, prompt-builder, tool-execution)
│   │   ├── roles/               # 6 orchestrator agents
│   │   ├── workers/             # 32 worker agents
│   │   └── runtime/             # OpenAI + Gemini runtime adapters + grounding config
│   ├── tools/                   # 122 tool implementations
│   │   ├── registry/            # Singleton ToolRegistry + approval policy
│   │   ├── builtin/             # Built-in + sandbox tools
│   │   ├── adapters/            # Email, Calendar, CRM, Browser, Memory
│   │   └── mcp/                 # MCP client + bridge + provider configs
│   ├── swarm/                   # Orchestration engine
│   │   ├── graph/               # LangGraph nodes + task scheduler
│   │   ├── runner/              # SwarmRunner execution loop
│   │   ├── state/               # Immutable SwarmState
│   │   └── supervisor/          # Event bus, circuit breakers, telemetry
│   ├── db/                      # Prisma schema, migrations, seed
│   ├── security/                # Audit logging, RBAC, guardrails, encryption
│   ├── client/                  # @jak-swarm/client TypeScript SDK
│   ├── shared/                  # Shared types, enums, skills parser
│   ├── voice/                   # Voice pipeline (WebRTC, STT, TTS)
│   ├── verification/            # Email/document/transaction verification
│   ├── industry-packs/           # 13 industry-specific agent configurations
│   └── workflows/               # Temporal workflow definitions (optional)
├── tests/
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
├── docker/                      # Docker Compose for Postgres, Redis
├── scripts/                     # Dev scripts, doctor, setup
└── docs/                        # Documentation
```

---

## 🔐 Security

| Risk Level | Examples | Approval Required |
|:-----------|:---------|:-----------------:|
| 🟢 `READ_ONLY` | web_search, file_read, list_calendar | Never |
| 🟡 `DRAFT_ONLY` | draft_email, create_calendar_event (uncommitted) | Never |
| 🟡 `SANDBOX_EDIT` | Browser ops within sandbox | Configurable |
| 🟠 `LOCAL_EXEC_ALLOWLIST` | Code execution, file write (allowlisted tools) | Configurable |
| 🟠 `EXTERNAL_ACTION_APPROVAL` | send_email, send_webhook, post_slack | Always |
| 🔴 `CRITICAL_MANUAL_ONLY` | delete records, credential rotation, production deploys | Always |

- **AES-256-GCM** field-level encryption available for sensitive workflow data; tenant secrets are protected through environment secret storage, Supabase Vault, and Google Secret Manager where deployed
- **JWT** auth with per-tenant isolation enforced at middleware level
- **bcrypt** password hashing (12 rounds)
- **PII redaction** at LLM boundary and at write time
- **5-layer hallucination detection** (heuristic/regex-based) on every agent output: grounding check, invented statistics, fabricated sources, overconfidence, impossible claims
- **RBAC** roles: `END_USER` < `REVIEWER` < `OPERATOR` < `TENANT_ADMIN` < `SYSTEM_ADMIN` + `EXTERNAL_AUDITOR`

Full security policy: [`SECURITY.md`](SECURITY.md)

---

## 🛠️ Development

```bash
pnpm test                  # Run all tests (2154 blocking CI)
pnpm typecheck             # Type checking (strict mode, zero errors)
pnpm lint                  # Lint
pnpm check:truth           # Verify tool classifications + landing claims
pnpm audit:tools           # Audit all 122 tools against registry

# Run specific package tests
pnpm --filter @jak-swarm/agents test
pnpm --filter @jak-swarm/tools test
pnpm --filter @jak-swarm/swarm test
pnpm --filter @jak-swarm/adk test
```

### Adding a New Agent

1. Create `packages/agents/src/workers/your-agent.ts` (follow `growth.agent.ts` pattern)
2. Export from `packages/agents/src/index.ts`
3. Add `AgentRole.WORKER_YOUR_ROLE` to `packages/shared/src/types/agent.ts`
4. Add case to `createWorkerAgent()` in `packages/swarm/src/graph/nodes/worker/agent-factory.ts`
5. Add case to `buildTaskInput()` in `packages/swarm/src/graph/nodes/worker/task-input-builders.ts`
6. Add `infer*Action()` in `packages/swarm/src/graph/nodes/worker/intent-inference/text.ts`
7. Add role description to `packages/agents/src/roles/planner.agent.ts`
8. Run `pnpm turbo build` to verify

### Adding a New Tool

1. Add `toolRegistry.register(metadata, executor)` in `packages/tools/src/builtin/index.ts`
2. Define `inputSchema` / `outputSchema` (JSON Schema)
3. Set `riskClass` (`READ_ONLY` → `CRITICAL_MANUAL_ONLY`) and `maturity` label
4. Run `pnpm turbo build` to verify

### Adding a New LLM Provider

Follow the `GeminiRuntime` adapter pattern: create a runtime adapter that converts message shapes, map tool definitions, and translate responses back. Wire it through `BaseAgent.setContextOverride()`. See [`gemini-runtime.ts`](packages/agents/src/runtime/gemini-runtime.ts) as reference.

### Using Google ADK Orchestration

Set `JAK_ADK_MODE=1` in your `.env`. Workflows will route through `@google/adk`'s `SequentialAgent` + `ParallelAgent` pipeline instead of LangGraph. Falls back to LangGraph on ADK error. See [`packages/adk/`](packages/adk/) for architecture details.

---

## 📚 Documentation

| Doc | Description |
|:----|:-----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full system architecture, data model, error handling, scaling |
| [`AGENTS.md`](AGENTS.md) | Every agent role: purpose, input/output contracts, handoff logic |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting, SLA, scope, cryptographic assumptions |
| [`docs/jak-shield-manifest.md`](docs/jak-shield-manifest.md) | Local policy defenses (claim-to-code mapping) — JAK Shield is a separate 10-stage MCP gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) |
| [`docs/audit-compliance-agent-pack.md`](docs/audit-compliance-agent-pack.md) | Audit & Compliance product overview |
| [`docs/audit-framework-library.md`](docs/audit-framework-library.md) | Per-framework + per-control reference (SOC 2, HIPAA, ISO 27001) |
| [`docs/audit-api.md`](docs/audit-api.md) | Audit endpoint reference + error codes + SSE channel |
| [`docs/audit-workpapers.md`](docs/audit-workpapers.md) | Workpaper generation + approval flow |
| [`docs/beta-release.md`](docs/beta-release.md) | Beta scope, go/no-go checklist, production readiness |
| [`docs/team-and-trial.md`](docs/team-and-trial.md) | Team hierarchy, free trial, daily caps |
| [`docs/connector-runtime.md`](docs/connector-runtime.md) | Connector Runtime design + phase status |
| [`docs/vibe-coding.md`](docs/vibe-coding.md) | Vibe Coding pipeline, cost tables, feature comparison |
| [`docs/faq.md`](docs/faq.md) | Full FAQ — product, trial, security, integrations, costs |
| [`docs/api-reference.md`](docs/api-reference.md) | Complete API endpoint reference |
| [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md) | Google Cloud Run deployment guide for live API and pending Worker rollout |
| [`docs/environment-setup.md`](docs/environment-setup.md) | Environment variables, integration setup, troubleshooting |
| [`docs/agent-run-cockpit.md`](docs/agent-run-cockpit.md) | Cockpit audit event vocabulary |
| [`docs/competitive-positioning.md`](docs/competitive-positioning.md) | Market positioning analysis |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Long-term vision, 5-layer Company OS evolution, honest scope boundaries |
| [`docs/EVOLUTION-PLAN.md`](docs/EVOLUTION-PLAN.md) | Next-evolution architecture — JAK Shield MCP integration, Agent Governance Overlay, Company Memory, Agent Forge, Commander Coach, Ability Packs, Autonomy Ladder, 11-phase implementation roadmap |

---

## ❓ Common Questions

<details>
<summary><b>Is JAK Swarm production-ready?</b></summary>

**This is a working challenge build.** The architecture is solid (LangGraph + ADK + Postgres checkpointer + signed evidence bundles + JAK Shield local policy controls). 2,154 blocking CI tests (1,764 unit + 390 integration). Zero TypeScript errors under strict mode.

**Enterprise SLA packaging, expanded observability, and production hardening are part of the post-challenge roadmap.** Specific items on that roadmap: live-hosted smoke tests, third-party security audit/certification, lawyer-reviewed ToS/DPA, pen test, AuditLog row chain-hashing, and incident-response runbook.

Full checklist: [`docs/beta-release.md`](docs/beta-release.md).

</details>

<details>
<summary><b>Does JAK have SOC 2 / HIPAA / ISO 27001 certification?</b></summary>

**No.** The *infrastructure* is shipped (182 controls seeded, 108 operationally backed, HMAC-signed evidence bundles, External Auditor Portal) — everything an external auditor needs. The actual third-party attestation has not happened. We deliberately avoid phrases that imply certification we don't have.

</details>

<details>
<summary><b>Can I self-host?</b></summary>

**Yes.** MIT-licensed, the code is here. Docker for Postgres + Redis, an API key, Node 20+, pnpm 9+. No cloud-only feature — the same code that runs at jakswarm.com is what you self-host.

</details>

<details>
<summary><b>What is Google ADK orchestration?</b></summary>

Google's Agent Development Kit (`@google/adk`) provides `SequentialAgent`, `ParallelAgent`, and `LlmAgent` primitives for building multi-agent workflows. When `JAK_ADK_MODE=1`, JAK routes workflows through ADK's orchestration instead of LangGraph. The output shape is identical (SwarmState) so persistence, SSE, and approval flows work unchanged. ADK's built-in `GOOGLE_SEARCH` tool provides citation-backed web search for Gemini agents (included quota; see [Gemini pricing](https://ai.google.dev/pricing) for limits beyond the allowance).

</details>

<details>
<summary><b>Do I need Serper or Tavily for web search?</b></summary>

**No.** When `GEMINI_GOOGLE_SEARCH_GROUNDING=1`, Gemini agents use Google Search Grounding (built-in with included quota). When `OPENAI_WEB_SEARCH=1`, OpenAI agents use `web_search_preview` (built-in with included quota). Both provide real-time web search without any external search API keys. If neither flag is set, JAK falls back to its built-in `web_search` tool (which can optionally use Serper for enhanced results).

</details>

Full FAQ: [`docs/faq.md`](docs/faq.md)

---

## 📄 License

MIT — free for commercial and personal use. See [`LICENSE`](LICENSE).

---

<div align="center">

**Built with ❤️ by [InBharat AI](https://github.com/inbharatai)**

[Website](https://jakswarm.com) · [Quick Start](#-quick-start) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [FAQ](docs/faq.md)

[![GitHub stars](https://img.shields.io/github/stars/inbharatai/jak-swarm?style=social)](https://github.com/inbharatai/jak-swarm)
[![Twitter Follow](https://img.shields.io/twitter/follow/inbharatai?style=social)](https://twitter.com/inbharatai)

</div>
