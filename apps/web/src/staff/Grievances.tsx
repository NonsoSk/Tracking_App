import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, Download, Flag, History, SlidersHorizontal, X } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useMasterData } from '@/app/hooks';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { Filters, StaffRow } from '@/lib/types';
import { Button, Chip, EmptyState, ErrorState, OverdueBadge, SearchInput, Select, Skeleton, StatusBadge, cx, useToast } from '@/design/ui';
import { PageTitle, useUrlFilters } from './shell';
import { downloadCsv, downloadXlsx } from './export';

export function useStaffDirectory() {
  return useQuery({ queryKey: ['staff-directory'], queryFn: api.listStaff, staleTime: 5 * 60_000 });
}

/* ---------------------------------------------------------------- filter bar */
export function FilterBar({ filters, onChange, compact }: { filters: Filters; onChange: (f: Filters) => void; compact?: boolean }) {
  const master = useMasterData();
  const staff = useStaffDirectory();
  const { can } = useAuth();
  const [more, setMore] = useState(false);
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if ((filters.q ?? '') !== q) onChange({ ...filters, q: q || undefined }); }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = master.data;
  const set = (k: keyof Filters, v: unknown) => onChange(Object.fromEntries(Object.entries({ ...filters, [k]: v === '' ? undefined : v }).filter(([, x]) => x !== undefined)) as Filters);
  const clusters = d?.clusters.filter((c) => !filters.community_type_id || c.community_type_id === filters.community_type_id) ?? [];
  const communities = d?.communities.filter((c) =>
    (!filters.community_type_id || c.affiliations.some((a) => a.community_type_id === filters.community_type_id)) &&
    (!filters.cluster_id || c.affiliations.some((a) => a.cluster_id === filters.cluster_id))) ?? [];
  const active = Object.keys(filters).filter((k) => k !== 'q').length;
  const years = Array.from({ length: new Date().getFullYear() - 2017 }, (_, i) => 2018 + i).reverse();

  return (
    <div className="space-y-3 no-print">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1"><SearchInput placeholder="Search tracking ID, name, phone, community, category or text" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search grievances" /></div>
        {!compact && <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setMore((m) => !m)} aria-expanded={more}>Filters{active ? ` (${active})` : ''}</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip active={filters.open === true} onClick={() => set('open', filters.open ? undefined : true)}>Open</Chip>
        <Chip active={filters.overdue === true} onClick={() => set('overdue', filters.overdue ? undefined : true)}><AlertTriangle className="h-4 w-4" aria-hidden />Overdue</Chip>
        <Chip active={filters.due_soon === true} onClick={() => set('due_soon', filters.due_soon ? undefined : true)}>Due soon</Chip>
        <Chip active={filters.needs_ack === true} onClick={() => set('needs_ack', filters.needs_ack ? undefined : true)}>Awaiting acknowledgement</Chip>
        <Chip active={filters.flagged === true} onClick={() => set('flagged', filters.flagged ? undefined : true)}><Flag className="h-4 w-4" aria-hidden />Needs review</Chip>
        <Chip active={filters.legacy === true} onClick={() => set('legacy', filters.legacy ? undefined : true)}><History className="h-4 w-4" aria-hidden />Historical</Chip>
        {can('grievance.archive') && <Chip active={filters.archived === true} onClick={() => set('archived', filters.archived ? undefined : true)}>Archived</Chip>}
        {(active > 0 || filters.q) && <button onClick={() => { setQ(''); onChange({}); }} className="inline-flex h-9 items-center gap-1 px-2 text-sm font-semibold text-brand-700"><X className="h-4 w-4" />Clear all</button>}
      </div>
      {(more || compact) && d && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface p-3 shadow-card ring-1 ring-line/70 sm:grid-cols-3 lg:grid-cols-5">
          <FilterSelect label="Year" value={filters.year} onChange={(v) => set('year', v ? Number(v) : undefined)} options={years.map((y) => [y, String(y)])} />
          <FilterSelect label="Community type" value={filters.community_type_id} onChange={(v) => onChange({ ...filters, community_type_id: v ? Number(v) : undefined, cluster_id: undefined, community_id: undefined })} options={d.community_types.map((t) => [t.id, t.name])} />
          <FilterSelect label="Cluster" value={filters.cluster_id} onChange={(v) => set('cluster_id', v ? Number(v) : undefined)} options={clusters.map((c) => [c.id, c.name])} />
          <FilterSelect label="Community" value={filters.community_id} onChange={(v) => set('community_id', v || undefined)} options={communities.map((c) => [c.id, c.name])} />
          <FilterSelect label="Category" value={filters.category_id} onChange={(v) => onChange({ ...filters, category_id: v ? Number(v) : undefined, subcategory_id: undefined })} options={d.categories.map((c) => [c.id, c.name])} />
          <FilterSelect label="Sub-category" value={filters.subcategory_id} onChange={(v) => set('subcategory_id', v ? Number(v) : undefined)} options={d.subcategories.filter((s) => !filters.category_id || s.category_id === filters.category_id).map((s) => [s.id, s.name])} />
          <FilterSelect label="Severity" value={filters.severity_id} onChange={(v) => set('severity_id', v ? Number(v) : undefined)} options={d.severities.map((s) => [s.id, s.name])} />
          <FilterSelect label="Status" value={filters.status?.[0]} onChange={(v) => set('status', v ? [v] : undefined)} options={d.statuses.map((s) => [s.code, s.staff_label])} />
          <FilterSelect label="Officer" value={filters.officer_id} onChange={(v) => set('officer_id', v || undefined)} options={(staff.data ?? []).filter((s) => s.roles.includes('officer') || s.roles.includes('supervisor')).map((s) => [s.id, s.full_name])} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink-500">From<input type="date" className="mt-1 h-11 w-full rounded-xl px-2 text-sm ring-1 ring-line" value={filters.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></label>
            <label className="text-xs font-semibold text-ink-500">To<input type="date" className="mt-1 h-11 w-full rounded-xl px-2 text-sm ring-1 ring-line" value={filters.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: unknown; onChange: (v: string) => void; options: [string | number, string][] }) {
  return (
    <label className="text-xs font-semibold text-ink-500">
      {label}
      <Select className="mt-1 text-sm font-normal text-ink-900" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

/* ---------------------------------------------------------------- list */
export function GrievanceList() {
  const [filters, setFilters] = useUrlFilters();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('overdue_first');
  const { can } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  useEffect(() => setPage(1), [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['staff-list', filters, page, sort], queryFn: () => api.staffList(filters, page, 25, sort), placeholderData: keepPreviousData });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.page_size)) : 1;

  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const rows = await api.exportRows(filters);
      const name = `ipl-grievances-${new Date().toISOString().slice(0, 10)}`;
      if (kind === 'csv') downloadCsv(rows, `${name}.csv`); else await downloadXlsx(rows, `${name}.xlsx`, 'Grievances');
      toast(`Exported ${rows.length} grievances`);
    } catch (e) { toast(toAppError(e).message, 'warning'); }
    finally { setExporting(false); }
  };

  return (
    <div>
      <PageTitle title="Grievances" subtitle={q.data ? `${q.data.total.toLocaleString()} matching` : ' '}
        actions={can('export.run') && <>
          <Button variant="secondary" icon={Download} loading={exporting} onClick={() => doExport('xlsx')}>Excel</Button>
          <Button variant="secondary" icon={Download} loading={exporting} onClick={() => doExport('csv')}>CSV</Button>
        </>} />
      <FilterBar filters={filters} onChange={setFilters} />
      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <label htmlFor="sort" className="text-ink-500">Sort</label>
        <Select id="sort" className="h-9 !w-auto text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="overdue_first">Overdue first</option><option value="received_desc">Newest</option>
          <option value="received_asc">Oldest</option><option value="days_desc">Longest outstanding</option><option value="updated_desc">Recently updated</option>
        </Select>
      </div>
      <div className="mt-3">
        {q.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
          : q.isError ? <ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} />
          : !q.data?.rows.length ? <EmptyState icon={ClipboardList} title="No grievances match" body="Try clearing a filter or searching for something else." />
          : <RowsTable rows={q.data.rows} dim={q.isFetching} />}
      </div>
      {q.data && q.data.total > 25 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pages">
          <p className="text-sm text-ink-500">Page {page} of {pages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" iconRight={ChevronRight} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </nav>
      )}
    </div>
  );
}

