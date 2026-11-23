/**
 * TRADECORE AI — Module registry (single source of truth).
 *
 * Shared by the React frontend, Netlify Functions (ARES context routing)
 * and mirrored in the database seed (supabase/migrations/..._modules.sql).
 * A unit test verifies the DB seed and this file stay in sync.
 *
 * To add a future module: append an entry here, add a folder under
 * src/modules/<key>/, and add a migration inserting the key into `modules`.
 */

/** @typedef {'planned'|'in_development'|'active'} ModuleStatus */

/**
 * @typedef {Object} ModuleDefinition
 * @property {string} key        Stable identifier (DB foreign key, URL slug).
 * @property {string} code       Two-digit display number.
 * @property {string} name       Full name (AZ).
 * @property {string} shortName  Sidebar label (AZ).
 * @property {string} icon       Icon id resolved by the frontend.
 * @property {string} summary    One-line description (AZ).
 * @property {boolean} finance   Whether the module records transactions in central finance.
 * @property {ModuleStatus} status
 * @property {string[]} features Planned feature list (implemented in Phase 3+).
 */

/** @type {ReadonlyArray<ModuleDefinition>} */
export const MODULES = Object.freeze([
  {
    key: 'product-research',
    code: '01',
    name: 'Məhsul Araşdırması',
    shortName: 'Məhsul Araşdırması',
    icon: 'search',
    summary: 'Qlobal məhsul kəşfi, tələb və trend analizi.',
    finance: true,
    status: 'planned',
    features: [
      'Qlobal məhsul kəşfi',
      'Tələb analizi',
      'Bazar trendləri',
      'Rəqib araşdırması',
      'Qiymət müqayisəsi',
      'Gəlirlilik hesablamaları',
      'Məhsul imkan reytinqi',
      'Saxlanılmış araşdırma siyahıları',
    ],
  },
  {
    key: 'wholesale',
    code: '02',
    name: 'Topdan Ticarət',
    shortName: 'Topdan Ticarət',
    icon: 'boxes',
    summary: 'Topdan təchizatçılar, qiymətlər və alış idarəetməsi.',
    finance: true,
    status: 'planned',
    features: [
      'Topdan təchizatçı axtarışı',
      'Toplu məhsul qiymətləri',
      'Minimum sifariş miqdarı (MOQ)',
      'Təchizatçı müqayisəsi',
      'Alış idarəetməsi',
      'Topdan gəlir hesablamaları',
      'Təchizatçı bazası',
    ],
  },
  {
    key: 'marketplace',
    code: '03',
    name: 'Marketplace Ticarəti',
    shortName: 'Marketplace',
    icon: 'store',
    summary: 'Amazon, eBay, Shopify və digər platformalarda satış.',
    finance: true,
    status: 'planned',
    features: [
      'Amazon / eBay / Shopify',
      'Digər beynəlxalq marketplace-lər',
      'Məhsul araşdırması',
      'Rəqib analizi',
      'Marketplace komissiyaları',
      'Listinq idarəetməsi',
      'Satış performansı analizi',
    ],
  },
  {
    key: 'arbitrage',
    code: '04',
    name: 'Arbitraj Ticarəti',
    shortName: 'Arbitraj',
    icon: 'arrows',
    summary: 'Ölkələr və platformalar arası qiymət fərqləri.',
    finance: true,
    status: 'planned',
    features: [
      'Beynəlxalq qiymət müqayisəsi',
      'Marketplace qiymət fərqləri',
      'Ölkələrarası imkanlar',
      'Alış və daşıma xərcləri',
      'Vergi və komissiya hesabları',
      'Xalis gəlir hesablaması',
      'Risk qiymətləndirməsi',
    ],
  },
  {
    key: 'import-export',
    code: '05',
    name: 'İdxal və İxrac',
    shortName: 'İdxal / İxrac',
    icon: 'ship',
    summary: 'Beynəlxalq təchizat, gömrük və landed cost.',
    finance: true,
    status: 'planned',
    features: [
      'Beynəlxalq təchizatçı axtarışı',
      'İdxal imkanları',
      'İxrac imkanları',
      'Ölkə müqayisəsi',
      'Daşıma hesablamaları',
      'Gömrük xərcləri',
      'Vergilər',
      'Landed cost hesablaması',
      'İdxal/ixrac gəlirliliyi',
    ],
  },
  {
    key: 'b2b-trading',
    code: '06',
    name: 'B2B Ticarət',
    shortName: 'B2B Ticarət',
    icon: 'handshake',
    summary: 'Biznes müştəriləri, kataloqlar və kommersiya təklifləri.',
    finance: true,
    status: 'planned',
    features: [
      'Biznes müştəri araşdırması',
      'Topdan satışlar',
      'Təchizatçı idarəetməsi',
      'Məhsul kataloqları',
      'Kommersiya təklifləri',
      'Alış və satış qeydləri',
      'Müştəri idarəetməsi',
    ],
  },
  {
    key: 'used-goods',
    code: '07',
    name: 'İşlənmiş Mallar',
    shortName: 'İşlənmiş Mallar',
    icon: 'recycle',
    summary: 'İkinci əl bazarı, vəziyyət, təmir və satış qiyməti.',
    finance: true,
    status: 'planned',
    features: [
      'İşlənmiş məhsul araşdırması',
      'İkinci əl bazar analizi',
      'Qiymət müqayisəsi',
      'Məhsul vəziyyətinin qiymətləndirilməsi',
      'Təmir xərcləri',
      'Satış qiyməti hesablaması',
      'Gəlirlilik analizi',
    ],
  },
  {
    key: 'digital-products',
    code: '08',
    name: 'Rəqəmsal Məhsullar',
    shortName: 'Rəqəmsal Məhsullar',
    icon: 'digital',
    summary: 'Rəqəmsal məhsullar, platformalar və satış izləmə.',
    finance: true,
    status: 'planned',
    features: [
      'Rəqəmsal məhsul araşdırması',
      'Rəqəmsal marketplace-lər',
      'Rəqib analizi',
      'Qiymətləndirmə',
      'Məhsul idarəetməsi',
      'Satış izləmə',
      'Gəlirlilik analizi',
    ],
  },
  {
    key: 'b2b-client-finder',
    code: '09',
    name: 'B2B Müştəri Axtarışı',
    shortName: 'Müştəri Axtarışı',
    icon: 'target',
    summary: 'Azərbaycanda poliqrafiya xidmətləri üçün potensial müştərilər.',
    finance: true,
    status: 'planned',
    features: [
      'Azərbaycanda şirkət axtarışı (şəhər, kateqoriya)',
      'Yeni yaradılmış bizneslər (etibarlı mənbə olduqda)',
      'Açıq mənbəli əlaqə məlumatları',
      'Müştəri təsnifatı və imkan reytinqi',
      'Hər biznes üçün tövsiyə olunan çap xidmətləri',
      'Fərdi kommersiya təklifi',
      'Müştəri bazası və əlaqə tarixçəsi',
      'Satış pipeline və follow-up',
    ],
  },
  {
    key: 'financial-trading',
    code: '10',
    name: 'Maliyyə Ticarəti',
    shortName: 'Maliyyə Ticarəti',
    icon: 'chart',
    summary: 'Kripto, Forex, səhmlər, qızıl — analiz və demo ticarət.',
    // Kept separate from physical-goods finance; uses its own portfolio ledger (Phase 3).
    finance: false,
    status: 'planned',
    features: [
      'Kripto (BTC, ETH), Forex, səhmlər, indekslər, qızıl, əmtəələr',
      'Canlı bazar məlumatı (mövcud olduqda)',
      'İnteraktiv qrafiklər',
      'Texniki və fundamental analiz',
      'AI bazar araşdırması (proqnoz deyil, analiz)',
      'Risk analizi və portfel idarəetməsi',
      'Mənfəət/zərər hesablaması və tarixçə',
      'Demo ticarət və bazar xəbərdarlıqları',
    ],
  },
]);

export const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));

/** @param {string} key */
export function getModule(key) {
  return MODULES.find((m) => m.key === key) ?? null;
}

/** @param {string} key */
export function isModuleKey(key) {
  return MODULE_KEYS.includes(key);
}
