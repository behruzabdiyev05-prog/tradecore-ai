/**
 * "+ New" menu. Lists ONLY actions that already have a working form:
 * invite a member (members.manage) and create a company. Company, product and
 * transaction forms are added here when Phases 3–4 build them.
 */
import { useEffect, useRef, useState } from 'react';
import { LuBuilding2, LuPlus, LuUserPlus } from 'react-icons/lu';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { useRouter } from '../core/router/router.jsx';
import { t } from '../core/i18n/index.js';
import { Modal } from '../core/ui/components.jsx';
import { CreateOrgForm } from '../pages/org/NoOrgPage.jsx';

export default function NewMenu() {
  const { can, switchOrg } = useOrg();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const items = [
    can('members.manage') && { key: 'invite', icon: LuUserPlus, label: t('new.invite'), run: () => navigate('/settings/team#invite') },
    { key: 'org', icon: LuBuilding2, label: t('new.organization'), run: () => setDialog('org') },
  ].filter(Boolean);

  return (
    <div className="new-menu" ref={ref}>
      <button type="button" className="btn new-menu-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <LuPlus aria-hidden /><span className="new-menu-text">{t('new.button')}</span>
      </button>
      {open && (
        <div className="module-jump-list new-menu-list" role="menu">
          {items.map((i) => (
            <button key={i.key} type="button" role="menuitem" onClick={() => { setOpen(false); i.run(); }}>
              <i.icon aria-hidden /> {i.label}
            </button>
          ))}
        </div>
      )}
      {dialog === 'org' && (
        <Modal title={t('new.organization')} onClose={() => setDialog(null)}>
          <p className="muted" style={{ marginBottom: 12 }}>{t('new.organization.body')}</p>
          <CreateOrgFormSwitch onDone={async (orgId) => { setDialog(null); if (orgId) await switchOrg(orgId); navigate('/'); }} />
        </Modal>
      )}
    </div>
  );
}

/** Create a company and switch to it. */
function CreateOrgFormSwitch({ onDone }) {
  return <CreateOrgForm onCreated={(orgId) => onDone(orgId)} />;
}
