'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppLayout } from './AppLayout';
import { useAuthSession } from '@/lib/auth-session';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useConversationStore } from '@/store/conversation-store';
import { isH0DemoMode } from '@/lib/h0-demo';

const AUTH_PATHS = ['/login', '/register', '/', '/forgot-password', '/reset-password', '/onboarding', '/privacy', '/terms', '/trial'];

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { user } = useAuthSession();
  const pathname = usePathname();
  const clearConversations = useConversationStore((s) => s.clearAll);
  const prevUserIdRef = useRef<string | null>(null);

  // ── Clear stale conversations on user identity change ──────────────
  // When the user logs in with a different email, localStorage still
  // holds conversations from the previous account. Those conversations
  // have no server-side data for the new user, causing a "blank
  // workspace" experience. Detect the user change and wipe the store.
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== null && currentId !== null && currentId !== prevUserIdRef.current) {
      // User identity changed — clear stale conversation data
      clearConversations();
    }
    prevUserIdRef.current = currentId;
  }, [user?.id, clearConversations]);

  // Hydration fix: defer the shell decision until after the first
  // client-side render. During SSR, `user` is always null (no session
  // on the server), so the server renders `<>{children}</>`. On the
  // client, `user` is populated from localStorage/session, causing a
  // structural hydration mismatch (React error #418). By waiting until
  // `mounted` is true, we ensure the server and client render the same
  // tree structure on the first pass, then switch to the authenticated
  // shell on the next render cycle.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Service-worker registration. Co-located here (already a client
  // component) instead of a raw `<script>` in layout.tsx — Next.js 16
  // emits a console error for any `<script>` element in render output,
  // and `useEffect` is the supported pattern.
  //
  // H0 demo: a persistent service worker is pure downside for a no-login
  // judge demo — it caches across deployments and can serve a stale/broken
  // page ("This page couldn't load") from a prior failed build even after a
  // new Ready deployment ships. So in demo mode (or on any /h0 route) we do
  // NOT register the SW, and we proactively unregister any existing SW +
  // clear its caches so a browser that previously cached a broken build
  // self-heals on the next load. Non-demo routes keep the original behavior.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const demoRoute = pathname === '/h0' || pathname?.startsWith('/h0/');
    if (isH0DemoMode() || demoRoute) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => {
          /* non-fatal */
        });
      if (window.caches) {
        caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys.filter((k) => k.startsWith('jak-swarm')).map((k) => caches.delete(k)),
            ),
          )
          .catch(() => {
            /* non-fatal */
          });
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[sw] registration failed (non-fatal):', err);
      });
    };
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
    return undefined;
  }, [pathname]);

  const isAuthPage = AUTH_PATHS.some(
    p => pathname === p,
  ) || pathname.startsWith('/auth/') || pathname.startsWith('/trial/');

  // Auth/landing pages always render without shell
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Before hydration completes, render the same structure as SSR:
  // no shell (unauthenticated view). This avoids the hydration mismatch.
  // After mounting, if the user is authenticated, switch to the shell.
  if (!mounted || !user) {
    return <>{children}</>;
  }

  // All authenticated routes use the chat-first AppLayout
  return (
    <ErrorBoundary>
      <AppLayout>{children}</AppLayout>
    </ErrorBoundary>
  );
}