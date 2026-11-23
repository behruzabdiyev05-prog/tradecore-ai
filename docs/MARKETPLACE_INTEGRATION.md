# Modul 03 · Marketplace — DropPilot inteqrasiyası

DropPilot TRADECORE-un daxilində Modul 03 (Marketplace Trading) kimi qurulur. Arxitektura və verilənlər bazası dizaynı təsdiqlənib (İ-1, İ-2, 2026-11-21). Bu fayl hər mərhələdə dəyişənləri və DropPilot-dan fərqləri qeyd edir.

**Mərhələ vəziyyəti:** İ-1 ✔ · İ-2 ✔ · İ-3 ✔ (real test layihəsinə tətbiq edilib) · **İ-4 hazırdır, təsdiq gözləyir** · İ-5…İ-7 başlanmayıb.

Qorunan qaydalar: DropPilot-un canlı Supabase layihəsinə, canlı NovaNest Shopify mağazasına, Netlify-a və production verilənlər bazasına toxunulmur. Köhnə miqrasiyalar, rollback-lər və testlər dəyişmir.

---

## İ-3 · Miqrasiyalar, RLS və təhlükəsizlik (yalnız lokal PostgreSQL 16)

### Yeni fayllar (25: 11 SQL, 6 test, 1 sənəd, 7 hesabat)

| Fayl | Təyinat |
|---|---|
| `supabase/migrations/20261124001300_notifications_dedupe.sql` | `notifications.dedupe_key`, `notify_once()`, `notify_marketplace()` (Q3: Modul 03-də yazma icazəsi olan üzvlərə) |
| `supabase/migrations/20261124001400_marketplace_core.sql` | 6 cədvəl: listinq, variant, sifariş, sifariş sətri, parametrlər, kalkulyator parametrləri; RLS; D1 qoruyucuları |
| `supabase/migrations/20261124001500_supplier_offers.sql` | Ümumi təchizatçı təklifləri + qiymət tarixçəsi |
| `supabase/migrations/20261124001600_integration_events.sql` | Webhook jurnalı (audit-siz, Y1) + Shopify domeni üzrə unikal indeks |
| `supabase/migrations/20261124001700_marketplace_functions.sql` | Server və istifadəçi funksiyaları, davranış trigger-ləri |
| `supabase/rollback/20261124001{3..7}00_*.down.sql` | Hər miqrasiya üçün ayrıca geri qaytarma (5 fayl) |
| `supabase/verify/marketplace_verify.sql` | Real TEST layihəsi üçün yalnız oxuyan yoxlama (27 yoxlama) |
| `tests/sql/marketplace_tests.sql` | 18 qrupda 303 yoxlama (kod yazılmazdan əvvəl qırmızı işə salınıb) |
| `tests/sql/run_marketplace.sh` | Tam dəst: köhnə testlər + yeni testlər + verify + rollback dövrü + `pg_dump` müqayisəsi |
| `tests/sql/marketplace_parity.sh` | DropPilot-un öz `dp_upsert_shopify_order_lines` funksiyası ilə qəpik səviyyəsində müqayisə |
| `tests/sql/rollback_seed_mp.sql`, `rollback_check_mp.sql` | Rollback dövrü üçün məlumat və yoxlama |
| `tests/sql/supabase_stub_marketplace.sql` | Lokal testdə `service_role` rolu (Supabase-də artıq mövcuddur) |
| `docs/MARKETPLACE_INTEGRATION.md` | Bu fayl |
| `docs/reports/i3-*.txt` (7) | Qırmızı işə salma, tam dəst, hər yoxlama, köhnə testlər, JS reqressiyası, DropPilot müqayisəsi, fayl müqayisəsi |

### Dəyişdirilən mövcud fayllar (3, yalnız əlavə)
- `CHANGELOG.md` — İ-3 qeydi.
- `docs/ARCHITECTURE.md` — 28–34-cü bəndlər (Modul 03 məlumat qatı).
- `package.json` — `test:sql:mp` və `test:sql:mp:red` skriptləri (silinən sətir yoxdur).

