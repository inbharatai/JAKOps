import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/settings/llm/preferred-provider — the Agent/Gemini runtime toggle
 * in the chat sidebar. On this serverless deployment the preferred provider is
 * a per-run choice made by `pickLlm()` (OpenAI preferred, Gemini fallback), so
 * we accept the selection and echo back the updated config so the sidebar's
 * optimistic update sticks without a 404. (A durable server-side preference
 * store is out of scope for the demo.)
 *
 * Demo workspace — no auth.
 */
export async function PUT(request: Request) {
  let body: { provider?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const provider =
    typeof body.provider === 'string' && (body.provider === 'openai' || body.provider === 'gemini')
      ? body.provider
      : 'openai';

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
      preferredProvider: provider,
    },
  });
}