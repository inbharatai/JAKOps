import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/llm — the LLM provider configuration the chat sidebar reads
 * on mount (useSWR) to render the Agent/Gemini runtime toggle. Returns which
 * providers have a key configured (server-side env) + the preferred provider.
 * The cockpit's `apiFetch` does NOT unwrap an envelope, so we return the full
 * `{ success, data }` shape `SidebarLlmResponse` expects.
 *
 * Demo workspace — no auth.
 */
export async function GET() {
  const openaiConfigured = Boolean(process.env['OPENAI_API_KEY']?.trim());
  const geminiConfigured = Boolean(process.env['GEMINI_API_KEY']?.trim());

  return NextResponse.json({
    success: true,
    data: {
      providers: [
        { providerKey: 'openai', configured: openaiConfigured },
        { providerKey: 'gemini', configured: geminiConfigured },
      ],
      canViewProviderIdentity: true,
      preferredProvider: openaiConfigured ? 'openai' : geminiConfigured ? 'gemini' : 'openai',
    },
  });
}