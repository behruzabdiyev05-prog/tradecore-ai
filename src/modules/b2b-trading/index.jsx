/**
 * Module: b2b-trading — built on the shared document screens (trade_documents + lines,
 * central companies / products, posting to the central ledger).
 */
import DealsModule from '../_shared/DealsModule.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('b2b-trading');
const CFG = { key: 'b2b-trading', kinds: ['offer', 'sale', 'purchase'], roles: ['customer', 'supplier'], offers: false, calc: 'markup' };

export default function Module() {
  return <DealsModule module={MODULE} cfg={CFG} />;
}
