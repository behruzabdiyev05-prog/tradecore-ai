/**
 * Colour mode (light / dark). Default: light. Stored per browser and applied
 * as <html data-mode="…"> so CSS variables switch the whole UI at once.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'tc.mode';
export const MODES = ['light', 'dark'];
const listeners = new Set();

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

let current = typeof window === 'undefined' ? 'light' : read();

/** Apply the stored mode to <html> (call once before first render). */
export function applyMode(mode = current) {
  current = mode;
  if (typeof document !== 'undefined') document.documentElement.dataset.mode = mode;
}

export function setMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError(`Naməlum rejim: ${mode}`);
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
  applyMode(mode);
  for (const l of listeners) l();
}

export function useColorMode() {
  const mode = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => current,
  );
  return [mode, setMode];
}
