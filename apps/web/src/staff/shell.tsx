import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, ClipboardList, FileSpreadsheet, FilePlus2, Gauge, History, KeyRound, LayoutDashboard, LogOut, Map, MoreHorizontal, Settings,
  Tags, Upload, Users, WifiOff, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, useOnline } from '@/app/hooks';
import { api } from '@/lib/api';
import type { Filters } from '@/lib/types';
import { Avatar, Modal, ProgressRing, ThemeSwitch, cx } from '@/design/ui';
import { Logo, type ObjectKind } from '@/design/art';
import { PageHero } from '@/design/page';
import { TabLink } from '@/design/tablink';

interface NavItem { to: string; label: string; icon: LucideIcon; show: boolean; end?: boolean; badge?: number }

export function StaffShell({ children }: { children: ReactNode }) {
  const { profile, can, hasRole, signOut, userId, access } = useAuth();
  const online = useOnline();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [loc.pathname]);
  const notes = useCachedQuery(`notifications:${userId}`, () => api.notifications(), { enabled: !!userId, refetchInterval: 60_000 });
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  const isOfficer = hasRole('officer');
  const readsAny = can('grievance.read.all') || can('grievance.read.scope') || can('grievance.read.entered');

  const main: NavItem[] = [
    { to: '/', label: isOfficer ? 'My work' : 'Overview', icon: isOfficer ? Gauge : LayoutDashboard, show: true, end: true },
    { to: '/overview', label: 'Dashboard', icon: LayoutDashboard, show: isOfficer && can('dashboard.view') },
    { to: '/grievances', label: 'Grievances', icon: ClipboardList, show: readsAny },
    { to: '/new', label: 'Enter paper form', icon: FilePlus2, show: can('grievance.create.assisted') },
    { to: '/codes', label: 'Submission codes', icon: KeyRound, show: can('codes.manage') },
    { to: '/reports', label: 'Reports', icon: FileSpreadsheet, show: can('dashboard.view') },
    { to: '/notifications', label: 'Notifications', icon: Bell, show: true, badge: unread },
  ].filter((i) => i.show);
  const admin: NavItem[] = [
    { to: '/admin/communities', label: 'Communities', icon: Map, show: can('masterdata.manage') },
    { to: '/admin/categories', label: 'Categories & statuses', icon: Tags, show: can('masterdata.manage') },
    { to: '/admin/users', label: 'Users & officers', icon: Users, show: can('users.manage') },
    { to: '/admin/import', label: 'Data import', icon: Upload, show: can('import.run') },
    { to: '/admin/audit', label: 'Audit log', icon: History, show: can('audit.view') },
    { to: '/admin/settings', label: 'Settings', icon: Settings, show: can('settings.manage') },
  ].filter((i) => i.show);

  // Phone: four main tabs + More (everything else in a sheet).
  const tabOrder = ['/', '/grievances', '/new', '/notifications', '/codes', '/overview', '/reports'];
  const tabs = [...main].sort((a, b) => tabOrder.indexOf(a.to) - tabOrder.indexOf(b.to)).slice(0, 4);
  const rest = [...main.filter((i) => !tabs.includes(i)), ...admin];
  const current = [...main, ...admin].find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
  const moreActive = !!current && rest.includes(current);

  const sideLink = (it: NavItem) => (
    <li key={it.to}>
      <NavLink to={it.to} end={it.end} className={({ isActive }) => cx('flex h-11 items-center gap-3 rounded-full px-4 text-[15px] font-bold transition-colors',
        isActive ? 'bg-white text-[#0033A1] shadow-[0_6px_16px_rgb(0_0_0/0.18)]' : 'text-white/85 hover:bg-white/10 hover:text-white')}>
        <it.icon className="h-[18px] w-[18px] shrink-0" aria-hidden /> <span className="flex-1 truncate">{it.label}</span>
        {!!it.badge && <span className="min-w-5 rounded-full bg-[#C00000] px-1.5 text-center text-xs font-extrabold leading-5 text-white ring-2 ring-white/70">{it.badge}</span>}
      </NavLink>
    </li>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Desktop: solid blue sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-gradient-to-b from-[rgb(var(--bar-from))] to-[rgb(var(--bar-to))] text-white lg:flex no-print">
        <div className="flex items-center gap-2.5 px-6 pb-4 pt-6">
          <span className="rounded-2xl bg-white p-1 shadow-card"><Logo size={30} /></span>
          <div className="leading-tight"><p className="font-extrabold">Indorama Grievance Portal</p><p className="text-xs text-white/70">Community Relations</p></div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
          <ul className="space-y-1">{main.map(sideLink)}</ul>
          {admin.length > 0 && <div><p className="eyebrow mb-1.5 px-4 text-white/55">Administration</p><ul className="space-y-1">{admin.map(sideLink)}</ul></div>}
        </nav>
        <div className="space-y-3 p-3">
          <ProgressCard />
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5">
            <Avatar name={profile?.full_name} size={36} />
            <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-bold">{profile?.full_name}</p><p className="truncate text-xs text-white/70">{roleLabel(access?.roles ?? [])}</p></div>
            <button onClick={() => signOut()} className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/15" aria-label="Sign out" title="Sign out"><LogOut className="h-[18px] w-[18px]" /></button>
          </div>
          <div className="flex items-center justify-between px-2 text-sm font-bold text-white/80">Dark mode <ThemeSwitch onBlue /></div>
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        {/* Phone: blue top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 bg-gradient-to-r from-[rgb(var(--bar-from))] to-[rgb(var(--bar-to))] px-4 text-white shadow-[0_4px_16px_rgb(0_37_122/0.25)] safe-top lg:hidden no-print">
          <span className="rounded-xl bg-white p-0.5"><Logo size={26} /></span>
          <span className="min-w-0 flex-1 truncate text-[17px] font-extrabold">{current?.label ?? 'Indorama Grievance Portal'}</span>
          <ThemeSwitch onBlue />
        </header>
        {!online && <div className="flex items-center justify-center gap-2 bg-[#1A1F36] px-4 py-2 text-sm font-bold text-white"><WifiOff className="h-4 w-4" /> You're offline. Showing the last data loaded; changes need a connection.</div>}
        <main className="mx-auto max-w-[1120px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div key={loc.pathname} className="animate-fade-up">{children}</div>
        </main>
      </div>

      {/* Phone: white bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 bg-surface shadow-[0_-6px_24px_rgb(var(--shadow)/0.08)] safe-bottom lg:hidden no-print" aria-label="Main">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((t) => <li key={t.to}><TabLink to={t.to} end={t.end} label={shortLabel(t.label)} icon={t.icon} badge={t.badge} /></li>)}
          <li>
            <button onClick={() => setMore(true)} className={cx('relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[12px] font-bold', moreActive ? 'text-brand-700' : 'text-ink-500')} aria-haspopup="dialog">
              <span className={cx('grid h-8 w-14 place-items-center rounded-full', moreActive && 'bg-brand-100')}><MoreHorizontal className="h-[22px] w-[22px]" aria-hidden /></span>More
            </button>
          </li>
        </ul>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
          <Avatar name={profile?.full_name} size={44} />
          <div className="min-w-0 flex-1 leading-tight"><p className="truncate font-extrabold">{profile?.full_name}</p><p className="truncate text-sm text-ink-500">{roleLabel(access?.roles ?? [])}</p></div>
        </div>
        <ul className="grid grid-cols-3 gap-2 pb-2">
          {rest.map((it) => (
            <li key={it.to}>
              <Link to={it.to} className={cx('relative flex h-24 flex-col items-center justify-center gap-2 rounded-2xl px-1 text-center text-[13px] font-bold leading-tight',
                current === it ? 'bg-btn text-white' : 'bg-sunken text-ink-700')}>
                <it.icon className="h-6 w-6" aria-hidden />{it.label}
                {!!it.badge && <span className="absolute right-2 top-2 min-w-5 rounded-full bg-accent-500 px-1 text-[11px] font-extrabold leading-5 text-white">{it.badge}</span>}
              </Link>
            </li>
          ))}
          <li>
            <button onClick={() => signOut()} className="flex h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-sunken text-[13px] font-bold text-danger"><LogOut className="h-6 w-6" aria-hidden />Sign out</button>
          </li>
        </ul>
      </Modal>
    </div>
  );
}

const shortLabel = (l: string) => ({ 'Enter paper form': 'Paper form', 'Submission codes': 'Codes', Notifications: 'Alerts' } as Record<string, string>)[l] ?? l;

/** Sidebar progress card: how much of the work is on time (officers) or resolved (everyone else). */
function ProgressCard() {
  const { hasRole, can } = useAuth();
  const officer = hasRole('officer');
  const home = useQuery({ queryKey: ['officer-home'], queryFn: api.officerHome, enabled: officer, refetchInterval: 60_000 });
  const dash = useQuery({ queryKey: ['dashboard', {}], queryFn: () => api.dashboard({}), enabled: !officer && can('dashboard.view') });
  let value: number | null = null; let title = ''; let line = '';
  if (officer && home.data) {
    const open = home.data.assigned_open;
    value = open ? Math.round(((open - home.data.overdue) / open) * 100) : 100;
    title = 'On time'; line = open ? `${open - home.data.overdue} of ${open} open are within 3 working days` : 'Nothing open. Well done.';
  } else if (dash.data?.kpis.resolution_rate != null) {
    value = Math.round(dash.data.kpis.resolution_rate);
    title = 'Resolved'; line = `${dash.data.kpis.overdue} overdue · ${dash.data.kpis.open.toLocaleString()} open`;
  }
  if (value == null) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-inset ring-white/15">
      <ProgressRing value={value} size={52} stroke={6} onBlue label={`${title} ${value}%`}><span className="text-[13px] font-extrabold tabular">{value}%</span></ProgressRing>
      <div className="min-w-0 leading-tight"><p className="text-sm font-extrabold">{title}</p><p className="text-xs text-white/75">{line}</p></div>
    </div>
  );
}

function roleLabel(roles: string[]) {
  const map: Record<string, string> = { super_admin: 'Super Administrator', officer: 'Officer in Charge', supervisor: 'Supervisor', cr_staff: 'Community Relations', data_entry: 'Data Entry', viewer: 'Viewer' };
  return roles.map((r) => map[r]).filter(Boolean).join(', ');
}

const PAGE_ART: [string, string, [ObjectKind, ObjectKind?, ObjectKind?]][] = [
  ['/admin/communities', 'Administration', ['pin', 'sphere', 'gem']],
  ['/admin/categories', 'Administration', ['book', 'gem', 'sphere']],
  ['/admin/users', 'Administration', ['shield', 'coin', 'gem']],
  ['/admin/import', 'Administration', ['box', 'sphere', 'gem']],
  ['/admin/audit', 'Administration', ['shield', 'book', 'gem']],
  ['/admin/settings', 'Administration', ['block', 'coin', 'gem']],
  ['/grievances', 'Case work', ['bubble', 'sphere', 'gem']],
  ['/new', 'Assisted entry', ['book', 'bubble', 'gem']],
  ['/codes', 'Collection', ['coin', 'block', 'gem']],
  ['/reports', 'Reports', ['chart', 'coin', 'gem']],
  ['/overview', 'Organisation', ['chart', 'sphere', 'gem']],
  ['/notifications', 'Inbox', ['bell', 'bubble', 'gem']],
  ['/', 'Today', ['block', 'coin', 'gem']],
];

export function PageTitle({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  const { pathname } = useLocation();
  const hit = PAGE_ART.find(([p]) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
  return <PageHero eyebrow={eyebrow ?? hit?.[1]} title={title} description={subtitle} art={hit?.[2]} right={actions} />;
}

/* ---------------------------------------------------------------- filters in the URL (shareable, back-button friendly) */
const NUM = ['year', 'community_type_id', 'cluster_id', 'category_id', 'subcategory_id', 'severity_id'] as const;
const BOOL = ['open', 'overdue', 'due_soon', 'flagged', 'legacy', 'needs_ack', 'unassigned', 'archived'] as const;
const STR = ['q', 'date_from', 'date_to', 'community_id', 'officer_id'] as const;

export function useUrlFilters(): [Filters, (f: Filters) => void, (patch: Filters) => void] {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo<Filters>(() => {
    const f: Record<string, unknown> = {};
    NUM.forEach((k) => { const v = sp.get(k); if (v) f[k] = Number(v); });
    BOOL.forEach((k) => { const v = sp.get(k); if (v) f[k] = v === 'true'; });
    STR.forEach((k) => { const v = sp.get(k); if (v) f[k] = v; });
    const st = sp.getAll('status'); if (st.length) f.status = st;
    return f as Filters;
  }, [sp]);
  const set = (f: Filters) => setSp(filtersToParams(f), { replace: true });
  const patch = (p: Filters) => set(Object.fromEntries(Object.entries({ ...filters, ...p }).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Filters);
  return [filters, set, patch];
}

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  });
  return p;
}

/** Link to the grievance list with these filters (dashboard drill-down). */
export const listHref = (f: Filters) => `/grievances?${filtersToParams(f).toString()}`;
