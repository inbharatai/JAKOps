import type { Metadata } from 'next';
import H0Dashboard from './H0Dashboard';

export const metadata: Metadata = {
  title: 'JackOps — AI Operations Command Center (H0 Demo)',
  description:
    'JackOps is an AI operations command center for startups and SMEs. Run, monitor, approve, secure, audit, and replay AI-agent workflows from one dashboard. H0 demo on Vercel + Amazon Aurora PostgreSQL.',
  openGraph: {
    title: 'JackOps — AI Operations Command Center',
    description:
      'Run, monitor, approve, secure, audit, and replay AI-agent workflows. Vercel + Amazon Aurora PostgreSQL.',
    type: 'website',
    siteName: 'JackOps',
  },
};

export default function H0Page() {
  return <H0Dashboard />;
}