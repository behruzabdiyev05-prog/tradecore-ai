/**
 * Module: digital-products
 * Root component of this module. Module-specific screens, services and
 * data access live in this folder (e.g. ./sections, ./services, ./api).
 * Override standard workspace tabs via `sections` as features are built.
 */
import ModuleWorkspace from '../_shared/ModuleWorkspace.jsx';
import { getModule } from '../../../shared/modules.js';

const MODULE = getModule('digital-products');

/** Tab overrides, e.g. { search: SearchSection }. Empty until Phase 3. */
const sections = {};

export default function DigitalProductsModule() {
  return <ModuleWorkspace module={MODULE} sections={sections} />;
}
