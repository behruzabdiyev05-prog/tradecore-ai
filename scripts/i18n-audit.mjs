// Translation audit (EN / RU against AZ). Prints a report; exit code 1 when a real gap exists.
//   node scripts/i18n-audit.mjs
import { readFile, readdir } from 'node:fs/promises';
import az from '../src/core/i18n/az.js';
import en from '../src/core/i18n/en.js';
import ru from '../src/core/i18n/ru.js';
import { MODULES } from '../shared/modules.js';
import { ROLES } from '../shared/permissions.js';
import { CURRENCY_CODES, TRANSACTION_KINDS } from '../shared/finance.js';
import { INTEGRATIONS } from '../shared/integrations.js';

const root = new URL('../', import.meta.url);
const SOURCED = /^(mod|role|cur|tx|month|integration)\./;
const AZ_LETTERS = /[əƏğĞıİşŞçÇöÖüÜ]/;
const CYRILLIC = /[Ѐ-ӿ]/;
// Names that stay the same in every language
const SAME_OK = /^(ARES|Admin|Status|E-mail|Plan|Server API|TRADECORE AI|Amazon|eBay|Shopify|MODUL)/;
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const problems = [];
const notes = [];

// 1. keys + placeholders
const azKeys = Object.keys(az);
for (const [lang, d] of [['en', en], ['ru', ru]]) {
  for (const k of azKeys) {
    if (!(k in d)) problems.push(`${lang}: missing ${k}`);
    else if (!String(d[k]).trim()) problems.push(`${lang}: empty ${k}`);
    else if (ph(d[k]) !== ph(az[k])) problems.push(`${lang}: placeholders differ in ${k}`);
  }
  for (const k of Object.keys(d)) if (!(k in az) && !SOURCED.test(k)) problems.push(`${lang}: extra key ${k}`);
}

// 2. shared names (modules, roles, currencies, transaction kinds, months, integrations)
const sourcedKeys = [
  ...MODULES.flatMap((m) => ['name', 'shortName', 'summary', ...m.features.map((_, i) => `f${i}`)].map((f) => `mod.${m.key}.${f}`)),
  ...ROLES.map((r) => `role.${r.key}`), ...CURRENCY_CODES.map((c) => `cur.${c}`),
  ...Object.keys(TRANSACTION_KINDS).map((k) => `tx.${k}`), ...Array.from({ length: 12 }, (_, i) => `month.${i}`),
];
const localNames = INTEGRATIONS.filter((i) => AZ_LETTERS.test(i.name) || /\(AZ\)|xidməti|məlumatları/.test(i.name)).map((i) => `integration.${i.key}`);
for (const [lang, d] of [['en', en], ['ru', ru]]) {
  for (const k of [...sourcedKeys, ...localNames]) if (!d[k]) problems.push(`${lang}: shared name not translated: ${k}`);
}

// 3. wrong alphabet / untranslated text
for (const [lang, d] of [['en', en], ['ru', ru]]) {
  for (const [k, v] of Object.entries(d)) {
    const text = String(v).replace(/«[^»]*»|"[^"]*"|\{\w+\}/g, '');   // quoted names and placeholders may be anything
    if (AZ_LETTERS.test(text) && !/VÖEN/.test(text)) problems.push(`${lang}: Azerbaijani letters in ${k}: ${v}`);
    if (lang === 'en' && CYRILLIC.test(text)) problems.push(`en: Cyrillic in ${k}: ${v}`);
    if (lang === 'ru' && !CYRILLIC.test(text) && /[a-z]{4,}/i.test(text) && !SAME_OK.test(text)
        && !/^(Amazon|eBay|Shopify|B2B|Forex|PNG|E-mail|Google|ARES_PROVIDER)/.test(text) && !/^[\d\s.,:/()+-]*$/.test(text)) {
      notes.push(`ru: Latin-only text in ${k}: ${v}`);
    }
    if (k in az && v === az[k] && !SAME_OK.test(String(v)) && !/^[\d\s{}a-z_.,:/()+%-]*$/i.test(String(v))) problems.push(`${lang}: identical to AZ (untranslated?) ${k}: ${v}`);
  }
}

// 4. database messages: every exception text raised in the 2A/2B SQL has an srv.* entry
const raised = new Set();
for (const f of (await readdir(new URL('supabase/migrations/', root))).filter((x) => x >= '20261122')) {
  const sql = await readFile(new URL(`supabase/migrations/${f}`, root), 'utf8');
  for (const m of sql.matchAll(/(?:_deny\('|raise exception ')([^'%]+?)(?:'|\s*%)/g)) raised.add(m[1].trim().replace(/:$/, ''));
}
const srv = new Set(Object.entries(az).filter(([k]) => k.startsWith('srv.')).map(([, v]) => v));
for (const msg of raised) if (!srv.has(msg) && !/^audit_log|^org_id|^Başqa şirkətin|^Planın|^Naməlum rol$/.test(msg)) notes.push(`database message without translation: "${msg}"`);

// 4b. server (Netlify) messages shown to the user: every one has an srv.* entry
const serverMsgs = new Set();
async function walkServer(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) await walkServer(p);
    else if (e.name.endsWith('.mjs') && e.name !== 'context.mjs') {   // context.mjs = ARES system prompt, not UI text
      const src = await readFile(p, 'utf8');
      for (const m of src.matchAll(/'([^'\n]*[əƏğĞıİşŞçÇöÖüÜ][^'\n]*)'/g)) serverMsgs.add(m[1]);
    }
  }
}
await walkServer(new URL('netlify/', root));
for (const msg of serverMsgs) if (!srv.has(msg)) problems.push(`server message without translation: "${msg}"`);

// 5. unused dictionary keys (kept for compatibility are listed, not failed)
const used = new Set();
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) await walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !p.pathname.includes('/i18n/')) {
      const src = await readFile(p, 'utf8');
      for (const m of src.matchAll(/'([a-z0-9_.-]+(?:\.[a-z0-9_-]+)+)'/g)) used.add(m[1]);
    }
  }
}
await walk(new URL('src/', root));
const dynamic = /^(time\.|srv\.|notif\.|mw\.tab\.|finance\.group\.|plan\.status\.|search\.group\.|orgpage\.|onboarding\.|ares\.ex\.|team\.status\.|auth\.|file\.|mw\.status\.|mfa\.(code_wrong|no_factor|code_needed)|password\.|db\.|storage\.|nav\.|settings\.|shortcuts\.)/;
const KEPT = ['invite.success', 'invite.continue'];   // Phase 2A keys, kept so 2A code paths stay valid
const unused = azKeys.filter((k) => !used.has(k) && !dynamic.test(k) && !KEPT.includes(k));

console.log(`AZ keys: ${azKeys.length} · EN keys: ${Object.keys(en).length} · RU keys: ${Object.keys(ru).length}`);
console.log(`Shared names translated: ${sourcedKeys.length + localNames.length} per language`);
console.log(`Database messages checked: ${raised.size} · server messages checked: ${serverMsgs.size}`);
console.log(`\nProblems (${problems.length}):`); for (const p of problems) console.log('  ✗', p);
console.log(`\nNotes (${notes.length}):`); for (const n of notes) console.log('  •', n);
console.log(`\nUnused keys (${unused.length}): ${unused.join(', ') || '—'}`);
process.exit(problems.length ? 1 : 0);
