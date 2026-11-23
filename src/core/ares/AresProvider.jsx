/**
 * ARES — client side of the central AI brain.
 *
 * One provider serves both the central ARES and every module-local assistant:
 * the only difference is `scope` (null = central, or a module key). All calls
 * go to the same server endpoint (/api/ares), which holds provider keys.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useOrg } from '../org/OrgProvider.jsx';
import { errorText } from '../i18n/index.js';

const AresContext = createContext(null);

const CENTRAL = '__central__';
let nextId = 1;

export function AresProvider({ children }) {
  const { accessToken } = useAuth();
  const { orgId } = useOrg();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(null); // null = central ARES
  const [threads, setThreads] = useState({}); // { [scopeKey]: Message[] }
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ state: 'checking' });

  const refreshStatus = useCallback(async () => {
    setStatus({ state: 'checking' });
    try {
      const s = await apiFetch('/ares');
      setStatus({ state: s.configured ? 'ready' : 'not_configured', ...s });
    } catch (err) {
      setStatus({ state: 'unavailable', message: errorText(err) });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const scopeKey = scope ?? CENTRAL;
  const messages = threads[scopeKey] ?? [];

  const append = useCallback((key, msg) => {
    setThreads((t) => ({ ...t, [key]: [...(t[key] ?? []), { id: nextId++, at: Date.now(), ...msg }] }));
  }, []);

  const send = useCallback(
    async (text) => {
      const content = text.trim();
      if (!content || pending) return;
      const key = scopeKey;
      const history = (threads[key] ?? []).filter((m) => m.role !== 'system').slice(-20)
        .map(({ role, content: c }) => ({ role, content: c }));
      append(key, { role: 'user', content });
      setPending(true);
      try {
        const res = await apiFetch('/ares', {
          method: 'POST',
          token: accessToken,
          body: { message: content, moduleKey: scope, history, orgId },
        });
        append(key, { role: 'assistant', content: res.reply, meta: res.meta });
      } catch (err) {
        append(key, { role: 'system', content: errorText(err), code: err.code });
      } finally {
        setPending(false);
      }
    },
    [scopeKey, scope, threads, pending, accessToken, orgId, append],
  );

  /** Open ARES, optionally scoped to a module ("module assistant"). */
  const openAres = useCallback((moduleKey = null) => {
    setScope(moduleKey);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, openAres, scope, setScope, messages, send, pending, status, refreshStatus }),
    [open, openAres, scope, messages, send, pending, status, refreshStatus],
  );
  return <AresContext.Provider value={value}>{children}</AresContext.Provider>;
}

export function useAres() {
  const ctx = useContext(AresContext);
  if (!ctx) throw new Error('useAres must be used inside <AresProvider>');
  return ctx;
}
