/**
 * Module: marketplace (Modul 03 — DropPilot integration, stage İ-4: React screens).
 * Screens: overview, products, orders, supplier offers, calculator, store & settings,
 * plus the shared finance and AI tabs. Data rules live in the database (İ-3).
 */
import { useRef } from 'react';
import ModuleWorkspace from '../_shared/ModuleWorkspace.jsx';
import { getModule } from '../../../shared/modules.js';
import { t } from '../../core/i18n/index.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { DEFAULT_SETTINGS, marketplace } from './api.js';
import { useLoad } from './ui.jsx';
import Overview from './Overview.jsx';
import Products from './Products.jsx';
import Orders from './Orders.jsx';
import Suppliers from './Suppliers.jsx';
import Calculator from './Calculator.jsx';
import Settings from './Settings.jsx';

const MODULE = getModule('marketplace');

const TABS = ['overview', 'products', 'orders', 'suppliers', 'calculator', 'store', 'finance', 'ai'].map((id) => ({
  id, get label() { return ['finance', 'ai'].includes(id) ? t(`mw.tab.${id}`) : t(`mp.tab.${id}`); },
}));

/** Stable component references: React keeps each screen's state while settings reload. */
const SECTIONS = { overview: Overview, products: Products, orders: Orders, suppliers: Suppliers, calculator: Calculator, store: Settings };

export default function MarketplaceModule() {
  const { orgId } = useOrg();
  const settings = useLoad(() => marketplace.settings(orgId), [orgId]);
  // wait only for the FIRST load: a later reload (after saving) must not unmount the open tab
  const ready = useRef(false);
  if (!settings.loading || settings.data || settings.error) ready.current = true;
  if (!ready.current) return null;

  const sectionProps = {
    settings: { ...DEFAULT_SETTINGS, ...(settings.data ?? {}) },
    saved: settings.data,
    onSaved: settings.reload,
  };
  return <ModuleWorkspace module={MODULE} sections={SECTIONS} tabs={TABS} sectionProps={sectionProps} />;
}