export function RowsTable({ rows, dim }: { rows: StaffRow[]; dim?: boolean }) {
  const nav = useNavigate();
  return (
    <div className={cx('transition-opacity', dim && 'opacity-60')}>
      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-line/70 md:block">
        <table className="w-full text-[14px]">
          <thead className="bg-canvas/70 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr><th className="px-4 py-3">Tracking ID</th><th className="px-4 py-3">Grievance</th><th className="px-4 py-3">Community</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Officer</th></tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((r) => (
              <tr key={r.id} onClick={() => nav(`/grievances/${r.id}`)} className="cursor-pointer hover:bg-brand-50/50">
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Link to={`/grievances/${r.id}`} className="font-mono text-[13px] font-semibold text-brand-800 hover:underline" onClick={(e) => e.stopPropagation()}>{r.tracking_id}</Link>
                  {r.legacy_tracking_id && <p className="font-mono text-xs text-ink-400">{r.legacy_tracking_id}</p>}
                </td>
                <td className="max-w-[380px] px-4 py-3 align-top">
                  <p className="line-clamp-2 font-medium text-ink-900">{r.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">{[r.complainant_name, r.category_name].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="px-4 py-3 align-top"><p className="font-medium">{r.community_name ?? '—'}</p><p className="text-xs text-ink-500">{[r.community_type, r.cluster_name].filter(Boolean).join(' · ')}</p></td>
                <td className="whitespace-nowrap px-4 py-3 align-top text-ink-700">{formatDate(r.date_received, r.date_received_precision)}</td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge label={r.status_label} tone={r.status_tone} size="sm" />
                    {r.is_overdue ? <OverdueBadge days={r.days_outstanding} /> : r.is_due_soon ? <StatusBadge label="Due soon" tone="warning" size="sm" /> : null}
                    {r.open_flags > 0 && <StatusBadge label="Needs review" tone="warning" size="sm" icon={Flag} />}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-ink-700">{r.assigned_officer_name ?? <span className="text-ink-400">Unassigned</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* mobile cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/grievances/${r.id}`} className="block rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line/70">
              <div className="flex items-start justify-between gap-2"><span className="font-mono text-[13px] font-semibold text-brand-800">{r.tracking_id}</span><StatusBadge label={r.status_label} tone={r.status_tone} size="sm" /></div>
              <p className="mt-1.5 line-clamp-2 font-medium">{r.title}</p>
              <p className="mt-1 text-sm text-ink-500">{r.community_name} · {formatDate(r.date_received, r.date_received_precision)}</p>
              {(r.is_overdue || r.open_flags > 0) && <div className="mt-2 flex gap-1.5">{r.is_overdue && <OverdueBadge days={r.days_outstanding} />}{r.open_flags > 0 && <StatusBadge label="Needs review" tone="warning" size="sm" icon={Flag} />}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
