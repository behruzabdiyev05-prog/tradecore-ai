/**
 * Cross-module data exchange bus.
 *
 *  - In-app: modules publish events; other modules (and ARES) subscribe.
 *  - Persistent: with `persist: true` the event is also written to the
 *    `module_events` table, so other sessions/devices and ARES can read it.
 *
 * Event type format: "<entity>.<action>" e.g. "supplier.saved", "deal.closed".
 */
import { isModuleKey } from '../../../shared/modules.js';

export const EVENT_TYPE_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

export function createEventBus({ persist } = {}) {
  const subscribers = new Set();

  function validate(evt) {
    if (!isModuleKey(evt.source)) throw new RangeError(`Naməlum mənbə modul: ${evt.source}`);
    if (evt.target != null && !isModuleKey(evt.target)) throw new RangeError(`Naməlum hədəf modul: ${evt.target}`);
    if (!EVENT_TYPE_RE.test(evt.type ?? '')) throw new RangeError(`Yanlış hadisə tipi: ${evt.type}`);
  }

  /**
   * @param {{source:string,target?:string|null,type:string,entityType?:string,entityId?:string,payload?:object}} evt
   * @param {{persist?: boolean}} [opts]
   */
  async function publish(evt, { persist: shouldPersist = false } = {}) {
    validate(evt);
    const event = { target: null, payload: {}, ...evt, at: new Date().toISOString() };
    for (const sub of [...subscribers]) {
      const f = sub.filter;
      if (f.type && f.type !== event.type) continue;
      if (f.source && f.source !== event.source) continue;
      // A subscriber scoped to a module receives broadcasts and events targeted at it.
      if (f.module && event.target && event.target !== f.module) continue;
      try {
        sub.handler(event);
      } catch (err) {
        console.error('[eventBus] subscriber error', err);
      }
    }
    if (shouldPersist) {
      if (!persist) throw new Error('Persist funksiyası konfiqurasiya olunmayıb');
      await persist(event);
    }
    return event;
  }

  /** @returns {() => void} unsubscribe */
  function subscribe(filter, handler) {
    const sub = { filter: filter ?? {}, handler };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }

  return { publish, subscribe, get size() { return subscribers.size; } };
}
