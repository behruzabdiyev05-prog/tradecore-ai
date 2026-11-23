/**
 * Module: b2b-trading
 * Root component of this module. Module-specific screens, services and
 * data access live in this folder (e.g. ./sections, ./services, ./api).
 * Override standard workspace tabs via `sections` as features are built.
 */
import ModuleWorkspace from '../_shared/ModuleWorkspace.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('b2b-trading');

/** Tab overrides, e.g. { search: SearchSection }. Empty until Phase 3. */
const sections = {};

export default function B2BTradingModule() {
  return <ModuleWorkspace module={MODULE} sections={sections} />;
}
