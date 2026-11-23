import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCopy, LuUserPlus } from 'react-icons/lu';
import { errorText, formatDate, t, tRole } from '../../core/i18n/index.js';
import { tenancy } from '../../core/data/tenancy.js';
import { useOrg } from '../../core/org/OrgProvider.jsx';
import { useAuth } from '../../core/auth/AuthProvider.jsx';
import { Badge, Card, EmptyState, Notice } from '../../core/ui/components.jsx';
import { ROLES, canAssignRole } from '../../../shared/permissions.js';

const roleName = (key) => tRole(key);

function InviteForm({ orgId, actorRole, onCreated }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('employee');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  // only roles this user may grant (same rule as the database)
  const grantable = ROLES.filter((r) => canAssignRole({ actorRole, targetCurrentRole: null, newRole: r.key, isSelf: false }));
  const emailRef = useRef(null);
  // "+ New → Invite a member" opens /settings/team#invite
  useEffect(() => {
    if (window.location.hash === '#invite') emailRef.current?.focus();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null); setLink(null); setCopied(false);
    try {
      const token = await tenancy.createInvite(orgId, email.trim(), role);
      setLink(`${window.location.origin}/invite/${token}`);
      setEmail('');
      onCreated();
    } catch (err) {
      setMsg(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('team.invite.new')} pad className="invite-card">
      <form className="stack" onSubmit={submit} style={{ gap: 12 }}>
        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="inv-email">{t('team.invite.email')}</label>
            <input id="inv-email" ref={emailRef} type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-role">{t('team.invite.role')}</label>
            <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {grantable.map((r) => <option key={r.key} value={r.key}>{tRole(r.key)}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}><LuUserPlus /> {t('team.invite.create')}</button>
        </div>
        {msg && <Notice tone="error">{msg}</Notice>}
        {link && (
          <div className="stack" style={{ gap: 8 }}>
            <Notice>{t('team.invite.created')}</Notice>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input invite-link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={t('team.invite.link')} />
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
                <LuCopy /> {copied ? t('team.invite.copied') : t('team.invite.copy')}
              </button>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}

export default function TeamPage() {
  const { orgId, can, role } = useOrg();
  const { user } = useAuth();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const manage = can('members.manage');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, r] = await Promise.all([tenancy.listMembers(orgId), tenancy.roles()]);
      setMembers(m ?? []);
      setRoles(r ?? []);
      if (manage) setInvites((await tenancy.listInvites(orgId)) ?? []);
    } catch (err) {
      setError(errorText(err));
    }
  }, [orgId, manage]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setError(null);
    try { await fn(); await load(); } catch (err) { setError(errorText(err)); }
  };

  const pending = invites.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  const roleKeyById = Object.fromEntries(roles.map((r) => [r.id, r.key]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('nav.team')}</div>
          <h1>{t('team.title')}</h1>
          <p>{t('team.subtitle')}</p>
        </div>
      </div>
      {error && <div style={{ marginBottom: 16 }}><Notice tone="error">{error}</Notice></div>}
      <div className="stack">
        {manage && <InviteForm orgId={orgId} actorRole={role?.key} onCreated={load} />}

        <Card title={t('team.members')} sub={t('team.rules')}>
          {!members ? <div className="card-pad faint">{t('common.loading')}</div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('team.col.member')}</th><th>{t('team.col.role')}</th><th>{t('team.col.status')}</th>{manage && <th className="r">{t('team.col.actions')}</th>}</tr></thead>
                <tbody>
                  {members.map((m) => {
                    const self = m.user_id === user?.id;
                    const options = ROLES.filter((r) => r.key === m.role_key
                      || canAssignRole({ actorRole: role?.key, targetCurrentRole: m.role_key, newRole: r.key, isSelf: self }));
                    const canTouch = manage && !self && canAssignRole({ actorRole: role?.key, targetCurrentRole: m.role_key,
                      newRole: ['owner', 'admin'].includes(m.role_key) ? m.role_key : 'viewer', isSelf: false });
                    return (
                      <tr key={m.user_id} data-member={m.email}>
                        <td>
                          <div>{m.full_name || m.email}{self && <span className="faint"> ({t('team.you')})</span>}</div>
                          <div className="faint" style={{ fontSize: 12 }}>{m.email}</div>
                        </td>
                        <td>
                          {manage && options.length > 1 ? (
                            <select className="input" style={{ height: 34, width: 150 }} value={m.role_key} aria-label={t('team.role_of', { email: m.email })}
                              onChange={(e) => act(() => tenancy.setMemberRole(orgId, m.user_id, e.target.value))}>
                              {options.map((r) => <option key={r.key} value={r.key}>{tRole(r.key)}</option>)}
                            </select>
                          ) : <Badge tone={m.role_key === 'owner' ? 'accent' : undefined}>{tRole(m.role_key, m.role_name)}</Badge>}
                        </td>
                        <td>{m.status === 'active' ? <Badge tone="ok">{t('team.status.active')}</Badge> : <Badge tone="warn">{t('team.status.suspended')}</Badge>}</td>
                        {manage && (
                          <td className="r" style={{ whiteSpace: 'nowrap' }}>
                            {canTouch && (
                              <>
                                <button className="btn btn-ghost" onClick={() => act(() => tenancy.setMemberStatus(orgId, m.user_id, m.status === 'active' ? 'suspended' : 'active'))}>
                                  {m.status === 'active' ? t('team.suspend') : t('team.activate')}
                                </button>
                                <button className="btn btn-ghost" onClick={() => window.confirm(t('team.confirm.remove')) && act(() => tenancy.removeMember(orgId, m.user_id))}>
                                  {t('team.remove')}
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {manage && (
          <Card title={t('team.invites')}>
            {pending.length === 0 ? <EmptyState title={t('team.invite.none')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('team.invite.email')}</th><th>{t('team.invite.role')}</th><th>{t('team.invite.expires')}</th><th className="r" /></tr></thead>
                  <tbody>
                    {pending.map((i) => (
                      <tr key={i.id}>
                        <td>{i.email}</td>
                        <td>{roleName(roleKeyById[i.role_id])}</td>
                        <td className="num">{formatDate(i.expires_at)}</td>
                        <td className="r"><button className="btn btn-ghost" onClick={() => act(() => tenancy.revokeInvite(i.id))}>{t('team.invite.revoke')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
