/**
 * Planned external integrations (Phase 7). Credentials are read ONLY on the
 * server from the env variables listed in `envKeys`; the browser only ever
 * learns whether they are present.
 */
export const INTEGRATIONS = Object.freeze([
  { key: 'alibaba', name: 'Alibaba', modules: ['wholesale', 'import-export', 'product-research'], envKeys: ['ALIBABA_APP_KEY', 'ALIBABA_APP_SECRET'] },
  { key: 'aliexpress', name: 'AliExpress', modules: ['product-research', 'arbitrage'], envKeys: ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET'] },
  { key: 'amazon', name: 'Amazon SP-API', modules: ['marketplace', 'arbitrage', 'product-research'], envKeys: ['AMAZON_SP_CLIENT_ID', 'AMAZON_SP_CLIENT_SECRET', 'AMAZON_SP_REFRESH_TOKEN'] },
  { key: 'ebay', name: 'eBay', modules: ['marketplace', 'arbitrage', 'used-goods'], envKeys: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'] },
  { key: 'shopify', name: 'Shopify', modules: ['marketplace', 'digital-products'], envKeys: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'] },
  { key: 'market-data', name: 'Maliyyə bazarı məlumatları', modules: ['financial-trading'], envKeys: ['MARKET_DATA_PROVIDER', 'MARKET_DATA_API_KEY'] },
  { key: 'business-directory', name: 'Biznes kataloqları (AZ)', modules: ['b2b-client-finder'], envKeys: ['BUSINESS_DIRECTORY_API_KEY'] },
  { key: 'maps', name: 'Xəritə xidməti', modules: ['b2b-client-finder'], envKeys: ['MAPS_API_KEY'] },
  { key: 'fx-rates', name: 'Valyuta məzənnələri', modules: [], envKeys: ['FX_RATES_SOURCE'] },
]);
