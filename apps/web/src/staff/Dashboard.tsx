import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, Flag, Inbox, Search, ThumbsUp } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useMasterData } from '@/app/hooks';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { firstName } from '@/lib/format';
import type { Filters, Tone } from '@/lib/types';
import { Card, ErrorState, Select, Skeleton, cx } from '@/design/ui';
import { BarList, ChartCard, ColumnChart, Kpi, LegendKey, SERIES_1, SERIES_2, TrendChart } from './charts';
import { PageTitle, listHref, useUrlFilters } from './shell';
import { RowsTable } from './Grievances';

const TONE_BAR: Record<Tone, string> = {
  info: '#2463a8', progress: SERIES_1, warning: '#a0650d', success: '#247748', muted: '#8d877e', neutral: '#8d877e', danger: '#b03228',
};

/* ---------------------------------------------------------------- Admin / organisation overview */
export function Dashboard() {
  const [filters, , patch] = useUrlFilters();
  const master = useMasterData();
  const q = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api.dashboard(filters) });
  const nav = useNavigate();
  const go = (f: Filters) => nav(listHref({ ...filters, ...f }));
  const k = q.data?.kpis;
  const d = master.data;

  return (
    <div>
      <PageTitle title="Overview" subtitle="All grievances from 2018 to today, live." />
      {d && (
          <div className="-mt-3 mb-5 flex flex-wrap gap-2 no-print">
            <Select aria-label="Year" className="h-10 w-auto text-sm" value={filters.year ?? ''} onChange={(e) => patch({ year: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">All years</option>{(q.data?.years ?? []).slice().reverse().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select aria-label="Community type" className="h-10 w-auto text-sm" value={filters.community_type_id ?? ''} onChange={(e) => patch({ community_type_id: e.target.value ? Number(e.target.value) : undefined, cluster_id: undefined, community_id: undefined })}>
              <option value="">All community types</option>{d.community_types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Select aria-label="Category" className="h-10 w-auto text-sm" value={filters.category_id ?? ''} onChange={(e) => patch({ category_id: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">All categories</option>{d.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {Object.keys(filters).length > 0 && <button className="px-2 text-sm font-semibold text-brand-700" onClick={() => patch({ year: undefined, community_type_id: undefined, category_id: undefined, cluster_id: undefined, community_id: undefined })}>Clear</button>}
          </div>
        )}

      {q.isError ? <ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} /> : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" aria-label="Key figures">
            {!k ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[98px]" />) : <>
              <Kpi label="Total" value={k.total.toLocaleString()} onClick={() => go({})} />
              <Kpi label="Open" value={k.open.toLocaleString()} onClick={() => go({ open: true })} />
              <Kpi label="Under review" value={k.under_review + k.submitted} onClick={() => go({ status: ['SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED'] })} hint={`${k.submitted} new`} />
              <Kpi label="In progress" value={k.in_progress} onClick={() => go({ status: ['IN_PROGRESS', 'AWAITING_ACTION', 'REOPENED'] })} />
              <Kpi label="Resolved" value={k.resolved} onClick={() => go({ status: ['RESOLVED'] })} hint={`${k.awaiting_ack} awaiting acknowledgement`} />
              <Kpi label="Closed" value={k.closed.toLocaleString()} onClick={() => go({ status: ['CLOSED'] })} />
              <Kpi label="Overdue" value={k.overdue} tone={k.overdue ? 'danger' : 'neutral'} icon={k.overdue ? <AlertTriangle className="h-4 w-4 text-danger" aria-hidden /> : null} onClick={() => go({ overdue: true })} hint={`${k.due_soon} due soon`} />
              <Kpi label="Resolution rate" value={k.resolution_rate != null ? `${k.resolution_rate}%` : '—'} tone="success"
                hint={k.avg_resolution_days != null ? `avg ${k.avg_resolution_days} days to resolve` : 'resolved or closed'} />
            </>}
          </section>

          {q.data && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Received vs resolved" subtitle="Last 12 months"
                legend={<><LegendKey color={SERIES_1} label="Received" line /><LegendKey color={SERIES_2} label="Resolved" line /></>}
                table={{ head: ['Month', 'Received', 'Resolved'], rows: q.data.by_month.map((m) => [String(m.key), m.received ?? 0, m.resolved ?? 0]) }}>
                <TrendChart data={q.data.by_month.map((m) => ({ key: String(m.key), a: m.received ?? 0, b: m.resolved ?? 0 }))} />
              </ChartCard>
              <ChartCard title="Grievances by year" subtitle="Click a year to see its grievances"
                table={{ head: ['Year', 'Total', 'Still open'], rows: q.data.by_year.map((y) => [String(y.key), y.total ?? 0, y.open ?? 0]) }}>
                <ColumnChart data={q.data.by_year.map((y) => ({ key: String(y.key), value: y.total ?? 0, secondary: y.open, href: listHref({ ...filters, year: Number(y.key) }) }))} />
              </ChartCard>
              <ChartCard title="By community type" table={{ head: ['Type', 'Total', 'Open'], rows: q.data.by_type.map((t) => [String(t.key), t.total ?? 0, t.open ?? 0]) }}>
                <BarList secondaryLabel="open" data={q.data.by_type.map((t) => ({ key: String(t.key), value: t.total ?? 0, secondary: t.open, href: t.id ? listHref({ ...filters, community_type_id: Number(t.id) }) : undefined }))} />
              </ChartCard>
              <ChartCard title="Pipeline grievances by cluster" table={{ head: ['Cluster', 'Total', 'Open'], rows: q.data.by_cluster.map((t) => [String(t.key), t.total ?? 0, t.open ?? 0]) }}>
                <BarList secondaryLabel="open" emptyText="No pipeline grievances in this selection" data={q.data.by_cluster.map((t) => ({ key: String(t.key), value: t.total ?? 0, secondary: t.open, href: listHref({ ...filters, cluster_id: Number(t.id) }) }))} />
              </ChartCard>
              <ChartCard title="By category" table={{ head: ['Category', 'Total', 'Open'], rows: q.data.by_category.map((t) => [String(t.key), t.total ?? 0, t.open ?? 0]) }}>
                <BarList secondaryLabel="open" data={q.data.by_category.map((t) => ({ key: String(t.key), value: t.total ?? 0, secondary: t.open, href: t.id ? listHref({ ...filters, category_id: Number(t.id) }) : undefined }))} />
              </ChartCard>
              <ChartCard title="Top communities" subtitle="15 with the most grievances" table={{ head: ['Community', 'Total', 'Open'], rows: q.data.by_community.map((t) => [String(t.key), t.total ?? 0, t.open ?? 0]) }}>
                <BarList secondaryLabel="open" data={q.data.by_community.map((t) => ({ key: String(t.key), value: t.total ?? 0, secondary: t.open, href: t.id ? listHref({ ...filters, community_id: String(t.id) }) : undefined }))} />
              </ChartCard>
              <ChartCard title="Resolution status" subtitle="Status is shown with its label, not colour alone" table={{ head: ['Status', 'Grievances'], rows: q.data.by_status.map((t) => [String(t.key), t.total ?? 0]) }}>
                <BarList data={q.data.by_status.map((t) => ({ key: String(t.key), value: t.total ?? 0, color: TONE_BAR[t.tone ?? 'neutral'], href: listHref({ ...filters, status: [String(t.code)] }) }))} />
              </ChartCard>
              <ChartCard title="By severity" subtitle="Severity was not recorded before 2024" table={{ head: ['Severity', 'Grievances'], rows: q.data.by_severity.map((t) => [String(t.key), t.total ?? 0]) }}>
                <BarList data={q.data.by_severity.map((t) => ({ key: String(t.key), value: t.total ?? 0, href: t.id ? listHref({ ...filters, severity_id: Number(t.id) }) : undefined }))} />
              </ChartCard>
              <div className="lg:col-span-2">
                <ChartCard title="Officer workload" subtitle="Open grievances per officer" table={{ head: ['Officer', 'Open', 'Overdue', 'Resolved/closed'], rows: q.data.officer_workload.map((o) => [String(o.key), o.open ?? 0, o.overdue ?? 0, o.resolved ?? 0]) }}>
                  <BarList secondaryLabel="overdue" data={q.data.officer_workload.map((o) => ({ key: String(o.key), value: o.open ?? 0, secondary: o.overdue, href: o.id ? listHref({ ...filters, officer_id: String(o.id), open: true }) : listHref({ ...filters, unassigned: true }) }))} emptyText="No open grievances" />
                </ChartCard>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Officer home */
export function OfficerHome() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const home = useQuery({ queryKey: ['officer-home'], queryFn: api.officerHome, refetchInterval: 60_000 });
  const overdue = useQuery({ queryKey: ['officer-overdue'], queryFn: () => api.staffList({ overdue: true }, 1, 5, 'days_desc') });
  const h = home.data;
  const cards: { label: string; value?: number; tone: 'danger' | 'warning' | 'neutral' | 'success'; icon: typeof Inbox; f: Filters; hint: string }[] = [
    { label: 'Overdue', value: h?.overdue, tone: 'danger', icon: AlertTriangle, f: { overdue: true }, hint: 'past the 3-working-day limit' },
    { label: 'Due soon', value: h?.due_soon, tone: 'warning', icon: CalendarClock, f: { due_soon: true }, hint: 'within 24 hours' },
    { label: 'New', value: h?.new, tone: 'neutral', icon: Inbox, f: { status: ['SUBMITTED', 'ASSIGNED'] }, hint: 'not yet reviewed' },
    { label: 'In progress', value: h?.in_progress, tone: 'neutral', icon: Clock, f: { status: ['IN_PROGRESS', 'AWAITING_ACTION', 'REOPENED'] }, hint: 'action being taken' },
    { label: 'Awaiting acknowledgement', value: h?.awaiting_ack, tone: 'neutral', icon: ThumbsUp, f: { needs_ack: true }, hint: 'resolved, waiting for complainant' },
    { label: 'Needs review', value: h?.needs_review, tone: 'warning', icon: Flag, f: { flagged: true, open: true }, hint: 'historical items to check' },
  ];
  return (
    <div>
      <PageTitle title={`Good ${greeting()}, ${firstName(profile?.full_name)}`} subtitle={h ? `${h.assigned_open} open grievances assigned to you` : ' '} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <button key={c.label} onClick={() => nav(listHref(c.f))}
            className={cx('flex flex-col rounded-2xl bg-surface p-4 text-left shadow-card ring-1 transition-shadow hover:shadow-raised',
              c.tone === 'danger' && c.value ? 'ring-2 ring-danger/50' : 'ring-line/70')}>
            <span className={cx('flex items-center gap-1.5 text-sm font-semibold', c.tone === 'danger' && c.value ? 'text-danger' : 'text-ink-500')}>
              <c.icon className="h-4 w-4" aria-hidden />{c.label.toUpperCase()}
            </span>
            {home.isLoading ? <Skeleton className="mt-2 h-9 w-12" /> : (
              <span className={cx('mt-1 text-[34px] font-bold leading-none tabular', c.tone === 'danger' && c.value ? 'text-danger' : 'text-ink-900')}>{c.value ?? 0}</span>
            )}
            <span className="mt-2 text-xs text-ink-500">{c.hint}</span>
          </button>
        ))}
      </section>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="h-5 w-5 text-danger" aria-hidden />Attention required</h2>
          <Link to={listHref({ overdue: true })} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">All overdue <ArrowRight className="h-4 w-4" /></Link>
        </div>
        {overdue.isLoading ? <Skeleton className="h-40" />
          : overdue.data?.rows.length ? <RowsTable rows={overdue.data.rows} />
          : <p className="flex items-center gap-2 py-6 text-ink-500"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden />Nothing overdue. Well done.</p>}
      </Card>

      <div className="mt-6">
        <Link to="/grievances" className="flex items-center gap-3 rounded-2xl bg-surface p-4 font-semibold shadow-card ring-1 ring-line/70 hover:shadow-raised">
          <Search className="h-5 w-5 text-brand-700" /> Search all grievances in my responsibility <ArrowRight className="ml-auto h-5 w-5 text-ink-400" />
        </Link>
      </div>
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
