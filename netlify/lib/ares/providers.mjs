/**
 * ARES provider registry.
 *
 * A provider adapter implements:
 *   { id: string, model: string,
 *     complete({ system, context, history, message }) => Promise<{ reply: string, usage?: object }> }
 *
 * Phase 1 registers NO providers on purpose: until a real AI provider is
 * connected (Phase 6), ARES reports "not configured" instead of producing
 * placeholder answers.
 */
import { getEnv } from '../http.mjs';

const adapters = new Map();

export function registerProvider(id, factory) {
  adapters.set(id, factory);
}

/** Resolve the configured provider or null. */
export function getProvider() {
  const id = getEnv('ARES_PROVIDER');
  const apiKey = getEnv('ARES_PROVIDER_API_KEY');
  if (!id || !apiKey) return null;
  const factory = adapters.get(id);
  return factory ? factory({ apiKey }) : null;
}

export function providerStatus() {
  const id = getEnv('ARES_PROVIDER');
  const hasKey = Boolean(getEnv('ARES_PROVIDER_API_KEY'));
  return {
    configured: Boolean(id && hasKey && adapters.has(id)),
    provider: id || null,
    reason: !id ? 'ARES_PROVIDER təyin edilməyib'
      : !adapters.has(id) ? `"${id}" adapteri hələ qoşulmayıb (Phase 6)`
      : !hasKey ? 'API açarı server mühitində yoxdur'
      : null,
  };
}