### Mövcud cədvəllərə əlavələr (İ-2 §3-də təsdiqlənmiş)
- `notifications`: boş buraxıla bilən `dedupe_key` + qismən unikal indeks.
- `integrations`: Shopify domeni üzrə unikal indeks.

`products`, `exchange_rates` və digər mövcud cədvəllərin sütunlarına toxunulmayıb (test yoxlayır).

### Funksiyalar

| Funksiya | Kim çağırır | Təyinat |
|---|---|---|
| `marketplace_upsert_catalog` | server | Kataloq idxalı; xərc sütunlarını üzərinə yazmır |
| `marketplace_upsert_shopify_order` | server | Sifariş idxalı; dondurma, ilkin məzənnə ilə refund, mayanı bir dəfə doldurma |
| `marketplace_apply_inventory` | server | `inventory_levels/update` |
| `integration_event_store` / `integration_event_finish` | server | Webhook jurnalı; təkrar mesaj atılır; 5 uğursuz cəhddən sonra bildiriş |
| `integration_events_purge` | server | D3: 30 gündən sonra yalnız `payload` silinir |
| `marketplace_create_manual_order` | istifadəçi | D4 + D7: sifariş və stok azalması bir tranzaksiyada |
| `marketplace_history` | istifadəçi | Qiymət/status tarixçəsi; yalnız icazəli sütunlar |
| `marketplace_store_status` | istifadəçi | Y7: yalnız say və vaxt |
| `marketplace_delete_listing` | istifadəçi | D6; `SECURITY INVOKER` — istifadəçinin öz RLS-i işləyir |
| `marketplace_blocked_shop` | hər ikisi | Y13: canlı NovaNest domeni bloklanır |
| `notify_once` / `notify_marketplace` | baza daxili | Təkrarsız bildiriş / Modul 03 yazıçılarına |

### İ-3-də dəqiqləşdirilənlər (İ-2 dizaynından fərqlər)

| № | Dəqiqləşdirmə | Səbəb |
|---|---|---|
| Y16 | Yeni cədvəllərdə `user_id` (yaradan) `auth.users`-ə xarici açarla bağlanmır | İstifadəçi silinərsə şirkətin sifarişləri silinməsin (`audit_log.actor_id` ilə eyni yanaşma) |
| Y17 | `marketplace_order_lines.fx_rate_to_base` — hər sətrin öz dondurulmuş məzənnəsi | DropPilot ilə müqayisə testi tapdı: sifarişə sonradan əlavə olunan sətrin refund-u səhv məzənnə ilə çevrilirdi. İndi DropPilot ilə qəpiyinədək eynidir |
| — | D1 qoruyucu trigger-ləri 0017-də yox, cədvəllərlə birlikdə 0014-dədir | Cədvəl heç vaxt qorumasız qalmasın (0017 geri qaytarılsa belə) |
| — | `marketplace_create_manual_order` `SECURITY DEFINER`-dir (İ-2-də INVOKER yazılmışdı); icazə, plan və 2FA funksiyanın içində yoxlanılır | Sifariş və sətrə birbaşa yazma bağlıdır; D4-ü (atomik stok) yan keçmək mümkün olmasın |
| — | Az stok bildirişi yalnız listinqdə; variant stoku listinqə toplanır | Eyni hadisəyə iki bildiriş getməsin |
| — | `marketplace_delete_listing` əlavə edildi | D6-nın icrası (mesaj + "Qaralama" təklifi) |

### DropPilot-dan davranış fərqləri (D1–D7, təsdiqlənib)
- **D1** Shopify sifarişinin maliyyə rəqəmləri, valyutası, məzənnəsi, tarixi bazada qorunur; brauzer (`authenticated`) dəyişə bilmir. Əl ilə sifarişlər redaktə olunur.
- **D2** Shopify sifarişi silinmir, arxivləşdirilir (`archived_at`); idxal arxivi açmır və təkrar sətir yaratmır.
- **D3** Webhook məzmunu (ünvan, telefon, IP) 30 gündən sonra silinir; sifariş və müştərinin adı/e-poçtu qalır. Jurnal audit-ə yazılmır (Y1).
- **D4** Əl ilə sifariş + stok azalması atomikdir; stok çatmırsa heç nə yazılmır.
- **D5** VAT dərəcələri "təxmini" nişanı ilə (İ-4-də, `shared/marketplace/vat.js`).
- **D6** Sifarişi olan məhsul silinmir; Modul 03-ün yaratdığı kataloq sətri listinqlə birlikdə silinir.
- **D7** Əl ilə sifariş nömrəsi şirkət daxilində unikaldır.

