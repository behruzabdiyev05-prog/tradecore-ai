# TRADECORE AI

AI dəstəkli biznes, ticarət, bazar araşdırması və kommersiya idarəetmə platforması. **ARES** — platformanın mərkəzi AI beyni.

**Status:** Phase 1 — Core Architecture (v0.1.0). Arxitektura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Dəyişikliklər: [`CHANGELOG.md`](CHANGELOG.md).

## Texnologiyalar
React 19 · Vite · Supabase (PostgreSQL + Auth) · Netlify (hosting + Functions)

## Quraşdırma

### 1. Supabase
1. [supabase.com](https://supabase.com)-da layihə yaradın.
2. **SQL Editor**-da `supabase/migrations/` qovluğundakı faylları **ad sırası ilə** icra edin (0001 → 0008).
   Geri qaytarmaq lazım olsa: `supabase/rollback/` skriptlərini **əks sıra ilə** (0008 → 0005) icra edin. Əvvəlcə məlumatın ixracını götürün.
   (Supabase CLI istifadə edirsinizsə: `supabase db push`.)
3. **Authentication → URL Configuration**: Site URL olaraq Netlify ünvanınızı yazın.
4. **Project Settings → API**: `Project URL` və `anon public` açarını götürün.

### 2. Lokal işə salma
```bash
npm install
cp .env.example .env      # dəyərləri doldurun
npm run dev               # yalnız frontend (http://localhost:5173)
# və ya funksiyalarla birlikdə:
npx netlify dev           # http://localhost:8888
```

### 3. Netlify-a yerləşdirmə
1. Repozitoriyanı Netlify-a qoşun (build ayarları `netlify.toml`-dan avtomatik oxunur).
2. **Site settings → Environment variables**:

| Dəyişən | Harada | Qeyd |
|---|---|---|
| `VITE_SUPABASE_URL` | build | açıq |
| `VITE_SUPABASE_ANON_KEY` | build | açıq (RLS ilə qorunur) |
| `SUPABASE_URL` | functions | |
| `SUPABASE_ANON_KEY` | functions | token yoxlaması üçün |
| `ARES_PROVIDER`, `ARES_PROVIDER_API_KEY` | functions | Phase 6 — hələ boş qalsın |

> Gizli açarları heç vaxt `VITE_` prefiksi ilə yazmayın — onlar brauzerə düşər.

## Testlər
```bash
npm test            # unit testlər (node:test, asılılıq tələb etmir) — 53 test
npm run test:sql    # Phase 1 + 2A dəsti (bütün migrasiyalar üzərində), rol matrisi sinxronu, geri qaytarma dövrü
bash tests/sql/run_phase2b.sh        # Phase 2B: 25–44 ssenariləri, ayarlar sinxronu, 2B geri qaytarma + sxem müqayisəsi
RED=1 bash tests/sql/run_phase2b.sh  # 2B testlərini 2B migrasiyaları OLMADAN işlədir (qırmızı olmalıdır)
npm run test:e2e    # brauzer testi (esbuild + playwright lazımdır; E2E_NODE_PATH ilə)
node tests/e2e/phase2b-harness.mjs   # Phase 2B brauzer testi (43–44, profil, parametrlər, bildirişlər, axtarış, dillər, 2FA)
node scripts/i18n-audit.mjs           # tərcümə yoxlaması (EN/RU ↔ AZ, baza və server mesajları)
```

Real Supabase **test** layihəsində yoxlama: `docs/SUPABASE_TEST_PLAN.md` və yalnız oxuyan `supabase/verify/phase2b_verify.sql`.

SQL testləri `postgres` istifadəçisi ilə işləyir (lokal PostgreSQL 16; Supabase-in `auth`, `storage` və Realtime hissələri üçün `tests/sql/*stub*.sql` əvəzləyiciləri).

## Dizayn
Hər bölmənin fon səhnəsi və vurğu rəngi `src/core/ui/themes.js`-də təyin olunur. Fon şəkillərini yenidən yaratmaq üçün: `python3 scripts/generate-backgrounds.py` (numpy, Pillow).

## Yeni modul əlavə etmək
1. `shared/modules.js`-ə yeni qeyd.
2. `src/modules/<key>/index.jsx` (mövcud modulu nümunə götürün).
3. `src/modules/index.js`-ə loader.
4. Yeni migrasiya: `insert into public.modules ...`.
5. `src/core/ui/themes.js`-də modula tema (fon + rəng).
`npm test` bu dördünün sinxron olduğunu yoxlayır.
