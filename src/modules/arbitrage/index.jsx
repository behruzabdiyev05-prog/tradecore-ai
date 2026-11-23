/**
 * Module: arbitrage — built on the shared opportunity screens (table `opportunities`).
 * Fields used by this module are listed below; labels live in the dictionaries (op.arbitrage.*).
 */
import OpportunityModule from '../_shared/OpportunityModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('arbitrage');
const CFG = { key: 'arbitrage', fields: ['origin', 'target', 'buy', 'shipping', 'customs', 'tax', 'other', 'feePercent', 'feeFixed', 'sell'] };

export default function Module() {
  return <OpportunityModule module={MODULE} cfg={CFG} />;
}
