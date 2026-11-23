/**
 * Dependency-free SVG charts in the glass style.
 * Every chart renders only the data it is given. With no data it shows the
 * empty chart frame plus a clear "no data yet" label — never sample values.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n/index.js';

/** Track an element's pixel width so SVG charts draw at true scale. */
function useWidth(initial = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const PALETTE = ['var(--accent)', 'var(--accent-2)', '#6aa8ff', '#4fd1a1', '#f2c14e', '#f07171', '#b18cff', '#5fd3e8', '#ff8fb1', '#c9c2b8', '#8fd16a'];
export const chartColor = (i) => PALETTE[i % PALETTE.length];

function EmptyOverlay({ text }) {
  return <div className="chart-empty"><span>{text}</span></div>;
}

/**
 * Capsule bar chart (pill-shaped bars on ghost tracks).
 * @param {{data:{key:string,label:string,value:number}[], format:(n:number)=>string, height?:number, emptyText?:string}} p
 */
export function CapsuleBars({ data, format, height = 240, emptyText = t('common.no_data_yet') }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const [ref, w] = useWidth();
  const max = Math.max(0, ...data.map((d) => d.value));
  const empty = max <= 0;
  const step = w / Math.max(1, data.length);
  const top = 34; // room for tooltip
  const bottom = 26; // room for labels
  const plotH = height - top - bottom;
  const barW = Math.max(10, Math.min(20, step * 0.28));
  const peak = empty ? -1 : data.findIndex((d) => d.value === max);
  const active = hover ?? peak;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} role="img"
        aria-label={empty ? emptyText : data.map((d) => `${d.label}: ${format(d.value)}`).join(', ')}
        style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <linearGradient id={`cap-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--chart-ink)', stopOpacity: 0.75 }} />
            <stop offset="100%" style={{ stopColor: 'var(--chart-ink)', stopOpacity: 0.08 }} />
          </linearGradient>
          <linearGradient id={`capHot-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: '#fff' }} />
            <stop offset="35%" style={{ stopColor: 'var(--accent)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--accent-2)', stopOpacity: 0.15 }} />
          </linearGradient>
          <linearGradient id={`track-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--chart-ink)', stopOpacity: 0.08 }} />
            <stop offset="100%" style={{ stopColor: 'var(--chart-ink)', stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={w} y1={top + plotH * (1 - f)} y2={top + plotH * (1 - f)}
            style={{ stroke: 'var(--chart-track)' }} strokeDasharray="2 6" />
        ))}
        {data.map((d, i) => {
          const cx = i * step + step / 2;
          const h = empty ? 0 : Math.max(barW, (d.value / max) * plotH);
          const y = top + plotH - h;
          const hot = i === active && !empty;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - barW / 2} y={top} width={barW} height={plotH} rx={barW / 2} fill={`url(#track-${uid})`} />
              {!empty && d.value > 0 && (
                <rect x={cx - barW / 2} y={y} width={barW} height={h} rx={barW / 2}
                  fill={hot ? `url(#capHot-${uid})` : `url(#cap-${uid})`}
                  style={hot ? { filter: 'drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 60%, transparent))' } : undefined} />
              )}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="11"
                style={{ fill: hot ? 'var(--text)' : 'var(--text-3)' }} fontWeight={hot ? 600 : 400}>{d.label}</text>
              {hot && d.value > 0 && (
                <g>
                  <rect x={cx - 42} y={y - 30} width="84" height="22" rx="11" style={{ fill: 'var(--selected-bg)' }} />
                  <text x={cx} y={y - 15} textAnchor="middle" className="chart-tip">{format(d.value)}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {empty && <EmptyOverlay text={emptyText} />}
    </div>
  );
}

/**
 * Donut with rounded, gapped segments.
 * @param {{segments:{label:string,value:number,color?:string}[], centerTop?:string, centerValue:string, size?:number}} p
 */
export function Donut({ segments, centerTop, centerValue, size = 168 }) {
  const stroke = 16;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 10 : 0;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={total ? segments.map((s) => `${s.label}: ${s.value}`).join(', ') : t('common.no_data')} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--chart-track)' }} strokeWidth={stroke} />
      {total > 0 && segments.map((s, i) => {
        if (s.value <= 0) return null;
        const len = (s.value / total) * c;
        const dash = Math.max(0.01, len - gap);
        const el = (
          <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
            style={{ stroke: s.color ?? chartColor(i) }} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        );
        offset += len;
        return el;
      })}
      {centerTop && <text x="50%" y="44%" textAnchor="middle" fontSize="10.5" style={{ fill: 'var(--text-3)' }}>{centerTop}</text>}
      <text x="50%" y={centerTop ? '58%' : '53%'} textAnchor="middle" fontSize="18" fontWeight="600" style={{ fill: 'var(--text)' }}>{centerValue}</text>
    </svg>
  );
}

/**
 * Semicircle gauge. `value` is a percentage (may be null = no data).
 */
export function Gauge({ value, label, size = 200 }) {
  const stroke = 14;
  const r = size / 2 - stroke;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const arc = Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? 'var(--chart-track)' : value < 0 ? 'var(--negative)' : 'var(--accent)';
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg width={size} height={size / 2 + 34} viewBox={`0 0 ${size} ${size / 2 + 34}`} role="img"
      aria-label={value == null ? `${label}: ${t('common.no_data').toLowerCase()}` : `${label}: ${value}%`}>
      <path d={path} fill="none" style={{ stroke: 'var(--chart-track)' }} strokeWidth={stroke} strokeLinecap="round" />
      {value != null && v > 0 && (
        <path d={path} fill="none" style={{ stroke: tone }} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * arc} ${arc}`} />
      )}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="26" fontWeight="600" style={{ fill: 'var(--text)' }}>
        {value == null ? '—' : `${value}%`}
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize="11" style={{ fill: 'var(--text-3)' }}>{label}</text>
    </svg>
  );
}
