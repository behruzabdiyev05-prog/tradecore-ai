/**
 * Module: import-export — built on the shared opportunity screens (table `opportunities`).
 * Fields used by this module are listed below; labels live in the dictionaries (op.import-export.*).
 */
import OpportunityModule from '../_shared/OpportunityModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('import-export');
const CFG = { key: 'import-export', fields: ['direction', 'origin', 'target', 'buy', 'shipping', 'customs', 'tax', 'other', 'duty', 'importVat', 'feePercent', 'sell'] };

export default function Module() {
  return <OpportunityModule module={MODULE} cfg={CFG} />;
}
