/**
 * Module: used-goods — built on the shared opportunity screens (table `opportunities`).
 * Fields used by this module are listed below; labels live in the dictionaries (op.used-goods.*).
 */
import OpportunityModule from '../_shared/OpportunityModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('used-goods');
const CFG = { key: 'used-goods', fields: ['condition', 'origin', 'target', 'buy', 'shipping', 'repair', 'other', 'feePercent', 'feeFixed', 'sell'] };

export default function Module() {
  return <OpportunityModule module={MODULE} cfg={CFG} />;
}
