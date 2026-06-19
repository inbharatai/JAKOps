import type { NextConfig } from 'next';
import path from 'node:path';

// pnpm monorepo: `@jak-swarm/shared` is a workspace symlink that points outside
// `apps/web` (../../packages/shared), and `next` is resolved from the hoisted
// node_modules. Turbopack must therefore use the monorepo root as its project
// root, otherwise Next 16 Turbopack mis-infers the workspace root and fails with
// "couldn't find the Next.js package (next/package.json)". See
// https://github.com/vercel/next.js/issues/92540 — the fix is to set
// turbopack.root (and outputFileTracingRoot, so Vercel traces the workspace
// packages into the serverless function) to the monorepo root explicitly.
const monorepoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  typedRoutes: false,
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000',
  },
};

export default nextConfig;
