/**
 * H0 demo mode — preconfigured demo workspace for instant judge access.
 *
 * H0 demo mode skips authentication for judge/demo access only. Do not enable
 * in production. The flag is intentionally a separate switch from the legacy
 * DEV auth bypass so it can run on a deployed Vercel build without a Supabase
 * session or backend API.
 *
 * When H0_DEMO_MODE / NEXT_PUBLIC_H0_DEMO_MODE is true:
 *   - no login/signup page is required
 *   - no auth redirect blocks the app
 *   - `/` redirects to `/h0`
 *   - `/h0` renders directly and talks to Aurora via Prisma-backed API routes
 *   - login/signup buttons are hidden on the H0 surface
 */

export const H0_DEMO_TENANT_ID = 'h0-demo-tenant';
export const H0_DEMO_USER_ID = 'h0-demo-user';
export const H0_DEMO_USER_EMAIL = 'judge@jackops.demo';
export const H0_DEMO_COMPANY_NAME = 'H0 Demo Company';

export interface H0DemoUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName: string;
  industry: string;
}

export interface H0DemoWorkspace {
  tenantId: string;
  userId: string;
  email: string;
  companyName: string;
  tenantSlug: string;
  industry: string;
}

/** Server + client. Reads the public flag so it resolves identically on both. */
export function isH0DemoMode(): boolean {
  return (
    process.env['H0_DEMO_MODE'] === 'true' ||
    process.env['NEXT_PUBLIC_H0_DEMO_MODE'] === 'true'
  );
}

export function getH0DemoUser(): H0DemoUser {
  return {
    id: H0_DEMO_USER_ID,
    email: H0_DEMO_USER_EMAIL,
    name: 'H0 Judge',
    role: 'TENANT_ADMIN',
    tenantId: H0_DEMO_TENANT_ID,
    tenantName: H0_DEMO_COMPANY_NAME,
    industry: 'TECHNOLOGY',
  };
}

export function getH0DemoWorkspace(): H0DemoWorkspace {
  return {
    tenantId: H0_DEMO_TENANT_ID,
    userId: H0_DEMO_USER_ID,
    email: H0_DEMO_USER_EMAIL,
    companyName: H0_DEMO_COMPANY_NAME,
    tenantSlug: 'h0-demo',
    industry: 'TECHNOLOGY',
  };
}