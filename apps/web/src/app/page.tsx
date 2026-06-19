import MarketingHomePage from '@/components/landing/MarketingHomePage';

/**
 * Root route — the JackOps landing page (product pitch).
 *
 * In H0 demo mode the landing is shown to judges as the product pitch, with a
 * sticky "Launch H0 Demo" banner that links straight to the preconfigured demo
 * workspace at /h0 (no signup). Auth/sign-in routes (/login, /register, /trial,
 * /onboarding, /auth/*) are still redirected to /h0 by apps/web/src/proxy.ts, so
 * no login or sign-up UI is ever reachable in the demo — every CTA funnels to
 * /h0 in one click. Outside demo mode the same landing renders as the public
 * marketing page.
 *
 * H0 demo mode skips authentication for judge/demo access only. Do not enable
 * in production.
 */
const supabaseConfigured = Boolean(
  process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
);
const demoMode =
  process.env['H0_DEMO_MODE'] === 'true' ||
  process.env['NEXT_PUBLIC_H0_DEMO_MODE'] === 'true' ||
  !supabaseConfigured;

export default function RootPage() {
  return (
    <>
      {demoMode ? (
        <div
          role="region"
          aria-label="H0 demo launcher"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 60,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '0.6rem 1rem',
            background:
              'linear-gradient(90deg, rgba(52,211,153,0.22), rgba(251,191,36,0.22))',
            borderBottom: '1px solid rgba(255,255,255,0.14)',
            color: '#f8fafc',
            fontSize: '0.9rem',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <strong style={{ fontWeight: 600 }}>
            H0 Demo · Vercel + Amazon Aurora PostgreSQL
          </strong>
          <a
            href="/h0"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderRadius: '0.5rem',
              padding: '0.35rem 0.95rem',
              fontWeight: 600,
              color: '#09090b',
              textDecoration: 'none',
              background: 'linear-gradient(135deg, #34d399, #fbbf24)',
            }}
          >
            ▶ Launch H0 Demo
          </a>
        </div>
      ) : null}
      <MarketingHomePage />
    </>
  );
}