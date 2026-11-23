/**
 * "First steps" card on the dashboard. Every step's state is computed from real data
 * (profile, organization details, team size, 2FA) — nothing is ticked by hand.
 * Hidden when the profile is unavailable or the user dismissed it (saved in preferences).
 */
import { useEffect, useState } from 'react';
import { LuCircle, LuCircleCheck, LuX } from 'react-icons/lu';
import { useProfile } from '../core/profile/ProfileProvider.jsx';
import { useOrg } from '../core/org/OrgProvider.jsx';
import { account } from '../core/data/account.js';
import { tenancy } from '../core/data/tenancy.js';
import { Link } from '../core/router/router.jsx';
import { t } from '../core/i18n/index.js';

export default function OnboardingCard() {
  const { profile, available, setPreference } = useProfile();
  const { orgId, can } = useOrg();
  const [facts, setFacts] = useState(null);
  const dismissed = profile?.preferences?.onboarding_dismissed === true;

  useEffect(() => {
    if (!available || dismissed) return undefined;
    let alive = true;
    Promise.all([
      can('org.manage') ? account.orgDetails(orgId).catch(() => null) : Promise.resolve(null),
      can('members.manage') ? tenancy.listMembers(orgId).catch(() => null) : Promise.resolve(null),
      account.mfaFactors().catch(() => ({ available: false, totp: [] })),
    ]).then(([org, members, mfa]) => alive && setFacts({ org, members, mfa }));
    return () => { alive = false; };
  }, [available, dismissed, orgId, can]);

  if (!available || dismissed || !facts) return null;
  const steps = [
    { key: 'profile', done: Boolean(profile.full_name && profile.job_title && profile.phone), to: '/profile' },
    can('org.manage') && { key: 'org', done: Boolean(facts.org?.legal_name && facts.org?.tax_id), to: '/settings/organization' },
    can('members.manage') && { key: 'team', done: (facts.members?.length ?? 0) > 1, to: '/settings/team#invite' },
    facts.mfa.available && { key: 'mfa', done: facts.mfa.totp.length > 0, to: '/profile' },
  ].filter(Boolean);
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section className="card onboarding" aria-label={t('onboarding.title')}>
      <header className="card-head">
        <div><h2>{t('onboarding.title')}</h2><div className="sub">{t('onboarding.progress', { done: doneCount, total: steps.length })}</div></div>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={t('onboarding.dismiss')} onClick={() => setPreference('onboarding_dismissed', true)}><LuX /></button>
      </header>
      <ol className="onboarding-steps">
        {steps.map((s) => (
          <li key={s.key} data-done={s.done}>
            {s.done ? <LuCircleCheck className="pos" aria-hidden /> : <LuCircle className="faint" aria-hidden />}
            {s.done ? <span>{t(`onboarding.${s.key}`)}</span> : <Link to={s.to}>{t(`onboarding.${s.key}`)}</Link>}
            <span className="sr-only">{s.done ? t('onboarding.done') : t('onboarding.todo')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
