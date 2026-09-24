import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cx } from './ui';

/** Bottom tab-bar item (phones), shared by the member and staff shells. */
export function TabLink({ to, end, label, icon: Icon, badge }: { to: string; end?: boolean; label: string; icon: LucideIcon; badge?: number }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('relative flex h-16 flex-col items-center justify-center gap-0.5 text-[12px] font-bold', isActive ? 'text-brand-700' : 'text-ink-500')}>
      {({ isActive }) => (<>
        <span className={cx('grid h-8 w-14 place-items-center rounded-full transition-colors', isActive && 'bg-brand-100')}><Icon className="h-[22px] w-[22px]" aria-hidden /></span>
        <span className="max-w-full truncate px-1">{label}</span>
        {!!badge && <span className="absolute right-[18%] top-1.5 min-w-5 rounded-full bg-accent-500 px-1.5 text-center text-[11px] font-extrabold leading-5 text-white ring-2 ring-surface" aria-label={`${badge} unread`}>{badge}</span>}
      </>)}
    </NavLink>
  );
}
