# JackOps — Amazon Aurora PostgreSQL Setup (H0)

The H0 demo uses **Amazon Aurora PostgreSQL** as its only database. No
Supabase, no Cloud Run, no Railway.

## 1. Create the Aurora cluster

1. In the AWS Console, open **RDS → Create database**.
2. Engine: **Amazon Aurora (PostgreSQL-compatible)**.
3. Choose a template (Production or Dev/Test). For the hackathon, a
   serverless-capable Aurora PostgreSQL cluster is fine.
4. Set master credentials (username + password). Save the password.
5. Create a database inside the cluster, e.g. `jackops`.
6. In **Connectivity**, ensure the cluster is reachable from Vercel
   (publicly accessible + security group allowing Vercel egress, or use
   AWS Data API / a pooled proxy as appropriate).

## 2. Get the connection strings

You need two strings:

- **Pooled / proxy URL** → `DATABASE_URL` (used by Prisma for normal queries).
- **Direct URL** → `DIRECT_URL` (used by Prisma for migrations).

Format (with SSL, required by Aurora):

```
postgresql://USER:PASSWORD@AURORA_HOST:5432/jackops?sslmode=require
```

For Aurora Serverless v2 / clustered endpoints, use the cluster writer
endpoint for `DIRECT_URL` and a proxy/pooler endpoint for `DATABASE_URL` if
available. If you only have one endpoint, set both to the same value.

## 3. Configure environment variables (Vercel)

Project → Settings → Environment Variables (Production, and Preview/Dev as
needed):

```
H0_DEMO_MODE=true
NEXT_PUBLIC_H0_DEMO_MODE=true
NEXT_PUBLIC_APP_NAME=JackOps
NEXT_PUBLIC_APP_URL=https://your-vercel-url.vercel.app
DATABASE_URL=postgresql://USER:PASSWORD@AURORA_HOST:5432/jackops?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@AURORA_HOST:5432/jackops?sslmode=require
OPENAI_API_KEY=        (optional)
GEMINI_API_KEY=        (optional)
```

## 4. Run migrations against Aurora

From the repo root (requires `DATABASE_URL` and `DIRECT_URL` in your shell
environment):

```bash
pnpm install
pnpm --filter @jak-swarm/db db:generate
pnpm --filter @jak-swarm/db db:migrate:deploy
```

`db:migrate:deploy` applies the existing Prisma migrations to Aurora and is
safe to re-run (idempotent).

## 5. Seed the demo workspace

```bash
pnpm h0:seed
pnpm h0:check   # verifies connection + seed
```

## 6. Vercel build command

Set Vercel's **Build Command** so the Prisma client is generated before the
Next.js build:

```
pnpm --filter @jak-swarm/db db:generate && pnpm build
```

(Or rely on the per-package `prebuild` step; the explicit command above is the
most reliable on Vercel.)

## Notes

- The schema is the existing Prisma schema at
  `packages/db/prisma/schema.prisma`. No new tables are created for the H0 demo.
- If direct Aurora connections from Vercel serverless are flaky, keep DB calls
  light (the H0 slice only does small reads/writes) and prefer a pooled
  endpoint for `DATABASE_URL`. Do not introduce a new backend platform to
  work around this.