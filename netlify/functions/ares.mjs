/**
 * /api/ares — central ARES endpoint (one intelligence layer for all modules).
 *   GET  → configuration status (no secrets)
 *   POST → { message, moduleKey?, history? }  (authenticated)
 */
import { error, json, methodNotAllowed, readJson } from '../lib/http.mjs';
import { isUuid, requireMember, requireUser } from '../lib/auth.mjs';
import { buildContext } from '../lib/ares/context.mjs';
import { getProvider, providerStatus } from '../lib/ares/providers.mjs';
import { isModuleKey } from '../../shared/modules.js';

const MAX_MESSAGE = 4000;
const MAX_HISTORY = 20;

export function validateAresBody(body) {
  if (!body || typeof body !== 'object') return 'Sorğu boşdur';
  if (body.orgId != null && !isUuid(body.orgId)) return 'Şirkət (orgId) yanlışdır';
  if (typeof body.message !== 'string' || !body.message.trim()) return 'Mesaj boş ola bilməz';
  if (body.message.length > MAX_MESSAGE) return `Mesaj ${MAX_MESSAGE} simvoldan uzun ola bilməz`;
  if (body.moduleKey != null && !isModuleKey(body.moduleKey)) return 'Naməlum modul';
  if (body.history != null) {
    if (!Array.isArray(body.history) || body.history.length > MAX_HISTORY) return 'Yanlış söhbət tarixçəsi';
    const ok = body.history.every((h) => ['user', 'assistant'].includes(h?.role) && typeof h?.content === 'string');
    if (!ok) return 'Yanlış söhbət tarixçəsi';
  }
  return null;
}

export default async function handler(req, _context, deps = {}) {
  if (req.method === 'GET') {
    return json({ service: 'ARES', ...providerStatus() });
  }
  if (req.method !== 'POST') return methodNotAllowed(['GET', 'POST']);

  const [, authError] = await requireUser(req, deps);
  if (authError) return authError;

  const [body, parseError] = await readJson(req);
  if (parseError) return parseError;
  const invalid = validateAresBody(body);
  if (invalid) return error(400, 'VALIDATION_ERROR', invalid);

  // ARES works only inside an organization the caller belongs to (orgId, or their active org),
  // with ares.use — plus read access to the module whose context is requested.
  const perms = ['ares.use', ...(body.moduleKey ? [`module.${body.moduleKey}.read`] : [])];
  const [access, accessError] = await requireMember(req, body.orgId ?? null, perms, deps);
  if (accessError) return accessError;
  const user = access.user;

  const provider = getProvider();
  if (!provider) {
    const s = providerStatus();
    return error(503, 'ARES_NOT_CONFIGURED',
      'ARES hələ AI provayderinə qoşulmayıb. Bu, Phase 6-da aktivləşdiriləcək.', { reason: s.reason });
  }

  const context = buildContext(body.moduleKey ?? null);
  try {
    const result = await provider.complete({
      system: context.system,
      context,
      history: body.history ?? [],
      message: body.message.trim(),
      userId: user.id,
      orgId: access.orgId,
    });
    return json({
      reply: result.reply,
      meta: { provider: provider.id, model: provider.model, scope: context.scope, module: context.module?.key ?? null },
    });
  } catch (err) {
    console.error('[ares] provider error', err);
    return error(502, 'ARES_PROVIDER_ERROR', 'ARES cavab ala bilmədi. Bir az sonra yenidən cəhd edin.');
  }
}
