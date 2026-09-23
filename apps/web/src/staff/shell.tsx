import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import {
  Bell, ClipboardList, FileSpreadsheet, FilePlus2, Gauge, History, KeyRound, LayoutDashboard, LogOut, Map, Menu, Settings,
  Tags, Upload, Users, WifiOff, X, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, useOnline } from '@/app/hooks';
import { api } from '@/lib/api';
import type { Filters } from '@/lib/types';
import { cx } from '@/design/ui';
import { Logo } from '@/design/art';

interface NavItem { to: string; label: string; icon: LucideIcon; show: boolean; end?: boolean; badge?: number }

export function StaffShell({ children }: { children: ReactNode }) {
  const { profile, can, hasRole, signOut, userId, access } = useAuth();
  const online = useOnline();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const notes = useCachedQuery(`notifications:${userId}`, () => api.notifications(), { enabled: !!userId, refetchInterval: 60_000 });
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  const isOfficer = hasRole('officer');
  const readsAny = can('grievance.read.all') || can('grievance.read.scope') || can('grievance.read.entered');

  const groups: { title?: string; items: NavItem[] }[] = [
    { items: [
      { to: '/', label: isOfficer ? 'My work' : 'Overview', icon: isOfficer ? Gauge : LayoutDashboard, show: true, end: true },
      { to: '/overview', label: 'Dashboard', icon: LayoutDashboard, show: isOfficer && can('dashboard.view') },
      { to: '/grievances', label: 'Grievances', icon: ClipboardList, show: readsAny },
      { to: '/new', label: 'Enter paper form', icon: FilePlus2, show: can('grievance.create.assisted') },
      { to: '/codes', label: 'Submission codes', icon: KeyRound, show: can('codes.manage') },
      { to: '/reports', label: 'Reports', icon: FileSpreadsheet, show: can('dashboard.view') },
      { to: '/notifications', label: 'Notifications', icon: Bell, show: true, badge: unread },
    ] },
    { title: 'Administration', items: [
      { to: '/admin/communities', label: 'Communities', icon: Map, show: can('masterdata.manage') },
      { to: '/admin/categories', label: 'Categories & statuses', icon: Tags, show: can('masterdata.manage') },
      { to: '/admin/users', label: 'Users & officers', icon: Users, show: can('users.manage') },
      { to: '/admin/import', label: 'Data import', icon: Upload, show: can('import.run') },
      { to: '/admin/audit', label: 'Audit log', icon: History, show: can('audit.view') },
      { to: '/admin/settings', label: 'Settings', icon: Settings, show: can('settings.manage') },
    ] },
  ];

  const nav = (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo size={32} />
        <div className="leading-tight"><p className="font-bold text-ink-900">IPL Grievance</p><p className="text-xs text-ink-500">Community Relations</p></div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {groups.map((g, gi) => {
          const items = g.items.filter((i) => i.show);
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.title && <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-400">{g.title}</p>}
              <ul className="space-y-0.5">
                {items.map((it) => (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end} className={({ isActive }) => cx('flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors',
                      isActive ? 'bg-brand-700 text-white' : 'text-ink-700 hover:bg-canvas')}>
                      <it.icon className="h-[18px] w-[18px] shrink-0" aria-hidden /> <span className="flex-1">{it.label}</span>
                      {!!it.badge && <span className="rounded-full bg-accent-500 px-1.5 text-xs font-bold text-ink-900">{it.badge}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 font-bold text-brand-800">{(profile?.full_name ?? '?').slice(0, 1)}</span>
          <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-semibold">{profile?.full_name}</p><p className="truncate text-xs text-ink-500">{roleLabel(access?.roles ?? [])}</p></div>
          <button onClick={() => signOut()} className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-canvas" aria-label="Sign out" title="Sign out"><LogOut className="h-[18px] w-[18px]" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block no-print">{nav}</aside>
      {open && <div className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cx('fixed inset-y-0 left-0 z-50 w-72 bg-surface shadow-raised transition-transform lg:hidden', open ? 'translate-x-0' : '-translate-x-full')} aria-hidden={!open}>
        <button className="absolute right-3 top-4 grid h-10 w-10 place-items-center rounded-full hover:bg-canvas" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        {nav}
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden no-print">
          <button onClick={() => setOpen(true)} className="-ml-1 grid h-10 w-10 place-items-center rounded-lg hover:bg-canvas" aria-label="Open menu"><Menu className="h-6 w-6" /></button>
          <Logo size={26} /><span className="font-bold">IPL Grievance</span>
          <Link to="/notifications" className="relative ml-auto grid h-10 w-10 place-items-center rounded-lg hover:bg-canvas" aria-label="Notifications">
            <Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-accent-500" />}
          </Link>
        </header>
        {!online && <div className="flex items-center justify-center gap-2 bg-ink-900 px-4 py-2 text-sm font-medium text-white"><WifiOff className="h-4 w-4" /> You're offline. Showing the last data loaded; changes need a connection.</div>}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function roleLabel(roles: string[]) {
  const map: Record<string, string> = { super_admin: 'Super Administrator', officer: 'Officer in Charge', supervisor: 'Supervisor', cr_staff: 'Community Relations', data_entry: 'Data Entry', viewer: 'Viewer' };
  return roles.map((r) => map[r]).filter(Boolean).join(', ');
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-ink-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
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
