# TRADECORE AI — Arxitektura (Phase 1)

## Ümumi baxış

```
Brauzer (React SPA)                     Netlify                         Supabase
┌──────────────────────────┐   /api/*   ┌──────────────────────┐        ┌─────────────────────┐
│ AppShell                 │──────────▶│ Functions             │──JWT──▶│ Auth (GoTrue)       │
│  ├ Sidebar (10 modul)    │            │  health / ares /      │        │                     │
│  ├ Topbar                │            │  integrations         │        │ PostgreSQL + RLS    │
│  ├ ARES paneli           │            │  (gizli açarlar yalnız│        │  profiles, modules  │
│  └ Modullar (lazy chunk) │            │   burada)             │        │  companies, products│
│                          │──anon key + istifadəçi sessiyası (RLS)─────▶│  saved_items        │
└──────────────────────────┘                                             │  module_events      │
                                                                         │  financial_tx, ...  │
                                                                         └─────────────────────┘
```

## Qovluq strukturu

| Yol | Təyinat |
|---|---|
| `shared/` | Frontend və backend üçün ortaq həqiqət mənbəyi: `modules.js` (10 modul reyestri), `finance.js` (pul riyaziyyatı), `integrations.js` |
| `src/core/` | Platforma nüvəsi: config, router, auth, api client, data (db + event bus), finance, ares, ui |
| `src/layout/` | AppShell, Sidebar, Topbar, AresPanel |
| `src/pages/` | İdarə paneli, Maliyyə mərkəzi, Sistem, Giriş, Konfiqurasiya ekranı |
| `src/modules/<key>/` | Hər modulun öz qovluğu və kök komponenti (ayrıca JS chunk) |
| `src/modules/_shared/ModuleWorkspace.jsx` | Bütün modulların standart iş sahəsi (İcmal, Axtarış, Məlumatlar, Maliyyə, Tarixçə, Hesabatlar, AI) |
| `netlify/functions/` | Serverless API endpoint-ləri |
| `netlify/lib/` | Server köməkçiləri (auth yoxlaması, HTTP, ARES konteksti və provayder reyestri) |
| `supabase/migrations/` | SQL sxem, RLS siyasətləri |
| `tests/` | unit, SQL (RLS), E2E |

## Əsas qərarlar

1. **Modul müstəqilliyi.** Hər modul ayrıca qovluq + lazy-loaded chunk. Bir modulda xəta `ModuleBoundary` ilə izolyasiya olunur, platformanı çökdürmür. Modul öz tablarını `sections` vasitəsilə əvəz edir.
2. **Tək modul reyestri.** `shared/modules.js` — sidebar, ARES konteksti, DB `modules` cədvəli və loader-lər bununla sinxron saxlanılır (unit testlə yoxlanılır).
3. **Pul = tam ədəd (qəpik).** Float istifadə olunmur. Konvertasiya: `round(amount_minor × rate)`, yarımdan yuxarı yuvarlaqlaşdırma; JS və SQL nəticələri testlə eyniləşdirilib.
4. **Maliyyə təriflər (cash-basis, Phase 1):**
   - Gəlir = satış
   - Maya dəyəri (landed) = alış + daşıma + gömrük
   - Ümumi mənfəət = gəlir − maya dəyəri
   - Xərclər = komissiya + vergi + əməliyyat + digər
   - Xalis mənfəət = ümumi mənfəət − xərclər
   - Pul axını = bütün daxilolmalar − çıxışlar (kapital daxil). Kapital mənfəətə təsir etmir.
5. **Valyuta məzənnələri uydurulmur.** Heç bir məzənnə kodda yoxdur; hər məzənnə mənbə (`source`) və etibarlılıq (`data_quality`) ilə saxlanılır.
6. **Məlumat mənşəyi.** `companies`, `products`, `saved_items`, `exchange_rates` — hamısında `source`, `source_url`, `data_quality (verified/estimated/unverified)`.
7. **Modullararası məlumat mübadiləsi.** `eventBus` (tətbiq daxilində) + `module_events` cədvəli (davamlı). Hadisə formatı: `entity.action` (məs. `supplier.saved`). Ortaq varlıqlar: `companies`, `products`, `saved_items`.
8. **ARES — tək intellekt qatı.** Mərkəzi ARES və modul assistentləri eyni `/api/ares` endpoint-ini istifadə edir; fərq yalnız `moduleKey` kontekstidir. Provayder adapter interfeysi hazırdır; Phase 1-də heç bir provayder qoşulmayıb və ARES saxta cavab vermək əvəzinə `ARES_NOT_CONFIGURED` qaytarır.
9. **Təhlükəsizlik.** Brauzerdə yalnız Supabase anon açarı (açıq olmaq üçün nəzərdə tutulub). Bütün cədvəllərdə RLS (`user_id = auth.uid()`). Server funksiyaları tokeni Supabase Auth ilə yoxlayır. `integrations.config` sahəsinə gizli açar yazmaq DB səviyyəsində bloklanıb.
10. **Router.** Asılılıqsız kiçik History API router (`src/core/router`). Netlify SPA fallback deep link-ləri təmin edir.
11. **Bölmə temaları.** UI bütün bölmələrdə eyni şüşə (glass) komponentlərindən istifadə edir. Rəng və fon bölməyə görə dəyişir: `src/core/ui/themes.js` → `<Scene>` vurğu rəngini CSS dəyişənlərinə (`--accent`, `--accent-2`) yazır və fon səhnəsini dəyişir. Fon şəkilləri orijinaldır (`scripts/generate-backgrounds.py`); yalnız açılan bölmələrin fonları yüklənir.
12. **Açıq / tünd rejim.** Standart rejim açıqdır. Rejim `<html data-mode>` atributu ilə tətbiq olunur; bütün rənglər CSS dəyişənləri vasitəsilə dəyişir (`[data-mode='light']` bloku). Hər səhnənin açıq versiyası `public/backgrounds/light/` qovluğundadır.

