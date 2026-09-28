import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, CircleHelp, CloudUpload, FileText, MapPin, PenLine, Search } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, usePendingOutbox } from '@/app/hooks';
import { api } from '@/lib/api';
import { firstName, formatDate } from '@/lib/format';
import { Button, NextStep, QuickActions, Skeleton, StatTile, cx } from '@/design/ui';
import { useUnreadCount } from './shell';
import { CalmNote } from './CalmNote';

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
      {/* Welcome: plain and personal */}
      <section className="rounded-3xl bg-surface p-5 shadow-card">
        <p className="text-[15px] text-ink-500">{greeting()},</p>
        <h1 className="text-[1.7rem] font-extrabold leading-tight tracking-[-0.02em]">{firstName(profile?.full_name)}</h1>
        <CalmNote place="home" sent={list.length} settled={settled} className="mt-3" />
      </section>

      {/* Collection status for their community */}
      {status.isLoading ? <Skeleton className="h-[92px]" /> : (
        <section aria-label="Collection status" className="flex items-start gap-3 rounded-2xl bg-surface p-4 shadow-card">
          <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl', open ? 'bg-success-soft text-success' : 'bg-sunken text-ink-500')}>
            <MapPin className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow text-ink-500">Grievance collection</p>
            <p className="flex flex-wrap items-center gap-x-2 text-[17px] font-extrabold">
              <span className={cx('h-2.5 w-2.5 rounded-full', open ? 'bg-success' : 'bg-ink-400')} aria-hidden />
              {open ? 'OPEN' : 'CLOSED'}
              <span className="font-bold text-ink-500">· {status.data?.community_name ?? profile?.community_name ?? '—'}</span>
            </p>
            <p className="mt-0.5 text-[14px] leading-snug text-ink-700">
              {open ? `Until ${formatDate(status.data?.valid_until)}. Get the submission code from your community leader.`
                    : status.data ? 'Collection is closed for your community right now.' : "We'll check when you're back online."}
            </p>
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

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
