# Phase 3 · Modullar 01, 02, 04–10

Bütün 10 modul işləyir (Modul 03 — İ-4, qalan 9 — bu sənəd). Məlumat istifadəçi tərəfindən əl ilə daxil edilir
(qərar 2026-11-23); xarici API-lər (Alibaba, Amazon, birja məlumatı, şirkət kataloqları) Phase 7-də, açarlar olanda qoşulur.
ARES ən sonda qoşulacaq (Phase 6).

## Verilənlər bazası (0018–0022) — dublikat cədvəl yoxdur

| Miqrasiya | Cədvəl | Modullar | Mərkəzi cədvəllərdən istifadə |
|---|---|---|---|
| 0018 | `opportunities` | 01, 04, 05, 07, 08 | `products`, `companies` (istəyə bağlı bağlantı) |
| 0019 | `trade_documents`, `trade_document_lines`, `trade_document_post()` | 02, 06, 09 (təkliflər) | `companies` (tərəfdaş), `products` (sətir), `financial_transactions` (maliyyəyə yazma) |
| 0020 | `leads`, `lead_activities` | 09 | biznesin özü `companies`-dədir (rol `prospect`) |
| 0021 | `trading_accounts`, `trading_trades`, `trading_prices`, `trading_alerts` | 10 | fiziki ticarətdən tam ayrıdır |
| 0022 | `supplier_offers.min_order_qty` (yalnız əlavə sütun) | 02 | İ-3 cədvəli, mövcud qaydalar dəyişməyib |

Bütün cədvəllərdə: `org_id NOT NULL`, RLS (rol icazəsi `data.*` + modul icazəsi/plan/2FA `org_module_access`),
mövcud `set_row_org`, `guard_row_owner`, `check_same_org`, `audit_row` trigger-ləri, hər miqrasiya üçün geri qaytarma.

### Qaydalar
- Qeyd/sənəd başqa modula keçə bilməz (guard trigger).
- Alış/satış mərkəzi maliyyəyə **bir dəfə** yazılır, yalnız `finance.write` olan rol (məs. İşçi yox, Menecer bəli);
  yazıldıqdan sonra məbləğ, valyuta, tarix və sətirlər kilidlənir, sənəd silinmir. Təklif maliyyəyə yazılmır.
- Ticarət xəbərdarlıqları şəxsidir; yeni qiymət həddi keçəndə bir dəfə işə düşür və yalnız sahibinə bildiriş gedir.
- Qiymət qeydləri (`trading_prices`) audit-ə yazılmır (çox həcmli məlumat).
- Modul 10 heç bir birjaya/brokerə əmr göndərmir, pul köçürmür; "real" hesab yalnız qeyddir.
- Modul 09: əlaqə məlumatı yalnız açıq və qanuni mənbələrdən, istifadəçi tərəfindən daxil edilir; heç nə avtomatik yığılmır və göndərilmir.

## Ortaq hesablama (shared/modules/*.js — UI, ARES, testlər eyni kod)
- `opportunity.js` — yerində maya (rüsum, idxal ƏDV), komissiya, mənfəət, marja, ROI, şəffaf xal (0–100).
- `documents.js` — sətir cəmi (SQL `trade_line_total` ilə eyni yuvarlaqlaşdırma), sənəd cəmi/marja, nömrələmə, topdan alış hesabı.
- `leads.js` — sahə üçün tövsiyə olunan xidmətlər, namizəd xalı, növbəti əlaqə vəziyyəti, təklif mətni.
- `trading.js` — dəqiq onluq hesab (BigInt, 10 rəqəm), orta maya üsulu ilə mövqe və P/L, SMA, RSI, mövqe ölçüsü.

## Ekranlar
- `_shared/OpportunityModule.jsx` (01, 04, 05, 07, 08): İcmal, Qeydlər (axtarış, filtr, sıralama, müqayisə ≤4), Kalkulyator, Hesabatlar (+CSV).
- `_shared/DealsModule.jsx` (02, 06): İcmal, Sənədlər (alış/satış/təklif, sətirlər, çap/PDF, maliyyəyə yazma), Tərəfdaşlar, Kataloq (02: təchizatçı təklifi + MOQ), Kalkulyator, Hesabatlar.
- `b2b-client-finder/` (09): İcmal, Potensial müştərilər, Satış mərhələləri, Növbəti əlaqələr, Hesabatlar; təklif generatoru.
- `financial-trading/` (10): İcmal, Jurnal, Portfel, Qiymət və analiz (qrafik, SMA, RSI), Xəbərdarlıqlar, Risk kalkulyatoru, Hesabatlar.

## Testlər
- SQL: `tests/sql/run_modules.sh` — 81 yoxlama + köhnə dəstlər + rollback dövrü (`pg_dump` eyni).
- Unit: `tests/unit/modules.test.js` (10), cəmi 74/74.
- Brauzer: `tests/e2e/modules-harness.mjs` 39/39; köhnə dəstlər 70/70, 54/54, 26/26.

## Bilinən məhdudiyyətlər
- Valyuta məzənnələri və birja qiymətləri əl ilə yazılır (avtomatik mənbə — Phase 7).
- ƏDV / rüsum dərəcələri istifadəçi tərəfindən daxil edilir və "təxmini" sayılır.
- Modul 10: fərqli kotirovka valyutalarındakı nəticələr toplanmır.
