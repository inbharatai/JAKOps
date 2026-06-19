# JackOps — H0 Architecture

JackOps is an AI operations command center for startups and SMEs. It helps
companies run, monitor, approve, secure, audit, and replay AI-agent workflows
from one dashboard. This is the H0 (Hack the Zero Stack with Vercel v0 and AWS
Databases) build — a self-contained demo slice running entirely on Vercel +
Amazon Aurora PostgreSQL.

## Request / data flow

```
User (judge, no signup)
  → Vercel Next.js Dashboard (/h0)
  → Preconfigured Demo Workspace (tenantId: h0-demo-tenant, user: judge@jackops.demo)
  → Vercel API Routes / Server Actions (/api/h0/*)
  → Amazon Aurora PostgreSQL through Prisma (DATABASE_URL / DIRECT_URL)
  → JackOps Workflow Records (workflows, agent_traces, approval_requests)
  → Agent Traces + Approval Requests + Audit Logs + Security Decisions
  → Dashboard Replay (metrics, timeline, approvals, audit, cost ledger)
```

Optional side branch: a Vercel server route may call OpenAI or Gemini for one
short business output when `OPENAI_API_KEY` / `GEMINI_API_KEY` is set. If a key
is missing or the call fails, the demo falls back to deterministic output — the
dashboard never breaks.

## What is NOT used for the H0 demo

- **No Cloud Run** — the H0 slice does not call the legacy Fastify API.
- **No Railway** — the H0 slice deploys on Vercel.
- **No Supabase** — auth and database are Aurora + a preconfigured demo
  workspace. Supabase code remains as disabled legacy only.
- **No login/signup** — `H0_DEMO_MODE=true` resolves all user/session
  requirements to the demo workspace. (Public wording: "preconfigured demo
  workspace for instant judge access." Code comments say: "H0 demo mode skips
  authentication for judge/demo access only. Do not enable in production.")

## Components

| Layer | Path | Notes |
| --- | --- | --- |
| Dashboard UI | `apps/web/src/app/h0/page.tsx`, `H0Dashboard.tsx` | Client component; fetches `/api/h0/*` |
| Demo mode helper | `apps/web/src/lib/h0-demo.ts` | `isH0DemoMode()`, demo tenant/user constants |
| Prisma adapter | `apps/web/src/lib/db.ts` | Thin `@prisma/client` singleton, Vercel-serverless safe |
| Summary API | `apps/web/src/app/api/h0/summary/route.ts` | Aggregate metrics from Aurora |
| Workflows API | `apps/web/src/app/api/h0/workflows/route.ts` | List workflows |
| Workflow detail | `apps/web/src/app/api/h0/workflows/[id]/route.ts` | Agent timeline + tokens |
| Run demo | `apps/web/src/app/api/h0/workflows/run-demo/route.ts` | Writes a full workflow to Aurora |
| Approvals | `apps/web/src/app/api/h0/approvals/route.ts` | Approval queue |
| Audit | `apps/web/src/app/api/h0/audit/route.ts` | Audit replay |
| Security events | `apps/web/src/app/api/h0/security-events/route.ts` | Shield decisions |
| Seed | `scripts/seed-h0-demo.ts` | Idempotent demo data |
| Check | `scripts/check-h0-demo.ts` | Verifies Aurora + seed |

## Data model (reuses existing Prisma schema)

No new tables were created. The H0 demo stores its data in existing models:

- `Tenant` / `User` — the preconfigured demo workspace.
- `Workflow` — `goal`, `status`, `totalCostUsd`, `finalOutput`, plus
  `planJson`/`stateJson` for risk level and demo-safe flags.
- `AgentTrace` — per-step timeline + `tokenUsage`.
- `ApprovalRequest` / `ApprovalAuditLog` — approval gate + decision history.
- `AuditLog` — replay evidence; security/governance decisions are stored as
  rows with `action` starting with `SECURITY` (and WARN/CRITICAL severity).
- `TenantMemory` — cost ledger + security policy (JSON `value`).

## Security & demo safety

In H0 demo mode the app never performs real external writes. Risky actions
(external email, Slack, GitHub, CRM, payments, destructive automation) are
classified HIGH risk, blocked from auto-execution, converted to an approval
request, marked demo-safe, and logged as a `SECURITY_DECISION` audit event that
surfaces in the audit replay. No real emails are ever sent.