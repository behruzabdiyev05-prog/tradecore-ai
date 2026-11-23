# Changelog

## [Unreleased] — 2026-11-23 · İ-4: Modul 03 (Marketplace) ekranları (budaq `i4-marketplace`; əsas sayta təsdiqdən sonra)

### Əlavə edildi
- **Modul 03 öz tabları ilə:** İcmal, Məhsullar, Sifarişlər, Təchizatçılar, Kalkulyator, Mağaza və parametrlər (+ ümumi Maliyyə və AI).
- **Məhsullar:** əl ilə məhsul (mərkəzi `products` + `marketplace_listings`), axtarış, status və "stok azdır" filtri, mənfəət/marja sütunları, redaktə, tarixçə, silmə — sifarişi olan məhsul silinmir, "Qaralama" təklif olunur (D6). Shopify məhsulunda satış qiyməti və stok kilidlidir (D1).
- **Sifarişlər:** əl ilə sifariş yalnız `marketplace_create_manual_order()` ilə (D4 atomik stok, D7 unikal nömrə), status, izləmə, təchizatçı sifarişi/ödənişi, arxiv (D2), yalnız əl ilə sifarişi silmək, tarixçə, mənfəət.
- **Təchizatçılar:** təkliflər (valyuta + istifadəçinin yazdığı məzənnə), ən ucuz işarəsi, əsas təchizatçı, qiymət tarixçəsi.
- **Kalkulyator:** bir ədəd üçün mənfəət, marja, ROI, zərərsiz qiymət, istənilən marja üçün qiymət; ƏDV "təxmini" nişanı ilə (D5, `shared/marketplace/vat.js`); daxil edilənlər istifadəçi üçün `marketplace_calc_prefs`-də saxlanılır.
- **Mağaza və parametrlər:** ödəniş komissiyası, sabit komissiya, az stok həddi (`integrations.manage`); Shopify vəziyyəti (Y7).
- `shared/marketplace/calc.js` — qəpiklə hesablama (UI, ARES və testlər üçün ümumi).
- Bildiriş linkləri (`/m/marketplace?tab=…`) birbaşa uyğun tabı açır.
- Lüğət: 248 yeni açar (AZ/EN/RU) + İ-3-ün 31 baza mesajının EN/RU tərcüməsi; dəyər daxil olan mesajlar ("… : 3", "… {n} …") da tərcümə olunur.
- **Testlər:** `tests/unit/marketplace.test.js` (8), `tests/e2e/marketplace-harness.mjs` (26 brauzer yoxlaması) + `tests/e2e/supabase-mock-mp.js`.

### Dəyişdi
- `ModuleWorkspace`: istəyə bağlı `tabs` və `sectionProps` (digər modullar dəyişməyib).
- i18n audit: dəyərli baza mesajları və dinamik `mp.*` açarları tanınır.

### Testlər
- Unit 64/64 · i18n 0 problem · E2E: 2A 70/70, 2B 54/54, İ-4 26/26 · SQL dəyişməyib (İ-3 303/303).

## [Unreleased] — 2026-11-21 · İ-3: Modul 03 (Marketplace / DropPilot) — miqrasiyalar, RLS, təhlükəsizlik (yalnız lokal; Supabase-ə tətbiq edilməyib, deploy edilməyib)

### Əlavə edildi
- **5 miqrasiya + 5 geri qaytarma (0013–0017):** `marketplace_listings`, `marketplace_variants`, `marketplace_orders`, `marketplace_order_lines`, `marketplace_settings`, `marketplace_calc_prefs`, `supplier_offers`, `supplier_offer_prices`, `integration_events`. Hamısında `org_id NOT NULL`, RLS (icazə + plan + 2FA mövcud köməkçilərlə), mövcud tenant və audit trigger-ləri. Pul qəpiklə (`*_minor bigint`).
- **Funksiyalar:** kataloq və sifariş idxalı (DropPilot-un dondurma qaydaları), inventar, webhook jurnalı, 30 günlük təmizləmə (D3), atomik əl ilə sifariş (D4, D7), tarixçə, mağaza vəziyyəti (Y7), məhsul silmə (D6), canlı NovaNest mağazasının bloklanması (Y13).
- **Testlər:** `tests/sql/marketplace_tests.sql` — 303 yoxlama (əvvəl qırmızı: 301 uğursuz), `tests/sql/run_marketplace.sh` (köhnə testlər + verify + rollback dövrü + `pg_dump` müqayisəsi), `tests/sql/marketplace_parity.sh` (DropPilot-un öz SQL funksiyası ilə qəpik səviyyəsində müqayisə).
- **`supabase/verify/marketplace_verify.sql`** — real TEST layihəsi üçün 27 yalnız oxuyan yoxlama.
- **`docs/MARKETPLACE_INTEGRATION.md`** — dəyişikliklər və DropPilot-dan fərqlər.

