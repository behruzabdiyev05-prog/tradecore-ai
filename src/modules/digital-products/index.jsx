/**
 * Module: digital-products — built on the shared opportunity screens (table `opportunities`).
 * Fields used by this module are listed below; labels live in the dictionaries (op.digital-products.*).
 */
import OpportunityModule from '../_shared/OpportunityModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('digital-products');
const CFG = { key: 'digital-products', fields: ['origin', 'target', 'buy', 'other', 'feePercent', 'feeFixed', 'sell', 'sold'] };

export default function Module() {
  return <OpportunityModule module={MODULE} cfg={CFG} />;
}
