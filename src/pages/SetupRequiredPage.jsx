import { Brand } from '../layout/Sidebar.jsx';
import { Notice } from '../core/ui/components.jsx';
import { t } from '../core/i18n/index.js';

/** Shown when Supabase public config is missing — the app never runs on fake data. */
export default function SetupRequiredPage() {
  return (
    <div className="center-screen">
      <div className="card auth-card" style={{ width: 'min(560px, 100%)' }}>
        <Brand />
        <h1 style={{ fontSize: 20 }}>{t('setup.title')}</h1>
        <Notice>{t('setup.body')}</Notice>
        <p className="muted">{t('setup.env.before')} <code>.env</code> {t('setup.env.after')}</p>
        <div className="code">{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<public-anon-key>`}</div>
        <p className="faint" style={{ fontSize: 12.5 }}>{t('setup.migrations.before')} <code>supabase/migrations</code> {t('setup.migrations.after')}</p>
      </div>
    </div>
  );
}