## Phase 2A — SaaS (multi-tenant) modeli

13. **Təşkilat = tenant.** Hər biznes sətri `org_id` daşıyır; `user_id` yaradıcıdır. İstifadəçi bir neçə şirkətin üzvü ola bilər; aktiv şirkət `profiles.active_org_id`.
14. **RLS qaydası:** `org_id in (select org_ids_with('<icazə>'))`. Bu set qaytaran funksiyalar sorğu başına bir dəfə hesablanır (10 000 sətir < 3 ms). Modul məlumatı əlavə olaraq `org_module_access()` ilə plan və modul icazəsinə bağlıdır.
15. **Rollar:** 5 sistem rolu (dəyişməz) + gələcəkdə şirkətin öz rolları (`roles.org_id`). Rol və üzvlük yalnız yoxlamalı RPC-lərlə dəyişir; `organization_members` cədvəlinə birbaşa yazmaq icazəsi yoxdur. Sonuncu Sahib trigger ilə qorunur.
16. **Dəvət:** token yalnız bir dəfə göstərilir, bazada SHA-256 heşi saxlanılır; 7 gün, bir dəfəlik, e-poçt uyğunluğu. Qeydiyyat metadatasından yalnız `company_name` və `invite_token` bayrağı oxunur.
17. **Audit:** `audit_log` yalnız trigger-lər yazır; UPDATE/DELETE/TRUNCATE trigger-lə bloklanır. Saxlama müddəti Phase 9-da.
18. **Server icazəsi:** Netlify Functions üzvlüyü istifadəçinin öz JWT-si ilə `check_access` RPC vasitəsilə yoxlayır. `service_role` açarı istifadə olunmur.
19. **Supabase standart hüquqları:** Supabase yeni obyektlərə `anon`/`authenticated` üçün geniş hüquq verir; migrasiyalar bunları açıq şəkildə geri alır. Test mühiti (`tests/sql/auth_stub.sql`) bu davranışı emulyasiya edir.

## Phase 2B — Profil, parametrlər, bildirişlər, axtarış, naviqasiya