### Dəyişdi
- `notifications`: boş buraxıla bilən `dedupe_key` + qismən unikal indeks (İ-2 §3). `notify()` dəyişməyib.
- `integrations`: Shopify domeni üzrə unikal indeks (İ-2 §3).

### Plandan kənarlaşma
- **Y17:** sifariş sətrinə öz dondurulmuş məzənnəsi əlavə edildi — müqayisə testi DropPilot-dan fərq tapdı (sonradan əlavə olunan sətrin refund-u).
- **Y16:** yeni cədvəllərdə `user_id` `auth.users`-ə xarici açarla bağlanmır (istifadəçi silinsə məlumat itmir).
- D1 qoruyucuları 0014-də; `marketplace_create_manual_order` `SECURITY DEFINER` (daxildə icazə yoxlaması) — D4-ü yan keçmək olmasın.

## [Unreleased] — 2026-11-21 · Phase 2B: Profil, parametrlər, bildirişlər, axtarış, naviqasiya (yalnız lokal; deploy edilməyib)

### Əlavə edildi
- **Profil (`/profile`):** ad, telefon, vəzifə, profil şəkli (gizli `avatars` bucket-i, 2 MB, PNG/JPEG/WebP), e-poçt dəyişmə (təsdiq linki ilə), şifrə dəyişmə (cari şifrə yenidən yoxlanılır; 2FA aktivdirsə kod da soruşulur), digər cihazlardan çıxış, dil seçimi.
- **İki addımlı giriş (TOTP):** QR kodla qoşulma, söndürmə, girişdən sonra kod ekranı (aal1 → aal2). **Şirkət səviyyəsində məcburi 2FA** (G qərarı): Sahib rolları seçir, standart olaraq söndürülüdür; 2FA-sız sessiya həmin şirkətin məlumatını görmür (RLS, migrasiya 0012). Sahib öz rolunu 2FA-sız sessiyadan məcburi edə bilməz (bloklanma qoruması).
- **Parametrlər mərkəzi (`/settings`):** Görünüş və dil, Bildirişlər, Şirkət (rekvizitlər: hüquqi ad, VÖEN, ünvan, telefon, e-poçt, sayt, loqo), Komanda, Təhlükəsizlik (yalnız Sahib), Plan, Audit, İnteqrasiyalar. Köhnə `/system/...` ünvanları işləyir.
- **Bildirişlər mərkəzi:** `notifications` + `notification_preferences` (0010). Bildiriş yalnız bazada `notify()` ilə yaranır; brauzer yarada, dəyişə, silə bilmir. Komanda hadisələri və təhlükəsizlik siyasəti üçün trigger-lər. Zəng ikonu (oxunmamış sayı, son 10), `/notifications` səhifəsi (filtr, "daha çox"), "Mənim fəaliyyətim" (`my_activity`), Realtime (yalnız öz sətirləri). Avtomatik silinmə yoxdur (J qərarı).
- **Ümumi axtarış:** `global_search()` (0011) — şirkətlər, məhsullar, saxlanılmış qeydlər, komanda üzvləri, öz bildirişləri; `az_fold()` (ə→e, ş→s …), `pg_trgm` ilə yazı xətalarına dözümlülük; `Ctrl+K` əmr paneli, `/search` səhifəsi, son axtarışlar.
- **Naviqasiya reyestri** (`src/core/navigation/registry.js`): menyu, əmr paneli, "İz" sətri, marşrut qoruması eyni siyahıdan; "+ Yeni" menyusu (yalnız işlək formalar), son baxılanlar (istifadəçi + şirkət üzrə), qısayollar (`G` sonra `D/S/N/P`, `?`), mobil axtarış düyməsi, "İlk addımlar" kartı.
- **Çoxdillilik (F/K):** AZ (əsas), EN, RU — 480 açar + modul/rol/valyuta/ay adları; dil profildə saxlanılır (bütün cihazlar). Bütün köhnə ekran mətnləri lüğətə köçürüldü; Azərbaycan mətnləri dəyişməyib.
- **Testlər:** 25–44 təhlükəsizlik ssenariləri (148 SQL yoxlaması, kod yazılmazdan əvvəl qırmızı işə salma qeydə alınıb), 18 yeni unit test, 54 yeni brauzer yoxlaması (`tests/e2e/phase2b-harness.mjs`), ayarlar qaydası JS↔DB sinxronu, geri qaytarmadan sonra sxemin 2A ilə `pg_dump` müqayisəsi.
- **Geri qaytarma skriptləri:** 0009–0012 üçün.

