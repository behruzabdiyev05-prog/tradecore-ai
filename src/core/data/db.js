/**
 * Shared data-access layer. All modules go through here so queries,
 * error handling and RLS-scoping stay consistent.
 * Phase 2A: every query is scoped to an organization (orgId); RLS enforces membership.
 */
import { supabase } from '../auth/supabaseClient.js';
import { createEventBus } from './eventBus.js';

export class DataError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DataError';
    this.cause = cause;
  }
}

function requireClient() {
  if (!supabase) throw new DataError('db.not_configured');
  return supabase;
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw new DataError(error.message, error);
  return data;
}

export const db = {
  /** Consolidated + per-module finance summary from the `finance_module_summary` view. */
  financeSummary: (orgId) =>
    run(requireClient().from('finance_module_summary').select('*').eq('org_id', orgId)),

  /** Transactions since a date (YYYY-MM-DD), minimal columns, for time series. */
  transactionsSince: async (orgId, fromDate) => {
    const rows = await run(
      requireClient().from('financial_transactions')
        .select('module_key, kind, amount_base_minor, occurred_on')
        .eq('org_id', orgId)
        .gte('occurred_on', fromDate),
    );
    return rows.map((r) => ({
      moduleKey: r.module_key, kind: r.kind, amountBaseMinor: Number(r.amount_base_minor), occurredOn: r.occurred_on,
    }));
  },

  /** Count of saved items across all modules of the organization. */
  savedItemsCount: async (orgId) => {
    const { count, error } = await requireClient().from('saved_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
    if (error) throw new DataError(error.message, error);
    return count ?? 0;
  },

  recentEvents: (orgId, limit = 20) =>
    run(requireClient().from('module_events').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit)),

  savedItems: (orgId, moduleKey) =>
    run(requireClient().from('saved_items').select('*').eq('org_id', orgId).eq('module_key', moduleKey).order('created_at', { ascending: false })),

  logActivity: (entry) =>
    run(requireClient().from('activity_log').insert(entry)),
};

/** App-wide event bus; persisted events go to `module_events` (org = the user's active organization, set by the DB). */
export const eventBus = createEventBus({
  persist: (event) =>
    run(
      requireClient().from('module_events').insert({
        source_module: event.source,
        target_module: event.target,
        event_type: event.type,
        entity_type: event.entityType ?? null,
        entity_id: event.entityId ?? null,
        payload: event.payload,
      }),
    ),
});
