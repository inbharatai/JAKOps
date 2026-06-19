import { redirect } from 'next/navigation';
import MarketingHomePage from '@/components/landing/MarketingHomePage';

/**
 * Root route.
 * When H0 demo mode is enabled (NEXT_PUBLIC_H0_DEMO_MODE=true) the deployed
 * Vercel URL immediately redirects judges to the preconfigured demo workspace
 * at /h0 — no signup required. Otherwise the marketing landing page renders.
 */
export default function RootPage() {
  if (process.env['NEXT_PUBLIC_H0_DEMO_MODE'] === 'true') {
    redirect('/h0');
  }
  return <MarketingHomePage />;
}