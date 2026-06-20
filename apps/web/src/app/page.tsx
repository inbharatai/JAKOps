import MarketingHomePage from '@/components/landing/MarketingHomePage';

/**
 * Root route — the JackOps landing page (product pitch).
 *
 * Auth is handled by apps/web/src/proxy.ts. In demo mode (Supabase not
 * configured / H0_DEMO_MODE) the proxy lets every request pass and redirects
 * any auth/sign-in route straight to the backend workspace, so the "Sign In"
 * CTA on this landing takes a visitor directly into the working cockpit — no
 * signup, no login form. Outside demo mode the same landing renders as the
 * public marketing page.
 */
export default function RootPage() {
  return <MarketingHomePage />;
}