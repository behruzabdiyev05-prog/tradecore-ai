export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function error(status, code, message, details) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

export function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Metod dəstəklənmir' } }), {
    status: 405,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: allowed.join(', ') },
  });
}

/** Parse a JSON body with a size limit. Returns [data, errorResponse]. */
export async function readJson(req, maxBytes = 32_000) {
  const text = await req.text();
  if (text.length > maxBytes) return [null, error(413, 'PAYLOAD_TOO_LARGE', 'Sorğu çox böyükdür')];
  try {
    return [JSON.parse(text || '{}'), null];
  } catch {
    return [null, error(400, 'INVALID_JSON', 'Yanlış JSON formatı')];
  }
}

/** Read server-side env (works in Netlify runtime and in tests). */
export function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name] ?? '';
}
