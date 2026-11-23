import { config } from '../config/env.js';
import { t } from '../i18n/index.js';

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Call a Netlify Function via /api/<name>.
 * The user's Supabase access token is sent so the server can verify identity.
 */
export async function apiFetch(path, { method = 'GET', body, token, signal } = {}) {
  let res;
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(t('api.network'), { status: 0, code: 'NETWORK_ERROR' });
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(data?.error?.message ?? t('api.server_error', { status: res.status }), {
      status: res.status,
      code: data?.error?.code ?? (isJson ? 'HTTP_ERROR' : 'API_UNAVAILABLE'),
      details: data?.error?.details,
    });
  }
  if (!isJson) throw new ApiError(t('api.format'), { status: res.status, code: 'API_UNAVAILABLE' });
  return data;
}
