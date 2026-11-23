# Phase 2B — dəyişikliklərin siyahısı

Müqayisə bazası: Phase 2A arxivi (`tradecore-ai-phase2a.zip`). Silinən fayl yoxdur.

Toxunulmayanlar (bayt-bayt eyni): Phase 1 və 2A-nın 8 miqrasiyası, 4 geri qaytarma skripti, bütün köhnə testlər (unit, SQL, E2E, simulyasiya), `shared/modules.js`, `src/modules/index.js` və 10 modulun `src/modules/<key>/index.jsx` faylları.

## Yeni fayllar (39)

| Fayl | Təyinat |
|---|---|
| `docs/SUPABASE_TEST_PLAN.md` | Real Supabase TEST layihəsində yoxlama planı |
| `scripts/i18n-audit.mjs` | Tərcümə yoxlaması (EN/RU ↔ AZ, baza və server mesajları) |
| `scripts/preference-cases.mjs` | Ayarlar qaydası üçün JS↔DB müqayisə halları |
| `shared/preferences.js` | Şəxsi ayarların qaydası (bazadakı valid_preferences ilə eyni) |
| `src/core/data/account.js` | 2B məlumat qatı: profil, fayllar, bildirişlər, axtarış, 2FA |
| `src/core/i18n/en.js` | İngilis lüğəti (480 açar + paylaşılan adlar) |
| `src/core/i18n/ru.js` | Rus lüğəti (480 açar + paylaşılan adlar) |
| `src/core/navigation/recent.js` | Son baxılanlar / son axtarışlar (istifadəçi + şirkət üzrə); az_fold-un brauzer versiyası |
| `src/core/navigation/registry.js` | Naviqasiya reyestri: menyu, əmr paneli, "İz", marşrut qoruması |
| `src/core/notifications/NotificationsProvider.jsx` | Aktiv şirkətin bildirişləri, Realtime abunəliyi |
| `src/core/profile/ProfileProvider.jsx` | İstifadəçi profili; dil, rejim, menyu ayarlarının sinxronu |
| `src/core/ui/rail.js` | Sol menyunun geniş/dar vəziyyəti |
| `src/layout/CommandPalette.jsx` | Ctrl+K əmr paneli və ümumi axtarış |
| `src/layout/NewMenu.jsx` | "+ Yeni" menyusu |
| `src/layout/NotificationBell.jsx` | Zəng ikonu və son 10 bildiriş |
| `src/layout/Shortcuts.jsx` | Klaviatura qısayolları və "?" pəncərəsi |
| `src/pages/MfaPages.jsx` | 2FA qurulması, girişdə kod, şirkət 2FA tələbi ekranı |
| `src/pages/NotificationsPage.jsx` | /notifications: bildirişlər və "Mənim fəaliyyətim" |
| `src/pages/OnboardingCard.jsx` | "İlk addımlar" kartı |
| `src/pages/ProfilePage.jsx` | /profile |
| `src/pages/SearchPage.jsx` | /search |
| `src/pages/SettingsPage.jsx` | /settings mərkəzi (görünüş, bildirişlər, təhlükəsizlik + 2A səhifələri) |
| `supabase/migrations/20261123000900_profiles_settings.sql` | Profil sahələri, sütun icazələri, rekvizitlər, Storage, set_security_policy |
| `supabase/migrations/20261123001000_notifications.sql` | Bildirişlər, ayarlar, trigger-lər, RPC-lər, my_activity, Realtime |
| `supabase/migrations/20261123001100_search.sql` | pg_trgm, az_fold, indekslər, global_search |
| `supabase/migrations/20261123001200_mfa_enforcement.sql` | Şirkət üzrə 2FA tətbiqi (RLS köməkçiləri), siyasətin qorunması |
| `supabase/rollback/20261123000900_profiles_settings.down.sql` | 0009 geri qaytarma |
| `supabase/rollback/20261123001000_notifications.down.sql` | 0010 geri qaytarma |
| `supabase/rollback/20261123001100_search.down.sql` | 0011 geri qaytarma |
| `supabase/rollback/20261123001200_mfa_enforcement.down.sql` | 0012 geri qaytarma (2A funksiyalarını bərpa edir) |
| `supabase/verify/phase2b_verify.sql` | Real Supabase üçün yalnız oxuyan yoxlama (24 yoxlama) |
| `tests/e2e/phase2b-harness.mjs` | 2B brauzer testi (54 yoxlama) |
| `tests/e2e/supabase-mock-2b.js` | 2A simulyasiyasını genişləndirən 2B simulyasiyası |
| `tests/sql/phase2b_tests.sql` | 25–42 təhlükəsizlik ssenariləri (148 yoxlama) |
| `tests/sql/rollback_check_2b.sql` | 2B geri qaytarma dövrünün yoxlaması |
| `tests/sql/rollback_seed_2b.sql` | 2B geri qaytarma dövrü üçün məlumat |
| `tests/sql/run_phase2b.sh` | 2B SQL dəsti (qırmızı rejim, sinxron, geri qaytarma, pg_dump müqayisəsi, verify) |
| `tests/sql/supabase_stub_2b.sql` | Lokal test üçün Storage və Realtime əvəzləyicisi |
| `tests/unit/phase2b.test.js` | 18 unit test (lüğətlər, reyestr, ayarlar, axtarış, server, keçid qaydası) |

