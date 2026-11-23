import { error, getEnv } from './http.mjs';

/**
 * Verify the caller's Supabase access token by asking Supabase Auth.
 * Returns [user, null] on success or [null, Response] on failure.
 */
export async function requireUser(req, { fetchImpl = fetch } = {}) {
  const url = getEnv('SUPABASE_URL');
  const anon = getEnv('SUPABASE_ANON_KEY');
  if (!url || !anon) return [null, error(503, 'AUTH_NOT_CONFIGURED', 'Server autentifikasiyası konfiqurasiya olunmayıb')];

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return [null, error(401, 'UNAUTHENTICATED', 'Daxil olmaq tələb olunur')];

  let res;
  try {
    res = await fetchImpl(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
  } catch {
    return [null, error(502, 'AUTH_UNREACHABLE', 'Autentifikasiya serverinə qoşulmaq olmadı')];
  }
  if (res.status === 401 || res.status === 403) return [null, error(401, 'INVALID_TOKEN', 'Sessiya etibarsızdır və ya bitib')];
  if (!res.ok) return [null, error(502, 'AUTH_ERROR', 'Autentifikasiya yoxlanışı uğursuz oldu')];

  const user = await res.json();
  if (!user?.id) return [null, error(401, 'INVALID_TOKEN', 'Sessiya etibarsızdır')];
  return [{ id: user.id, email: user.email, token }, null];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const ACCESS_ERRORS = {
  not_member: [403, 'NOT_MEMBER', 'Bu şirkətin üzvü deyilsiniz'],
  suspended: [403, 'MEMBER_SUSPENDED', 'Üzvlüyünüz dayandırılıb'],
  org_inactive: [403, 'ORG_INACTIVE', 'Şirkət aktiv deyil'],
  forbidden: [403, 'FORBIDDEN', 'Bu əməliyyat üçün icazəniz yoxdur'],
  // Phase 2B: the organization requires 2FA for the caller's role and this session has none
  mfa_required: [403, 'MFA_REQUIRED', 'Bu şirkət iki addımlı giriş tələb edir'],
};

/**
 * Verify the caller is an active member of `orgId` (default: their active organization)
 * holding every permission in `permissions`.
 * The check runs in Supabase with the CALLER'S OWN token (RPC `check_access`), so RLS and
 * membership are enforced by the database — no service-role key is used.
 * Returns [{ user, orgId }, null] or [null, Response].
 */
export async function requireMember(req, orgId, permissions = [], deps = {}) {
  const { fetchImpl = fetch } = deps;
  const [user, authError] = await requireUser(req, deps);
  if (authError) return [null, authError];
  // orgId omitted → the caller's active organization (resolved in the database)
  if (orgId != null && orgId !== '' && !isUuid(orgId)) return [null, error(400, 'NO_ORG', 'Şirkət (orgId) yanlışdır')];
  if (orgId === '') orgId = null;

  const url = getEnv('SUPABASE_URL').replace(/\/$/, '');
  let res;
  try {
    res = await fetchImpl(`${url}/rest/v1/rpc/check_access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.token}`,
        apikey: getEnv('SUPABASE_ANON_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_org: orgId, p_keys: permissions }),
    });
  } catch {
    return [null, error(502, 'AUTH_UNREACHABLE', 'İcazə yoxlanışı aparıla bilmədi')];
  }
  if (!res.ok) return [null, error(502, 'AUTH_ERROR', 'İcazə yoxlanışı uğursuz oldu')];
  const status = await res.json();
  if (status === 'ok') return [{ user, orgId }, null];
  const [code, name, message] = ACCESS_ERRORS[status] ?? ACCESS_ERRORS.forbidden;
  return [null, error(code, name, message)];
}
