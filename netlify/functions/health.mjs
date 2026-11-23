/** /api/health — liveness + which server-side services are configured (booleans only). */
import { getEnv, json, methodNotAllowed } from '../lib/http.mjs';
import { providerStatus } from '../lib/ares/providers.mjs';

export default async function handler(req) {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  return json({
    status: 'ok',
    service: 'tradecore-ai-api',
    version: '0.1.0',
    time: new Date().toISOString(),
    services: {
      supabaseAuth: Boolean(getEnv('SUPABASE_URL') && getEnv('SUPABASE_ANON_KEY')),
      ares: providerStatus().configured,
    },
  });
}
