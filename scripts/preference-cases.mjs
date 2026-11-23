// Prints "<expected t|f>\t<json>" lines: the JS rule's verdict for each case.
// tests/sql/run_phase2b.sh asks public.valid_preferences() the same and compares.
import { validPreferences } from '../shared/preferences.js';

const pad = (n) => 'x'.repeat(n);
const cases = [
  {}, { theme: 'light' }, { theme: 'dark' }, { theme: 'neon' }, { theme: 1 }, { theme: null },
  { sidebar: 'expanded' }, { sidebar: 'collapsed' }, { sidebar: 'wide' },
  { onboarding_dismissed: true }, { onboarding_dismissed: false }, { onboarding_dismissed: 'true' },
  { timezone: 'Asia/Baku' }, { timezone: 'UTC' }, { timezone: 'America/Argentina/Buenos_Aires' },
  { timezone: 'Etc/GMT+4' }, { timezone: '../etc/passwd' }, { timezone: 'Asia/Baku; drop' }, { timezone: pad(65) },
  { is_admin: true }, { role: 'owner' }, { theme: 'dark', extra: 1 },
  { theme: 'dark', sidebar: 'collapsed', onboarding_dismissed: true, timezone: 'Europe/Istanbul' },
  [1, 2], 'dark', 42, null, true,
  // oversized (the 8 KB limit is a second line of defence: every allowed value is already short)
  { timezone: pad(9000) }, { notes: pad(9000) },
];

for (const c of cases) process.stdout.write(`${validPreferences(c) ? 't' : 'f'}\t${JSON.stringify(c)}\n`);
