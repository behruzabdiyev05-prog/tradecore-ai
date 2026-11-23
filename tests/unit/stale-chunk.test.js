import test from 'node:test';
import assert from 'node:assert/strict';

function fakeWindow() {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const w = { reloads: 0, location: { reload() { w.reloads += 1; } }, addEventListener() {} };
  globalThis.window = w;
  return w;
}

const { isStaleChunkError, withReload } = await import('../../src/core/ui/staleChunk.js');

test('stale build errors are recognised (Chrome, Safari, Firefox wording)', () => {
  assert.ok(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')));
  assert.ok(isStaleChunkError(new TypeError('Importing a module script failed.')));
  assert.ok(isStaleChunkError(new TypeError('error loading dynamically imported module')));
  assert.ok(!isStaleChunkError(new Error('Bu əməliyyat üçün icazəniz yoxdur')));
});

test('a stale chunk reloads the page once, never in a loop', async () => {
  const w = fakeWindow();
  const stale = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: x'));
  const pending = withReload(stale);                       // first time: reload, promise stays pending
  const raced = await Promise.race([pending.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 20))]);
  assert.equal(raced, 'pending');
  assert.equal(w.reloads, 1);
  await assert.rejects(withReload(stale), /dynamically imported/);   // again within 30 s: show the error
  assert.equal(w.reloads, 1);
});

test('other loader errors are not swallowed and do not reload', async () => {
  const w = fakeWindow();
  await assert.rejects(withReload(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(w.reloads, 0);
  assert.equal(await withReload(() => Promise.resolve('ok')), 'ok');
});
