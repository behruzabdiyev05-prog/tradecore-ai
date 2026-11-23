/**
 * Module: wholesale — built on the shared document screens (trade_documents + lines,
 * central companies / products, posting to the central ledger).
 */
import DealsModule from '../_shared/DealsModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('wholesale');
const CFG = { key: 'wholesale', kinds: ['purchase', 'sale'], roles: ['supplier', 'customer'], offers: true, calc: 'bulk' };

export default function Module() {
  return <DealsModule module={MODULE} cfg={CFG} />;
}