### Dəyişdi
- `profiles`: yazma icazəsi sütun səviyyəsinə keçdi; `active_org_id` birbaşa yazıla bilməz (yalnız `switch_org`). Phase 1-dən qalan boşluq bağlandı.
- `member_org_ids`, `org_ids_with`, `org_module_access`, `check_access`, `switch_org` yeni migrasiyada (0012) 2FA qaydası ilə yeniləndi; 2A faylları dəyişməyib. `check_access` yeni cavab qaytarır: `mfa_required` → server `403 MFA_REQUIRED`.
- Yuxarı panel: modul axtarışı əmr panelinə çevrildi (eyni `.module-jump`, `Ctrl+K`), zəng ikonu, "+ Yeni", "İz" sətri, avatar profilə aparır. Kiçik telefonlarda saat və rejim düyməsi gizlənir (rejim Parametrlərdədir).
- Açıq/tünd rejim və menyu genişliyi profil ayarlarında da saxlanılır.

### Plandan kənarlaşma
- `global_search()` plana görə `security invoker` olmalı idi. RLS altında PostgreSQL leakproof olmayan funksiyaları indeks şərti kimi istifadə etmir; nəticədə hər axtarış tam skan idi (170–330 ms, hədəf 300 ms). Funksiya `security definer` edildi və mənbə cədvəllərin RLS şərtlərini eyni köməkçi funksiyalarla özü tətbiq edir. 8 istifadəçi üzrə "hər nəticə RLS ilə də görünür" testi əlavə olundu. İndi: 140–200 ms (adversarial test məlumatı).

### Yekun hazırlıq (Phase 2B qəbulundan sonra)
- **Təhlükəsizlik düzəlişi:** 2FA tələb edən şirkətdə Sahib 2FA-sız sessiyadan siyasəti söndürə bilirdi. İndi siyasəti dəyişən şəxsin rolu köhnə və ya yeni siyasətdə varsa, `aal2` tələb olunur (0012-də `set_security_policy` yenilənib; geri qaytarma 0009 versiyasını bərpa edir). 2 yeni SQL yoxlaması.
- **Tərcümə yoxlaması:** `scripts/i18n-audit.mjs` — açar və yer tutucu uyğunluğu, səhv əlifba, tərcümə olunmamış mətn, verilənlər bazası (26) və server (25) mesajlarının əhatəsi. 17 server mesajının tərcüməsi əlavə olundu (480 açar).
- **Xətaların göstərilməsi:** 9 yerdə xam `err.message` əvəzinə `errorText()` (lüğət açarı və ya tərcümə olunmuş server mesajı); unit testlə qorunur.
- **Keçid qaydası:** axtarış nəticələri də bildirişlər kimi yalnız daxili ünvan qəbul edir (`INTERNAL_LINK`, bazadakı qayda ilə eyni, unit test).
- **Dil seçicisi:** profil yüklənməyəndə cari dili göstərir.
- **Real Supabase testinə hazırlıq:** `docs/SUPABASE_TEST_PLAN.md`, yalnız oxuyan yoxlama skripti `supabase/verify/phase2b_verify.sql` (24 yoxlama; `run_phase2b.sh` hər dəfə işlədir).

