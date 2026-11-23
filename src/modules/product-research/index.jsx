/**
 * Module: product-research — built on the shared opportunity screens (table `opportunities`).
 * Fields used by this module are listed below; labels live in the dictionaries (op.product-research.*).
 */
import OpportunityModule from '../_shared/OpportunityModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('product-research');
const CFG = { key: 'product-research', fields: ['origin', 'target', 'buy', 'shipping', 'other', 'feePercent', 'feeFixed', 'sell'] };

export default function Module() {
  return <OpportunityModule module={MODULE} cfg={CFG} />;
}
