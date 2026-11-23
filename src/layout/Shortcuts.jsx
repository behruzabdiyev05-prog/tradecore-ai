/**
 * Keyboard shortcuts: "G then D/S/N/P" to navigate, "?" for the list.
 * Ignored while typing in a field. Ctrl+K is handled by the command palette.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../core/router/router.jsx';
import { t } from '../core/i18n/index.js';
import { Modal } from '../core/ui/components.jsx';
import { SHORTCUTS } from '../core/navigation/registry.js';

const typing = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export default function Shortcuts() {
  const { navigate } = useRouter();
  const [help, setHelp] = useState(false);
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      const k = e.key.toLowerCase();
      if (k === 'g') { pendingG.current = Date.now(); return; }
      if (Date.now() - pendingG.current < 1200) {
        const hit = SHORTCUTS.find((s) => s.to && s.keys[0] === 'G' && s.keys[1].toLowerCase() === k);
        pendingG.current = 0;
        if (hit) { e.preventDefault(); navigate(hit.to); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (!help) return null;
  return (
    <Modal title={t('shortcuts.title')} onClose={() => setHelp(false)}>
      <div className="status-list shortcuts-list">
        {SHORTCUTS.map((s) => (
          <div className="status-row" key={s.labelKey}>
            <span className="label">{t(s.labelKey)}</span>
            <span>{s.keys.map((k, i) => <span key={k}>{i > 0 && <span className="faint"> {s.keys[0] === 'G' ? t('shortcuts.then') : '+'} </span>}<kbd className="kbd-inline">{k}</kbd></span>)}</span>
          </div>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>{t('shortcuts.note')}</p>
    </Modal>
  );
}