## Dəyişdirilən fayllar (36)

| Fayl | Nə dəyişdi |
|---|---|
| `CHANGELOG.md` | 2B qeydləri |
| `README.md` | Test əmrləri, Supabase test planı |
| `docs/ARCHITECTURE.md` | 2B qərarları (20–27) |
| `netlify/lib/auth.mjs` | mfa_required → 403 MFA_REQUIRED (bir sətir əlavə) |
| `package.json` | test:sql:2b, test:e2e:2b əmrləri |
| `src/App.jsx` | Marşrutlar reyestrdən; 2FA addımı və şirkət 2FA qapısı; yeni səhifələr; dil dəyişəndə yenidən çəkmə |
| `src/core/api/client.js` | Mesajlar lüğətdən |
| `src/core/ares/AresProvider.jsx` | Xətalar errorText ilə |
| `src/core/auth/AuthProvider.jsx` | Giriş xətaları lüğətdən |
| `src/core/config/env.js` | Faza adı: Phase 2B |
| `src/core/data/db.js` | Xəta açarı lüğətdən |
| `src/core/data/tenancy.js` | Xəta açarı lüğətdən |
| `src/core/finance/useFinanceSummary.js` | Xətalar errorText ilə |
| `src/core/i18n/az.js` | Bütün AZ mətnlər (480 açar; köhnə mətnlər eyni) |
| `src/core/i18n/index.js` | Dil seçimi, EN/RU, tərcümə köməkçiləri, server mesajlarının tərcüməsi |
| `src/core/org/OrgProvider.jsx` | isOwner, şirkət 2FA qapısı; xətalar errorText ilə |
| `src/core/ui/charts.jsx` | Mətnlər lüğətdən |
| `src/core/ui/components.jsx` | Modal, Toggle; mətnlər lüğətdən |
| `src/core/ui/icons.jsx` | Reyestr ikonları |
| `src/layout/AppShell.jsx` | Son baxılanlar, qısayollar, menyu ayarı profildə |
| `src/layout/AresPanel.jsx` | Mətnlər lüğətdən |
| `src/layout/Sidebar.jsx` | Menyu reyestrdən (eyni ünvanlar) + Parametrlər |
| `src/layout/Topbar.jsx` | Əmr paneli, zəng, "+ Yeni", "İz", avatar → profil |
| `src/modules/_shared/ModuleWorkspace.jsx` | Mətnlər lüğətdən (modul strukturu dəyişməyib) |
| `src/pages/DashboardPage.jsx` | Mətnlər lüğətdən; İlk addımlar kartı |
| `src/pages/FinancePage.jsx` | Mətnlər lüğətdən |
| `src/pages/LoginPage.jsx` | Mətnlər lüğətdən; dil seçimi |
| `src/pages/SetupRequiredPage.jsx` | Mətnlər lüğətdən |
| `src/pages/SystemPage.jsx` | Mətnlər lüğətdən; xətalar errorText ilə |
| `src/pages/org/AuditPage.jsx` | Tarix formatı və xətalar |
| `src/pages/org/InvitePage.jsx` | Xətalar və mətnlər |
| `src/pages/org/NoOrgPage.jsx` | Yaradılan şirkətin id-si qaytarılır; mətnlər |
| `src/pages/org/OrganizationPage.jsx` | Rekvizitlər (VÖEN yoxlaması) və loqo |
| `src/pages/org/PlanPage.jsx` | Mətnlər lüğətdən |
| `src/pages/org/TeamPage.jsx` | Rol adları tərcümədə; #invite fokusu |
| `src/styles/global.css` | Yeni komponentlərin stilləri (yalnız faylın sonuna əlavə) |

Bu siyahıya `docs/reports/` (test nəticələri) və bu faylın özü daxil deyil.
