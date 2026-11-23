import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../i18n/index.js';
import { db } from '../data/db.js';
import { useOrg } from '../org/OrgProvider.jsx';
import { consolidate } from './summary.js';

export { mapSummaryRow, consolidate } from './summary.js';

/**
 * Real finance data of the active organization (AZN minor units).
 * @param {string|null|undefined} moduleKey undefined = consolidated; string = one module
 */
export function useFinanceSummary(moduleKey) {
  const { orgId } = useOrg();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await db.financeSummary(orgId);
      const scoped = moduleKey === undefined ? rows : rows.filter((r) => r.module_key === moduleKey);
      setState({ loading: false, error: null, data: { total: consolidate(scoped), rows } });
    } catch (err) {
      setState({ loading: false, error: errorText(err), data: null });
    }
  }, [moduleKey, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
