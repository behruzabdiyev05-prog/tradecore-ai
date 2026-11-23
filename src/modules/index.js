/**
 * Module loader: each module is code-split into its own bundle chunk and
 * loaded only when opened. Keys must match shared/modules.js (unit-tested).
 */
import { lazy } from 'react';
import { withReload } from '../core/ui/staleChunk.js';

export const MODULE_LOADERS = {
  'product-research': () => import('./product-research/index.jsx'),
  'wholesale': () => import('./wholesale/index.jsx'),
  'marketplace': () => import('./marketplace/index.jsx'),
  'arbitrage': () => import('./arbitrage/index.jsx'),
  'import-export': () => import('./import-export/index.jsx'),
  'b2b-trading': () => import('./b2b-trading/index.jsx'),
  'used-goods': () => import('./used-goods/index.jsx'),
  'digital-products': () => import('./digital-products/index.jsx'),
  'b2b-client-finder': () => import('./b2b-client-finder/index.jsx'),
  'financial-trading': () => import('./financial-trading/index.jsx'),
};

const cache = new Map();

export function getModuleComponent(key) {
  if (!MODULE_LOADERS[key]) return null;
  if (!cache.has(key)) cache.set(key, lazy(() => withReload(MODULE_LOADERS[key])));   // new deploy → reload once
  return cache.get(key);
}