### Testlərin işə salınması

```
tests/sql/run_marketplace.sh                       # tam dəst (≈3 dəq)
RED=1 tests/sql/run_marketplace.sh                 # miqrasiyalarsız: testlər uğursuz olmalıdır
DROPPILOT_DIR=/yol/dp_stage7 tests/sql/marketplace_parity.sh   # DropPilot ilə müqayisə (əlavə)
```

Skript yalnız müvəqqəti qovluqdakı Unix soketi ilə lokal PostgreSQL-ə qoşulur. Repoda və ya `.env`-də DropPilot-un canlı layihəsinin identifikatoru tapılarsa, dayanır.

### Nəticələr (2026-11-21)
- Qırmızı: 312 yoxlamadan 301-i uğursuz (keçən 11-i setup və "dəyişməməli olan" yoxlamalardır).
- Yaşıl: 303/303; `marketplace_verify` 27/27; `phase2b_verify` 24/24.
- Köhnə testlər dəyişmədən: Phase 1 ✔, 2A 112/112, 2B 148/148, icazə matrisi 125 cüt, ayarlar qaydası 30/30, unit 53/53, E2E 70/70 + 54/54, i18n 0 problem (31 qeyd: yeni SQL xəta mesajlarının EN/RU tərcüməsi — İ-4-də, interfeys lüğətinə).
- Rollback: 0017→0013 geri → sxem Phase 2B ilə `pg_dump` səviyyəsində eyni → 2B testləri keçir → yenidən tətbiq → 303/303. Köhnə `run.sh` və `run_phase2b.sh` dövrləri də yeni rollback-lərlə keçir.
- DropPilot müqayisəsi: 4 çatdırılmadan sonra 3 sətrin satış, çatdırılma, komissiya, refund, maya, status və məzənnəsi eynidir.

### Növbəti mərhələdən əvvəl
- Real `tradecore-test` layihəsində 0013–0017-nin tətbiqi və `marketplace_verify.sql` — Phase 2B real testi tamamlandıqdan sonra, ayrıca icazə ilə.
- İ-4 (React komponentləri) yalnız ayrıca təsdiqdən sonra başlayır.

---

## İ-4 · React ekranları

| Fayl | Təyinat |
|---|---|
| `src/modules/marketplace/index.jsx` | Modulun tabları; parametrlər bir dəfə yüklənir və ekranlara ötürülür |
| `src/modules/marketplace/api.js` | Bütün Modul 03 sorğuları (RLS və SQL funksiyaları əsl qaydadır) |
| `Overview.jsx`, `Products.jsx`, `Orders.jsx`, `Suppliers.jsx`, `Calculator.jsx`, `Settings.jsx`, `History.jsx`, `ui.jsx` | Ekranlar |
| `shared/marketplace/calc.js`, `shared/marketplace/vat.js` | Mənfəət riyaziyyatı, təxmini ƏDV cədvəli (D5) |

**Hesablama qaydaları** (`calc.js`): məbləğlər qəpiklə tam ədəddir; komissiya = satış × % + sabit; ƏDV qiymətin içindədir; sifariş sətri mənfəəti = satış + çatdırılma gəliri − endirim − komissiya − geri qaytarma − maya dəyəri (vergi gəlir sayılmır, məbləğlər sətir cəmidir).

**Bilinən məhdudiyyətlər:** variantlı (Shopify) məhsullar əl ilə sifarişdə hələ seçilmir; əl ilə sifariş silinəndə stok geri qaytarılmır (istifadəçiyə deyilir); məzənnəni istifadəçi yazır (avtomatik məzənnə İ-7/Phase 7).
