/**
 * /api/integrations — status of planned external integrations (authenticated).
 * Reports only whether server-side credentials exist; never their values.
 * Real connections and sync are implemented in Phase 7.
 */
import { getEnv, json, methodNotAllowed } from '../lib/http.mjs';
import { requireMember } from '../lib/auth.mjs';
import { INTEGRATIONS } from '../../shared/integrations.js';

export default async function handler(req, _context, deps = {}) {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const orgId = new URL(req.url).searchParams.get('orgId');
  const [, accessError] = await requireMember(req, orgId, ['integrations.manage'], deps);
  if (accessError) return accessError;

  return json({
    integrations: INTEGRATIONS.map((i) => {
      const present = i.envKeys.filter((k) => Boolean(getEnv(k)));
      return {
        key: i.key,
        name: i.name,
        modules: i.modules,
        credentials: present.length === i.envKeys.length ? 'present' : present.length ? 'partial' : 'missing',
        // No adapter exists yet, so nothing is "connected" even if keys are present.
        status: 'not_implemented',
      };
    }),
  });
}