### Dəyişməyənlər
- Phase 1 və 2A-nın 8 migrasiyası, 4 geri qaytarma skripti və bütün köhnə testlər (unit, SQL, E2E, mock) bayt-bayt eynidir; hamısı keçir (35 unit, 112 tenancy yoxlaması, 70/70 E2E).
- 10 modulun qovluqları və strukturu.

## [Unreleased] — 2026-11-21 · Phase 2A: SaaS təməli (yalnız lokal; deploy edilməyib)

### Əlavə edildi
- **Təşkilatlar (multi-tenant):** `organizations`, `organization_members`, `permissions`, `roles`, `role_permissions`, `organization_invites`, `plans`, `organization_subscriptions` (migrasiya 0005).
- **5 sistem rolu** (Sahib, Admin, Menecer, İşçi, Müşahidəçi) və 31 icazə açarı; reyestr `shared/permissions.js`, baza ilə avtomatik sinxron yoxlanılır.
- **Giriş funksiyaları və RPC-lər** (0006): `is_member`, `has_permission`, `org_has_module`, `check_access`, `my_orgs`, `switch_org`, `create_organization`, `list_members`, `create_invite`, `accept_invite`, `revoke_invite`, `set_member_role`, `set_member_status`, `remove_member`. Sonuncu Sahibin qorunması (trigger).
- **Qeydiyyat:** dəvətsiz istifadəçiyə avtomatik şirkət + Sahib rolu; qeydiyyat formasında "Şirkətin adı" məcburidir. Dəvətlə gələn mövcud şirkətə qoşulur.
- **Dəvətlər:** 32 baytlıq təsadüfi token, bazada yalnız SHA-256 heşi, 7 gün, bir dəfəlik, e-poçt uyğunluğu; link kopyalanıb əl ilə göndərilir.
- **Audit jurnalı** (0008): 14 cədvəldə trigger; dəyişdirmək/silmək/boşaltmaq bazada qadağandır (DB sahibi rolu üçün də).
- **Server:** `requireMember()` — üzvlük və icazə istifadəçinin öz tokeni ilə `check_access` RPC vasitəsilə yoxlanılır; `service_role` istifadə olunmur.
- **Frontend:** `OrgProvider`, `usePermission`, `<Can>`, şirkət dəyişdirici, icazəyə görə menyu; Komanda, Şirkət, Audit jurnalı, Plan, Dəvət səhifələri; "İcazə yoxdur" səhifəsi; minimal i18n (`t()`), AZ lüğəti.
- **Testlər:** 24 təhlükəsizlik ssenarisi (112 SQL yoxlaması + server + brauzer), rol matrisi sinxron testi, migrasiya geri qaytarma dövrü testi, 9 yeni unit test, 24 yeni E2E yoxlama.
- **Geri qaytarma skriptləri:** `supabase/rollback/*.down.sql` (hər yeni migrasiya üçün).

### Dəyişdi
- 10 biznes cədvəlinə `org_id` (0007); mövcud sətirlər yaradıcının şirkətinə köçürülür. `user_id` "kim yaradıb" kimi qalır.
- RLS "yalnız öz sətirlərim" əvəzinə "şirkət üzvlüyü + icazə (+ plan)" qaydasına keçdi. İstifadəçi indi şirkətinin qeydlərini görür (icazəsi daxilində).
- `finance_module_summary` view-u `org_id` üzrə qruplaşdırılır (hesablama tərifləri dəyişməyib).
- `exchange_rates` və `integrations` unikal açarları şirkət üzrədir.
- `anon` rolunun biznes cədvəllərinə bütün hüquqları ləğv edildi; `authenticated` üçün TRUNCATE/REFERENCES/TRIGGER götürüldü.
- Xarici açarlar şirkətlərarası istinada icazə vermir (Phase 1-dəki boşluq bağlandı).
- `/api/ares` və `/api/integrations` şirkət üzvlüyü və icazə tələb edir.

### Dəyişməyənlər
- Phase 1-in 4 migrasiya faylı, `tests/sql/tests.sql` və bütün köhnə testlər (yalnız server mock-u yeni RPC-ni cavablandırmaq üçün genişləndirilib).

