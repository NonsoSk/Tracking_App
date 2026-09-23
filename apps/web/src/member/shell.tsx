import type { ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { ArrowLeft, Bell, FileText, Home, UserRound, WifiOff } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, useOnline } from '@/app/hooks';
import { api } from '@/lib/api';
import { cx } from '@/design/ui';

export function useUnreadCount() {
  const { userId } = useAuth();
  const q = useCachedQuery(`notifications:${userId}`, () => api.notifications(), { enabled: !!userId, refetchInterval: 60_000 });
  return (q.data ?? []).filter((n) => !n.read_at).length;
}

export function MemberShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const unread = useUnreadCount();
  const tabs = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/grievances', label: 'Grievances', icon: FileText },
    { to: '/notifications', label: 'Alerts', icon: Bell, badge: unread },
    { to: '/profile', label: 'Profile', icon: UserRound },
  ];
  return (
    <div className="member min-h-dvh bg-canvas">
      {!online && (
        <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-ink-900 px-4 py-2 text-sm font-medium text-white" role="status">
          <WifiOff className="h-4 w-4" aria-hidden /> You're offline. You can still write a grievance; it will be sent when you're back online.
        </div>
      )}
      <main className="mx-auto max-w-md px-4 pb-28 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur safe-bottom" aria-label="Main">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {tabs.map(({ to, label, icon: Icon, end, badge }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => cx('relative flex h-16 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold',
                isActive ? 'text-brand-700' : 'text-ink-500')}>
                {({ isActive }) => (<>
                  <span className={cx('grid h-8 w-14 place-items-center rounded-full transition-colors', isActive && 'bg-brand-100')}><Icon className="h-[22px] w-[22px]" aria-hidden /></span>
                  {label}
                  {!!badge && <span className="absolute right-[22%] top-1.5 min-w-5 rounded-full bg-accent-500 px-1.5 text-center text-[11px] font-bold leading-5 text-ink-900" aria-label={`${badge} unread`}>{badge}</span>}
                </>)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex min-h-12 items-center gap-2">
      {back && <Link to={back} className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-ink-700 hover:bg-surface" aria-label="Back"><ArrowLeft className="h-6 w-6" /></Link>}
      <h1 className="flex-1 text-[22px] font-bold leading-tight">{title}</h1>
      {action}
    </header>
  );
}
