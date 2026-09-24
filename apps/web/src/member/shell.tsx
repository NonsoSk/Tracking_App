import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CircleHelp, FileText, Home, LogOut, MoreHorizontal, PenLine, Search, UserRound, WifiOff } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, useOnline } from '@/app/hooks';
import { api } from '@/lib/api';
import { Avatar, Modal, ThemeSwitch, cx } from '@/design/ui';
import { HeaderArt, Logo, type ObjectKind } from '@/design/art';
import { TabLink } from '@/design/tablink';

export function useUnreadCount() {
  const { userId } = useAuth();
  const q = useCachedQuery(`notifications:${userId}`, () => api.notifications(), { enabled: !!userId, refetchInterval: 60_000 });
  return (q.data ?? []).filter((n) => !n.read_at).length;
}

const TITLES: [string, string][] = [
  ['/submit', 'Submit a grievance'], ['/grievances', 'My grievances'], ['/track', 'Track'], ['/notifications', 'Alerts'],
  ['/profile', 'Profile'], ['/help', 'How it works'],
];

export function MemberShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const unread = useUnreadCount();
  const { profile } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [loc.pathname]);
  const title = TITLES.find(([p]) => loc.pathname.startsWith(p))?.[1] ?? 'Indorama Grievance Portal';
  const moreActive = ['/profile', '/help', '/submit'].some((p) => loc.pathname.startsWith(p));
  return (
    <div className="member min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 bg-gradient-to-r from-[rgb(var(--bar-from))] to-[rgb(var(--bar-to))] text-white shadow-[0_4px_16px_rgb(0_37_122/0.25)] safe-top no-print">
        <div className="mx-auto flex h-14 max-w-md items-center gap-2.5 px-4">
          <span className="rounded-xl bg-white p-0.5"><Logo size={26} /></span>
          <span className="min-w-0 flex-1 truncate text-[17px] font-extrabold">{title}</span>
          <ThemeSwitch onBlue />
        </div>
        {!online && (
          <div className="flex items-center justify-center gap-2 bg-[#1A1F36] px-4 py-2 text-sm font-bold text-white" role="status">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> You're offline. You can still write a grievance; it will be sent when you're back online.
          </div>
        )}
      </header>
      <main className="mx-auto max-w-md px-4 pb-28 pt-4"><div key={loc.pathname} className="animate-fade-up">{children}</div></main>
      <nav className="fixed inset-x-0 bottom-0 z-20 bg-surface shadow-[0_-6px_24px_rgb(var(--shadow)/0.08)] safe-bottom" aria-label="Main">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          <li><TabLink to="/" end label="Home" icon={Home} /></li>
          <li><TabLink to="/grievances" label="Grievances" icon={FileText} /></li>
          <li><TabLink to="/track" label="Track" icon={Search} /></li>
          <li><TabLink to="/notifications" label="Alerts" icon={Bell} badge={unread} /></li>
          <li>
            <button onClick={() => setMore(true)} aria-haspopup="dialog" className={cx('relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[12px] font-bold', moreActive ? 'text-brand-700' : 'text-ink-500')}>
              <span className={cx('grid h-8 w-14 place-items-center rounded-full', moreActive && 'bg-brand-100')}><MoreHorizontal className="h-[22px] w-[22px]" aria-hidden /></span>More
            </button>
          </li>
        </ul>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
          <Avatar name={profile?.full_name} size={44} />
          <div className="min-w-0 flex-1 leading-tight"><p className="truncate font-extrabold">{profile?.full_name}</p><p className="truncate text-sm text-ink-500">{profile?.community_name ?? 'Community member'}</p></div>
        </div>
        <ul className="grid grid-cols-2 gap-2 pb-2">
          {[{ to: '/submit', label: 'New grievance', icon: PenLine }, { to: '/profile', label: 'Profile', icon: UserRound }, { to: '/help', label: 'How it works', icon: CircleHelp }].map((it) => (
            <li key={it.to}><Link to={it.to} className="flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl bg-sunken text-[14px] font-bold text-ink-700"><it.icon className="h-6 w-6 text-brand-700" aria-hidden />{it.label}</Link></li>
          ))}
          <li><button onClick={() => { setMore(false); nav('/profile'); }} className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-sunken text-[14px] font-bold text-danger"><LogOut className="h-6 w-6" aria-hidden />Sign out…</button></li>
        </ul>
        <p className="px-1 pb-2 text-center text-xs text-ink-500">Sign out is on your Profile, so nothing saved on this phone is lost by mistake.</p>
      </Modal>
    </div>
  );
}

export function PageHeader({ title, back, action, eyebrow, description, art }: {
  title: string; back?: string; action?: ReactNode; eyebrow?: string; description?: ReactNode; art?: [ObjectKind, ObjectKind?, ObjectKind?];
}) {
  return (
    <header className="mb-[18px] flex min-h-12 items-center gap-2">
      {back && <Link to={back} className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink-700 shadow-card hover:text-brand-700" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow text-brand-700">{eyebrow}</p>}
        <h1 className="text-[1.6rem] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
        {description && <p className="text-[15px] text-ink-500">{description}</p>}
      </div>
      {action}
      {art && <HeaderArt items={art} className="scale-[.85]" />}
    </header>
  );
}
