const TZ = 'Africa/Lagos';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });

function parse(v: string | Date): Date {
  if (v instanceof Date) return v;
  // Plain dates ('2026-09-23') are calendar dates, not instants: pin them to noon Lagos time.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+01:00`) : new Date(v);
}

/** 23 Sep 2026 — or "Sep 2019" when the source only recorded the month. */
export function formatDate(v: string | Date | null | undefined, precision: 'day' | 'month' | 'year' | null = 'day'): string {
  if (!v) return '—';
  const d = parse(v);
  if (precision === 'month') return monthFmt.format(d);
  if (precision === 'year') return String(d.getFullYear());
  return dateFmt.format(d);
}

export function formatDateTime(v: string | Date | null | undefined): string {
  return v ? dateTimeFmt.format(parse(v)) : '—';
}

/** "just now", "5 min ago", "yesterday", else a date */
export function formatRelative(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = parse(v);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return dateFmt.format(d);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-NG')} ${n === 1 ? one : many}`;
}

export function firstName(full: string | null | undefined): string {
  return (full ?? '').trim().split(/\s+/)[0] || 'there';
}
