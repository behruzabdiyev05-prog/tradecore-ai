/**
 * After a new deploy, an open tab still runs the previous build and asks for
 * code files that no longer exist ("Failed to fetch dynamically imported module").
 * Reload the page once so the tab picks up the new build; never loop.
 */
const KEY = 'tc.chunkReloadAt';

export function isStaleChunkError(err) {
  const m = String(err?.message ?? err ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(m);
}

/** Reload once (not again within 30 s). Returns true when a reload was started. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage unavailable: still reload once per error */ }
  window.location.reload();
  return true;
}

/** Wrap a dynamic import: on a stale-build error reload the page instead of failing. */
export function withReload(loader) {
  return loader().catch((err) => {
    if (typeof window !== 'undefined' && isStaleChunkError(err) && reloadForNewBuild()) {
      return new Promise(() => {});   // the page is reloading
    }
    throw err;
  });
}

/** Vite fires this when a preloaded file of the current build is missing. */
export function installStaleChunkHandler() {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
