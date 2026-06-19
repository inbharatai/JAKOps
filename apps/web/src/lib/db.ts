/**
 * Thin web-side Prisma adapter for the H0 demo slice.
 *
 * The H0 API routes read/write Amazon Aurora PostgreSQL through Prisma directly
 * from the Vercel Next.js server runtime — no external Fastify API, no Cloud Run,
 * no Railway, no Supabase database URL. Only DATABASE_URL / DIRECT_URL (Aurora).
 *
 * We import `@prisma/client` directly rather than the `@jak-swarm/db` workspace
 * package so the Vercel serverless build stays light and does not pull the
 * field-encryption extension or the broader monorepo runtime. The Prisma client
 * is generated from the shared schema at packages/db/prisma/schema.prisma
 * (run `pnpm --filter @jak-swarm/db db:generate` locally and as part of the
 * Vercel build command).
 *
 * Safe singleton for Vercel serverless: on hot reload / warm lambda reuse we
 * reuse a single PrismaClient on globalThis to avoid exhausting connections.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __h0Prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__h0Prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.__h0Prisma = prisma;
}