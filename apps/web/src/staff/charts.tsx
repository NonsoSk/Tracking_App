import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table2, BarChart3 } from 'lucide-react';
import { Card, cx } from '@/design/ui';

/**
 * Hand-built SVG/HTML charts (no chart library to download).
 * Specs: thin marks (<=24px bars, 4px rounded data-end, square at baseline),
 * 2px lines, >=8px markers with a 2px surface ring, hairline recessive grid,
 * text in ink tokens (never series colour), hover tooltip on every mark,
 * a table view for every chart, and click-through to the underlying grievances.
 * Series colours validated with the dataviz palette checker (light surface):
 * SERIES_1 teal / SERIES_2 burnt orange pass lightness, chroma, CVD and contrast.
 */
export const SERIES_1 = '#008a7e';
export const SERIES_2 = '#c2610f';
const GRID = 'rgb(231 226 218)';

export function ChartCard({ title, subtitle, children, table, legend }: {
  title: string; subtitle?: string; children: ReactNode; table?: { head: string[]; rows: (string | number)[][] }; legend?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h3 className="font-semibold">{title}</h3>{subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}</div>
        {table && (
          <button onClick={() => setAsTable((v) => !v)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-canvas no-print"
            aria-label={asTable ? 'Show chart' : 'Show as table'} title={asTable ? 'Show chart' : 'Show as table'}>
            {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        )}
      </div>
      {legend && !asTable && <div className="mb-3 flex flex-wrap gap-4 text-sm text-ink-700">{legend}</div>}
      {asTable && table ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr>{table.head.map((h, i) => <th key={h} className={cx('border-b border-line pb-2 font-semibold text-ink-500', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cx('border-b border-line/60 py-1.5', j ? 'text-right tabular' : '')}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </Card>
  );
}

export function LegendKey({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return <span className="inline-flex items-center gap-2">{line ? <span className="h-0.5 w-4 rounded" style={{ background: color }} /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}{label}</span>;
}

/* ---------------------------------------------------------------- horizontal bar list */
export interface BarDatum { key: string; value: number; secondary?: number; href?: string; color?: string; icon?: ReactNode }

export function BarList({ data, valueLabel = 'grievances', secondaryLabel, max: maxIn, emptyText = 'No data' }: {
  data: BarDatum[]; valueLabel?: string; secondaryLabel?: string; max?: number; emptyText?: string;
}) {
  const nav = useNavigate();
  const max = maxIn ?? Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-8 text-center text-ink-500">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-ink-900">{d.icon}{d.key}</span>
              <span className="shrink-0 tabular text-ink-700">
                <span className="font-semibold text-ink-900">{d.value.toLocaleString()}</span>
                {secondaryLabel && d.secondary != null && <span className="text-ink-500"> · {d.secondary.toLocaleString()} {secondaryLabel}</span>}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-r-[4px] bg-canvas" style={{ maxHeight: 24 }}>
              <div className="h-full rounded-r-[4px] transition-[width] duration-500" style={{ width: `${Math.max(pct, d.value ? 1.5 : 0)}%`, background: d.color ?? SERIES_1 }} />
            </div>
          </>
        );
        return (
          <li key={d.key}>
            {d.href
              ? <button onClick={() => nav(d.href!)} title={`${d.key}: ${d.value} ${valueLabel}${secondaryLabel && d.secondary != null ? `, ${d.secondary} ${secondaryLabel}` : ''} (open list)`}
                  className="-mx-2 block w-[calc(100%+16px)] rounded-lg px-2 py-1 text-left hover:bg-canvas focus-visible:bg-canvas">{body}</button>
              : <div title={`${d.key}: ${d.value} ${valueLabel}`}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- vertical columns (e.g. by year) */
export function ColumnChart({ data, height = 200 }: { data: BarDatum[]; height?: number }) {
  const nav = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const W = 600; const padL = 36; const padB = 26; const H = height;
  const band = (W - padL) / Math.max(data.length, 1);
  const bw = Math.min(24, band * 0.6);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grievances by year">
        {ticks.map((t) => {
          const y = (H - padB) - (t / max) * (H - padB - 10);
          return <g key={t}><line x1={padL} x2={W} y1={y} y2={y} stroke={GRID} strokeWidth={1} /><text x={padL - 8} y={y + 4} textAnchor="end" className="fill-ink-500 text-[11px]">{Math.round(t).toLocaleString()}</text></g>;
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * (H - padB - 10);
          const x = padL + band * i + (band - bw) / 2;
          const y = H - padB - h;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => d.href && nav(d.href)} className={d.href ? 'cursor-pointer' : ''}>
              <rect x={padL + band * i} y={0} width={band} height={H - padB} fill="transparent" />
              <path d={roundedTop(x, y, bw, h, 4)} fill={SERIES_1} opacity={hover === null || hover === i ? 1 : 0.45} />
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-ink-500 text-[11px]">{d.key}</text>
              {hover === i && <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="fill-ink-900 text-[12px] font-semibold">{d.value}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute right-0 top-0 rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-raised">
          <b>{data[hover].key}</b>: {data[hover].value} grievances{data[hover].secondary != null ? ` · ${data[hover].secondary} open` : ''}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- two-series line (received vs resolved per month) */
export function TrendChart({ data, height = 220 }: { data: { key: string; a: number; b: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640; const padL = 36; const padR = 16; const padB = 26; const H = height;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.a, d.b])));
  const x = (i: number) => padL + (data.length <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (data.length - 1));
  const y = (v: number) => H - padB - (v / max) * (H - padB - 12);
  const path = (k: 'a' | 'b') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[k])}`).join('');
  const area = `${path('a')}L${x(data.length - 1)},${H - padB}L${x(0)},${H - padB}Z`;
  const months = useMemo(() => data.map((d) => new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(`${d.key}-15`))), [data]);
  if (!data.length) return <p className="py-8 text-center text-ink-500">No grievances in this period</p>;
  const last = data.length - 1;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Grievances received and resolved per month"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0; data.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
          setHover(best);
        }}>
        {[0, max / 2, max].map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-ink-500 text-[11px]">{Math.round(t)}</text></g>)}
        {months.map((m, i) => (data.length <= 12 || i % 2 === 0) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-500 text-[11px]">{m}</text>)}
        <path d={area} fill={SERIES_1} opacity={0.1} />
        <path d={path('a')} fill="none" stroke={SERIES_1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('b')} fill="none" stroke={SERIES_2} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={H - padB} stroke="rgb(141 135 126)" strokeWidth={1} />}
        {[{ k: 'a' as const, c: SERIES_1 }, { k: 'b' as const, c: SERIES_2 }].map(({ k, c }) => (
          <g key={k}>
            {(hover !== null ? [hover] : [last]).map((i) => <circle key={i} cx={x(i)} cy={y(data[i][k])} r={4.5} fill={c} stroke="white" strokeWidth={2} />)}
          </g>
        ))}
        {hover === null && <>
          <text x={x(last) - 8} y={y(data[last].a) - 10} textAnchor="end" className="fill-ink-900 text-[12px] font-semibold">{data[last].a}</text>
        </>}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-12 top-0 rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-raised">
          <p className="font-semibold">{new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${data[hover].key}-15`))}</p>
          <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES_1 }} />Received {data[hover].a}</p>
          <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES_2 }} />Resolved {data[hover].b}</p>
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/* ---------------------------------------------------------------- KPI tile */
export function Kpi({ label, value, hint, onClick, tone = 'neutral', icon }: {
  label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; tone?: 'neutral' | 'danger' | 'warning' | 'success'; icon?: ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('group flex flex-col rounded-2xl bg-surface p-4 text-left shadow-card ring-1 ring-line/70 transition-shadow',
      onClick && 'hover:shadow-raised focus-visible:shadow-raised', tone === 'danger' && 'ring-danger/30')}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-500">{icon}{label}</span>
      <span className={cx('mt-1 text-[28px] font-bold leading-tight tabular',
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink-900')}>{value}</span>
      {hint && <span className="mt-0.5 text-xs text-ink-500">{hint}</span>}
    </Tag>
  );
}
