import { useEffect, useRef, useState } from 'react';
import { LuSend, LuSparkles, LuX } from 'react-icons/lu';
import { MODULES, getModule } from '../../shared/modules.js';
import { useAres } from '../core/ares/AresProvider.jsx';
import { Badge } from '../core/ui/components.jsx';
import { t, tModule, tServerError } from '../core/i18n/index.js';

/** Example commands per scope (dictionary keys ares.ex.<scope>.<n>). */
const EXAMPLES = { central: 2, wholesale: 1, 'import-export': 1, 'b2b-client-finder': 1, 'financial-trading': 1 };
const examplesFor = (scope) => Array.from({ length: EXAMPLES[scope] ?? 0 }, (_, i) => t(`ares.ex.${scope}.${i}`));

function StatusBadge({ status }) {
  if (status.state === 'ready') return <Badge tone="ok">{t('common.active')}</Badge>;
  if (status.state === 'checking') return <Badge>{t('system.state.checking')}</Badge>;
  if (status.state === 'not_configured') return <Badge tone="warn">{t('system.state.not_connected')}</Badge>;
  return <Badge tone="err">{t('ares.unavailable')}</Badge>;
}

export default function AresPanel() {
  const { setOpen, scope, setScope, messages, send, pending, status } = useAres();
  const [text, setText] = useState('');
  const bodyRef = useRef(null);
  const mod = scope ? getModule(scope) : null;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length]);

  const submit = (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText('');
  };

  const examples = examplesFor(scope ?? 'central');

  return (
    <aside className="ares" aria-label={t('ares.label')}>
      <div className="ares-head">
        <span className="ares-orb"><LuSparkles aria-hidden /></span>
        <div className="ares-title">AR<span>E</span>S</div>
        <StatusBadge status={status} />
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label={t('ares.close')}><LuX /></button>
      </div>

      <div className="ares-scope">
        <label className="sr-only" htmlFor="ares-scope">{t('ares.scope')}</label>
        <select id="ares-scope" value={scope ?? ''} onChange={(e) => setScope(e.target.value || null)}>
          <option value="">{t('ares.central')}</option>
          {MODULES.map((m) => <option key={m.key} value={m.key}>{m.code} · {t('mw.assistant', { name: tModule(m, 'name') })}</option>)}
        </select>
      </div>

      <div className="ares-body" ref={bodyRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ares-intro">
            <p>
              {mod ? t('ares.intro.module', { name: tModule(mod, 'name') }) : t('ares.intro.central')}
            </p>
            {status.state !== 'ready' && (
              <div className="msg msg-system">
                {status.state === 'checking'
                  ? t('ares.status.checking')
                  : status.state === 'not_configured'
                    ? `${t('ares.status.not_configured')} ${tServerError(status.reason) ?? ''}`
                    : `${t('ares.status.unreachable')}: ${status.message ?? ''}`}
              </div>
            )}
            {examples.length > 0 && (
              <div className="ares-examples">
                <span className="faint">{t('ares.examples')}</span>
                {examples.map((ex) => <button key={ex} type="button" onClick={() => setText(ex)}>{ex}</button>)}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>{m.role === 'system' ? tServerError(m.content) : m.content}</div>
        ))}
        {pending && <div className="msg msg-assistant faint">{t('ares.thinking')}</div>}
      </div>

      <form className="ares-input" onSubmit={submit}>
        <textarea
          rows={1}
          placeholder={mod ? `${tModule(mod, 'shortName')}: ${t('ares.placeholder')}` : t('ares.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          aria-label={t('ares.message')}
        />
        <button className="btn btn-primary btn-icon" type="submit" disabled={pending || !text.trim()} aria-label={t('ares.send')}>
          <LuSend />
        </button>
      </form>
    </aside>
  );
}