20. **Profil istifadəçiyə aiddir, şirkətə yox.** `profiles`-a yazma sütun səviyyəsində icazə ilə məhdudlaşır (ad, telefon, vəzifə, şəkil yolu, dil, valyuta, `preferences`). `active_org_id` yalnız `switch_org()` ilə dəyişir. `preferences` bazada `valid_preferences()` ilə yoxlanılır (icazəli açarlar, 8 KB); eyni qayda `shared/preferences.js`-dədir, test ikisini müqayisə edir.
21. **Fayllar:** gizli Storage bucket-ləri `avatars/<user_id>/…` və `org-logos/<org_id>/…` (2 MB, PNG/JPEG/WebP). Şəkil yalnız öz qovluğuna, loqo yalnız `org.manage` ilə yazılır; oxumaq yalnız eyni şirkətin üzvlərinə açıqdır. Brauzer qısa müddətli imzalı URL ilə göstərir.
22. **Bildirişlər yalnız bazada yaranır** (`notify()`, kliyentə bağlıdır). Alıcı aktiv üzv olmalı və növü söndürməməlidir. Kliyent yalnız oxuyur və RPC ilə "oxundu" edir. Keçid bazada yoxlanılır (yalnız `/…`). Realtime nəşri RLS-ə tabedir. Bildiriş mətni brauzerdə `type + data` ilə istifadəçinin dilində qurulur; bazadakı AZ mətn ehtiyatdır.
23. **Axtarış:** `global_search()` `security definer`-dir (RLS altında trigram indeksləri işləmədiyinə görə). Funksiya mənbə cədvəllərin RLS şərtlərini eyni köməkçilərlə (`member_org_ids`, `org_ids_with`, `org_module_access`) özü tətbiq edir; test hər nəticənin həmin istifadəçiyə RLS ilə də göründüyünü yoxlayır. Sorğu ən çox 100 simvol, nəticə ən çox 50, `%`/`_`/`\` adi simvoldur. Yeni cədvəl axtarışa bir `union all` bloku ilə qoşulur — RLS şərti də həmin blokda yazılmalıdır.
24. **Şirkət üzrə 2FA:** `organizations.mfa_required_roles` (yalnız `set_security_policy()`, yalnız Sahib). Tələb varsa və JWT `aal` ≠ `aal2`-dirsə, RLS köməkçiləri həmin şirkəti qaytarmır — bütün cədvəllər, Storage, axtarış və bildirişlər eyni anda bağlanır. `switch_org` açıq qalır ki, tətbiq 2FA ekranını göstərə bilsin. Siyasətin özü də 2FA ilə qorunur: dəyişən şəxsin rolu köhnə və ya yeni siyasətdədirsə, `aal2` sessiya tələb olunur (oğurlanmış şifrə ilə tələbi söndürmək olmur).
25. **Naviqasiya reyestri** (`src/core/navigation/registry.js`) yeganə mənbədir: menyu, əmr paneli, "İz" sətri və marşrut qoruması eyni `canAccess()`-dən istifadə edir. Menyuda gizlənən səhifə ünvanla da açılmır (ssenari 43, hər rol üçün unit test).
26. **Şirkət dəyişəndə təmizlik:** tətbiq ağacı `orgId` açarı ilə yenidən qurulur; bildirişlər, axtarış nəticələri, son baxılanlar və son axtarışlar şirkət üzrə ayrıca saxlanılır (ssenari 44).
27. **Dil:** `src/core/i18n/{az,en,ru}.js`, `t()`. AZ əsas dildir; modul/rol/valyuta adlarının AZ mənbəyi `shared/*.js`-dədir (server də istifadə edir), EN/RU onları `mod.*`, `role.*` … açarları ilə tərcümə edir. Bazanın AZ xəta mətnləri EN/RU-da `srv.*` açarları ilə tərcümə olunur. Seçilmiş dil profildə saxlanılır.

## İ-3 — Modul 03 (Marketplace / DropPilot) məlumat qatı

28. **Modul 03 cədvəlləri mərkəzi kataloqun üzərində qurulur.** Məhsulun adı `products`-da qalır; marketplace hissəsi (qiymət, stok, Shopify sahələri) `marketplace_listings`-də 1:1 saxlanılır (`products` sütunları dəyişmir). Listinqi olan məhsulu başqa modul silə bilmir (`RESTRICT`).
29. **Sifariş = başlıq + sətirlər** (Q1). Shopify sətri idxal anında dondurulur: satış, çatdırılma, vergi, endirim, komissiya və **sətrin öz məzənnəsi** (Y17). Təkrar idxal yalnız status, müştəri, refund (sətrin ilkin məzənnəsi ilə) və bir dəfə maya yeniləyir — DropPilot-un `dp_upsert_shopify_order_lines` qaydası; `tests/sql/marketplace_parity.sh` ikisini müqayisə edir.
30. **Brauzer nəyi dəyişə bilmir (D1):** `b_guard` trigger-ləri sorğunun rolunu yoxlayır — `authenticated` Shopify identifikatorlarını, dondurulmuş rəqəmləri, valyuta/məzənnə/tarixi dəyişə bilmir. Server funksiyaları (owner) və `service_role` keçir. Sifariş, sətir, variant yaratmaq kliyentə bağlıdır.
31. **Server yazıları:** Modul 03 Netlify funksiyaları (İ-5) `service_role` ilə işləyəcək — 18-ci bənddəki qaydadan yeganə istisna. Bazaya yalnız `p_org` + `p_integration` tələb edən DEFINER funksiyaları ilə yazırlar; funksiya inteqrasiyanın həmin şirkətə aid, qoşulu və qadağan siyahısında olmadığını yoxlayır (Y6, Y13).
32. **Webhook jurnalı** (`integration_events`) ümumidir (Amazon, eBay üçün də). Mağaza şirkətə yalnız qoşulu `integrations` qeydi ilə bağlanır; bağlanmamış və ya qadağan mağazanın mesajı yazılmır. Jurnal audit-ə yazılmır (Y1); 30 gündən sonra yalnız `payload` silinir (D3).
33. **Bildirişlər:** `notify_marketplace()` Modul 03-də yazma icazəsi olan aktiv üzvlərə göndərir (Q3); `dedupe_key` eyni xəbərdarlığın təkrarını önləyir. Bildiriş ünvanları `/m/marketplace?tab=…` formasındadır.
34. **Yaradan (`user_id`) xarici açarsızdır** (Y16): istifadəçi silinsə belə şirkətin Modul 03 məlumatı qalır — `audit_log.actor_id` ilə eyni yanaşma.
