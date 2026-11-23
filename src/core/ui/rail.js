/**
 * Desktop sidebar rail: expanded / collapsed. Default collapsed.
 * Cached per browser (tc.rail.expanded, unchanged from Phase 1) and — since
 * Phase 2B — also saved in the profile preferences so it follows the user.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'tc.rail.expanded';
const listeners = new Set();

function read() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
let expanded = typeof window === 'undefined' ? false : read();

export function setRailPreference(value) {
  const v = Boolean(value);
  if (v === expanded) return;
  expanded = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
  for (const l of listeners) l();
}

export function useRail() {
  const value = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => expanded,
    () => expanded,
  );
  return [value, setRailPreference];
}