## [Unreleased] — 2026-11-21 · Phase 1 UI yenilənməsi (Glass dizayn)

### Dəyişdi
- **Açıq rejim standart oldu:** açıq, buzlu şüşə panellər, tünd mətn və gündüz tonlarında fonlar. Tünd rejim yuxarı paneldəki düymə ilə seçilir; seçim yadda saxlanılır (`src/core/ui/mode.js`).
- İnterfeys "glass" üslubuna keçirildi: yarımşəffaf, bulanıq (backdrop-blur) panellər, pill düymələr, seqmentli tablar.
- Sol menyu üzən ikon panelinə (rail) çevrildi; genişləndirmə düyməsi var, seçim yadda saxlanılır. Mobil versiyada açılan menyu kimi qalır.
- Yuxarı panel: TRADECORE AI pill, səhifə yolu, modul axtarışı (Ctrl+K), ARES düyməsi, canlı saat, valyuta, profil.
- Hər bölmənin öz fon səhnəsi və vurğu rəngi var (`src/core/ui/themes.js`). Səhnələr arasında yumşaq keçid var.

### Əlavə edildi
- 7 orijinal fon səhnəsi, hər birinin açıq (`public/backgrounds/light/`) və tünd versiyası (`public/backgrounds/`, `scripts/generate-backgrounds.py` ilə yaradılıb): aurora, okean, dağlar, meşə, şəhər, səhra, dumanlıq.
- SVG qrafikləri (`src/core/ui/charts.jsx`): kapsul sütunlar, donut, gauge. Hamısı yalnız real məlumatla işləyir; məlumat olmadıqda bunu açıq göstərir.
- İdarə paneli: son 8 ayın gəlir dinamikası, modullar üzrə gəlir payı, saxlanılmış qeydlər.
- Maliyyə mərkəzi: xalis mənfəət marjası göstəricisi.
- `monthlySeries`, `netMarginPercent` (testlərlə).

## [0.1.0] — 2026-11-21 · Phase 1: Core Architecture

### Əlavə edildi
- React 19 + Vite frontend arxitekturası, Netlify konfiqurasiyası (`netlify.toml`: build, `/api/*` yönləndirmə, SPA fallback, təhlükəsizlik başlıqları).
- Supabase Auth ilə autentifikasiya: giriş, qeydiyyat, şifrə bərpası, sessiyanın saxlanması, çıxış.
- 10 müstəqil modulun strukturu: ayrıca qovluq, kök komponent, lazy chunk, standart iş sahəsi (7 bölmə), sidebar naviqasiyası.
- Mərkəzi modul reyestri (`shared/modules.js`).
- PostgreSQL sxemi (4 migrasiya): profillər, modullar, valyutalar, şirkətlər, məhsullar, saxlanılmış qeydlər, modul hadisələri, fəaliyyət tarixçəsi, maliyyə əməliyyatları, məzənnələr, maliyyə xülasə view-u, ARES söhbətləri, inteqrasiyalar. Hamısında RLS.
- Mərkəzi maliyyə kitabxanası (`shared/finance.js`): tam ədəd pul riyaziyyatı, AZN + USD/EUR/TRY/CNY/GBP, mənfəət/pul axını hesabları.
- Modullararası event bus + `module_events` cədvəli.
- ARES infrastrukturu: frontend provider + panel (mərkəzi və modul konteksti), `/api/ares` endpoint-i, provayder adapter reyestri, sistem qaydaları.
- Netlify Functions: `health`, `ares`, `integrations` (server tərəfli token yoxlaması).
- Səhifələr: İdarə paneli, Maliyyə mərkəzi, Sistem və inteqrasiyalar, 404, konfiqurasiya ekranı.
- Premium dark dizayn, responsive (desktop / planşet / mobil).
- Testlər: 23 unit, SQL/RLS testi, 32 E2E yoxlama.

### Qəsdən edilməyənlər (növbəti mərhələlər)
- Modulların funksiyaları (Phase 3), maliyyə məlumatı daxiletmə interfeysi (Phase 4), AI provayderinin qoşulması (Phase 6), xarici API-lər (Phase 7).
