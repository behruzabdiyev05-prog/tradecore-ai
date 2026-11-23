# Real Supabase test planı (Phase 2A + 2B)

**Yalnız ayrıca TEST layihəsində.** Production layihəsinə və Netlify production-a heç nə tətbiq edilmir. Hər addım istifadəçinin icazəsi ilə başlayır.

## 1. Hazırlıq (istifadəçi)

1. Supabase-də yeni, boş **test** layihəsi yaradın (məsələn `tradecore-test`). Production layihəsindən istifadə etməyin.
2. Authentication → Providers → Email: aktiv.
3. Authentication → Multi-Factor: **TOTP** aktiv.
4. Authentication → Emails: "Secure email change" və "Secure password change" aktiv (tövsiyə).
5. Lokal `.env` faylına test layihəsinin açarları (yalnız anon açarı, `service_role` lazım deyil):
   ```
   VITE_SUPABASE_URL=https://<test-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<test anon key>
   SUPABASE_URL=https://<test-ref>.supabase.co
   SUPABASE_ANON_KEY=<test anon key>
   ```

## 2. Miqrasiyalar (ardıcıllıqla, SQL Editor və ya `supabase db push`)

| # | Fayl | Phase |
|---|---|---|
| 1 | `20261121000100_core.sql` | 1 |
| 2 | `20261121000200_shared_data.sql` | 1 |
| 3 | `20261121000300_finance.sql` | 1 |
| 4 | `20261121000400_ares_integrations.sql` | 1 |
| 5 | `20261122000500_tenancy_core.sql` | 2A |
| 6 | `20261122000600_tenancy_functions.sql` | 2A |
| 7 | `20261122000700_tenancy_business_tables.sql` | 2A |
| 8 | `20261122000800_audit_log.sql` | 2A |
| 9 | `20261123000900_profiles_settings.sql` | 2B |
| 10 | `20261123001000_notifications.sql` | 2B |
| 11 | `20261123001100_search.sql` | 2B |
| 12 | `20261123001200_mfa_enforcement.sql` | 2B |

Geri qaytarma skriptləri `supabase/rollback/` qovluğundadır və **tərs ardıcıllıqla** işlədilir.

## 3. Avtomatik yoxlama (yalnız oxuyur)

SQL Editor-da `supabase/verify/phase2b_verify.sql` işlədin. 24 sətirin hamısı **PASS** olmalıdır. Skript heç nə yaratmır, dəyişmir və silmir.

## 4. Əl ilə yoxlama (iki brauzer, iki test istifadəçisi)

| # | Yoxlama | Gözlənilən |
|---|---|---|
| 1 | A istifadəçisi qeydiyyatdan keçir ("Şirkət A") | Şirkət + Sahib rolu yaranır |
| 2 | A, B-ni "İşçi" kimi dəvət edir; B linklə qeydiyyatdan keçir | B şirkət A-ya qoşulur; A-ya "dəvətiniz qəbul olundu" bildirişi **səhifə yenilənmədən** gəlir (Realtime, ≤ 3 s) |
| 3 | A, B-nin rolunu "Menecer" edir | B-yə bildiriş gəlir; A-ya gəlmir |
| 4 | B profil şəkli yükləyir; A komanda siyahısında görür | Şəkil görünür; 2 MB-dan böyük və ya GIF fayl rədd edilir (Storage API) |
| 5 | A şirkət loqosu yükləyir; B-nin öz şirkəti (C) A-nın loqosunu görmür | Şirkətlərarası təcrid |
| 6 | Ctrl+K: B-nin adı, "seher" → "Şəhər …" | Nəticələr yalnız aktiv şirkətdən |
| 7 | A 2FA qoşur (Profil), çıxıb yenidən daxil olur | Kod ekranı çıxır; kodla daxil olur |
| 8 | A Təhlükəsizlik → "İşçi" üçün 2FA məcburi edir | B (2FA-sız) şirkət A-da "İki addımlı giriş tələb olunur" ekranını görür, məlumat açılmır |
| 9 | A 2FA-sız sessiyada siyasəti söndürməyə çalışır | Rədd edilir |
| 10 | Dil: EN → yenidən daxil ol → başqa brauzer | Dil saxlanılır |
| 11 | Şifrə dəyişmə (2FA aktivkən) | Kod soruşulur; dəyişiklik tətbiq olunur |
| 12 | E-poçt dəyişmə | Təsdiq linki gəlir; təsdiqdən sonra dəyişir |
| 13 | `/api/ares` (B, şirkət A, 2FA-sız, siyasət aktiv) | `403 MFA_REQUIRED` |

## 5. Geri qaytarma testi (test layihəsində)

1. 2B skriptlərini tərs ardıcıllıqla işlədin: 0012 → 0011 → 0010 → 0009.
2. 2A məlumatları (şirkətlər, üzvlər, audit) yerində qalmalıdır. 2B məlumatları (bildirişlər, profil sahələri, rekvizitlər) silinir.
3. Miqrasiyaları 9–12 yenidən tətbiq edin; `phase2b_verify.sql` yenə 24/24 PASS olmalıdır.
4. Storage bucket-ləri və faylları skript silmir (Supabase bunu yalnız Storage API ilə edir).

## 6. Nəticə

Hər yoxlamanın nəticəsi hesabata yazılır. Uğursuz bənd olarsa, düzəliş lokal mühitdə edilir, lokal testlərdən keçir və yalnız sonra test layihəsində təkrarlanır.
