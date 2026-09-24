import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, CircleHelp, CloudUpload, FileText, PenLine, Search } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, usePendingOutbox } from '@/app/hooks';
import { api } from '@/lib/api';
import { firstName, formatDate } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { Button, NextStep, QuickActions, Skeleton, StatTile, cx } from '@/design/ui';
import { useUnreadCount } from './shell';

export function Home() {
  const { profile, userId } = useAuth();
  const nav = useNavigate();
  const status = useCachedQuery(`submission-status:${userId}:${profile?.community_id}`, () => api.submissionStatus(profile?.community_id), { enabled: !!userId, refetchInterval: 5 * 60_000 });
  const mine = useCachedQuery(`my-grievances:${userId}`, () => api.myGrievances(), { enabled: !!userId });
  const pending = usePendingOutbox(userId);
  const unread = useUnreadCount();
  const list = mine.data ?? [];
  const needAck = list.filter((g) => g.needs_acknowledgement).length;
  const settled = list.filter((g) => g.status_code === 'RESOLVED' || g.status_code === 'CLOSED').length;
  const open = status.data?.open;

  return (
    <div className="space-y-[18px]">
      <p className="text-[15px] text-ink-500">Hello, <span className="font-extrabold text-ink-900">{firstName(profile?.full_name)}</span></p>

      {/* Hero: the Community Card */}
      {status.isLoading ? <Skeleton className="h-[196px] !rounded-3xl" /> : (
        <section aria-label="Your community card"
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[rgb(var(--hero-a))] via-[rgb(var(--hero-b))] to-[rgb(var(--hero-c))] p-5 text-white shadow-[0_14px_32px_rgb(0_37_122/0.35)]">
          <span className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10" aria-hidden />
          <span className="pointer-events-none absolute -bottom-[150px] -right-28 h-44 w-80 rotate-[-16deg] rounded-[50%] border-t-[10px] border-[#C00000]/90" aria-hidden />
          <span className="pointer-events-none absolute -bottom-[150px] -right-24 h-44 w-80 rotate-[-16deg] rounded-[50%] border-t-2 border-white/30" aria-hidden />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-white/75">Grievance collection</p>
              <p className="mt-0.5 flex items-center gap-2 text-[1.9rem] font-extrabold leading-none tracking-[-0.02em]">
                <span className={cx('h-3 w-3 rounded-full ring-4', open ? 'bg-[#34D399] ring-[#34D399]/25' : 'bg-white/50 ring-white/15')} aria-hidden />
                {open ? 'OPEN' : 'CLOSED'}
              </p>
            </div>
            <Chip3D />
          </div>
          <p className="relative mt-3 max-w-[30ch] text-[14px] leading-snug text-white/85">
            {open ? `Grievances are being collected for ${status.data?.community_name} until ${formatDate(status.data?.valid_until)}. Get the submission code from your community leader.`
                  : status.data ? 'Collection is closed for your community right now.' : "We'll check when you're back online."}
          </p>
          <p className="embossed relative mt-4 text-[17px] text-white/95">{profile?.phone ? formatPhone(profile.phone) : '•••• •••• ••••'}</p>
          <div className="relative mt-2 flex items-end justify-between gap-3 text-[13px]">
            <div className="min-w-0"><p className="text-white/60">Member</p><p className="truncate font-bold uppercase tracking-wide">{profile?.full_name}</p></div>
            <div className="min-w-0 text-right"><p className="text-white/60">Community</p><p className="truncate font-bold">{profile?.community_name ?? '—'}</p></div>
          </div>
        </section>
      )}

      <Button size="lg" icon={PenLine} onClick={() => nav('/submit')} className="h-16 text-lg">
        Submit a grievance
      </Button>
      <p className="-mt-2 text-center text-sm text-ink-500">You'll need the submission code from your community leader.</p>

      <QuickActions items={[
        { label: 'Mine', icon: FileText, onClick: () => nav('/grievances') },
        { label: 'Track', icon: Search, onClick: () => nav('/track') },
        { label: 'Alerts', icon: Bell, onClick: () => nav('/notifications'), badge: unread },
        { label: 'Help', icon: CircleHelp, onClick: () => nav('/help') },
        { label: 'Write', icon: PenLine, onClick: () => nav('/submit'), tone: 'red' },
      ]} />

      {pending.length > 0 ? (
        <NextStep tone="gold" action={<Link to="/grievances" className="inline-flex items-center gap-1 text-sm font-extrabold text-brand-700">See them <ChevronRight className="h-4 w-4" /></Link>}>
          <span className="flex items-center gap-2"><CloudUpload className="h-5 w-5 shrink-0 text-gold-700" aria-hidden />
            {pending.length === 1 ? '1 grievance is saved on this phone, waiting to be sent. Connect to the internet.' : `${pending.length} grievances are saved on this phone, waiting to be sent. Connect to the internet.`}</span>
        </NextStep>
      ) : needAck > 0 ? (
        <NextStep action={<Button size="sm" onClick={() => nav(`/grievances/${list.find((g) => g.needs_acknowledgement)?.id}`)}>Respond</Button>}>
          {needAck === 1 ? 'One grievance was resolved. Please tell us if you agree.' : `${needAck} grievances were resolved. Please tell us if you agree.`}
        </NextStep>
      ) : (
        <NextStep>{list.length ? 'Nothing needs you right now. We will send you an alert when there is news.' : 'Get the submission code from your community leader, then tap “Submit a grievance”. It takes about 2 minutes.'}</NextStep>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Resolved" value={settled} of={list.length} tone="gold" onClick={() => nav('/grievances')} />
          <StatTile label="Need your reply" value={needAck} tone={needAck ? 'danger' : 'brand'} onClick={() => nav('/grievances')} />
        </div>
      )}
    </div>
  );
}

/** Gold card chip, drawn in SVG (lit from the top-left). */
function Chip3D() {
  return (
    <svg width="46" height="36" viewBox="0 0 46 36" aria-hidden className="shrink-0 drop-shadow-[0_3px_4px_rgb(0_0_0/0.3)]">
      <defs><linearGradient id="chipg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F6D38A" /><stop offset=".5" stopColor="#D4952F" /><stop offset="1" stopColor="#B0700E" /></linearGradient></defs>
      <rect x="1" y="1" width="44" height="34" rx="7" fill="url(#chipg)" />
      <path d="M1 12h13m18 0h13M1 24h13m18 0h13M14 1v34M32 1v34" stroke="#8C5709" strokeOpacity=".55" strokeWidth="1.3" fill="none" />
      <rect x="14" y="9" width="18" height="18" rx="4" fill="none" stroke="#8C5709" strokeOpacity=".55" strokeWidth="1.3" />
      <ellipse cx="11" cy="7" rx="7" ry="2.6" fill="#fff" opacity=".45" />
    </svg>
  );
}
