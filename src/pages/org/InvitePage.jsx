/**
 * Accept a pending invite (token from /invite/<token>). If it fails, the user chooses:
 * ask for a new invite, or create their own company — the system never decides for them.
 */
import { useEffect, useRef, useState } from 'react';
import { errorText, t } from '../../core/i18n/index.js';
import { tenancy, pendingInvite } from '../../core/data/tenancy.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useRouter } from '../../core/router/router.jsx';
import { useAuth } from '../../core/auth/AuthProvider.jsx';
import { Brand } from '../../layout/Sidebar.jsx';
import { Notice } from '../../core/ui/components.jsx';
import { CreateOrgForm } from './NoOrgPage.jsx';

export default function InvitePage() {
  const { reload, switchOrg, orgs } = useOrg();
  const { navigate } = useRouter();
  const { signOut } = useAuth();
  const [state, setState] = useState({ phase: 'accepting' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;     // StrictMode: accept only once
    started.current = true;
    const token = pendingInvite.get();
    tenancy.acceptInvite(token)
      .then(async (orgId) => {
        pendingInvite.clear();
        await switchOrg(orgId);
        navigate('/', { replace: true });
      })
      .catch((err) => setState({ phase: 'failed', message: errorText(err) }));
  }, [switchOrg, navigate]);

  const discard = async () => {
    pendingInvite.clear();
    await reload();
    navigate('/', { replace: true });
  };

  return (
    <div className="center-screen">
      <div className="card auth-card" style={{ width: 'min(480px, 100%)' }}>
        <Brand />
        <h1 style={{ fontSize: 20 }}>{t('invite.title')}</h1>
        {state.phase === 'accepting' && <p className="muted">{t('invite.accepting')}</p>}
        {state.phase === 'failed' && (
          <>
            <Notice tone="error">{t('invite.failed')}: {state.message}</Notice>
            <p className="muted">{t('invite.options')}</p>
            {orgs.length > 0
              ? <button className="btn btn-primary" onClick={discard}>{t('invite.discard')}</button>
              : <CreateOrgForm onCreated={discard} />}
            <button className="btn btn-ghost" onClick={signOut}>{t('auth.signout')}</button>
          </>
        )}
      </div>
    </div>
  );
}
