import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, CircleCheck, CloudUpload, FileText, Lock, MapPin, PenLine, Search } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, usePendingOutbox } from '@/app/hooks';
import { api } from '@/lib/api';
import { firstName, formatDate } from '@/lib/format';
import { Button, Card, Skeleton, cx } from '@/design/ui';
import { useUnreadCount } from './shell';

export function Home() {
  const { profile, userId } = useAuth();
  const nav = useNavigate();
  const status = useCachedQuery(`submission-status:${userId}:${profile?.community_id}`, () => api.submissionStatus(profile?.community_id), { enabled: !!userId, refetchInterval: 5 * 60_000 });
  const mine = useCachedQuery(`my-grievances:${userId}`, () => api.myGrievances(), { enabled: !!userId });
  const pending = usePendingOutbox(userId);
  const unread = useUnreadCount();
  const needAck = (mine.data ?? []).filter((g) => g.needs_acknowledgement).length;
  const open = status.data?.open;

  return (
    <div className="space-y-5 animate-fade-up">
      <header className="pt-2">
        <p className="text-ink-500">Hello,</p>
        <h1 className="text-[28px] font-bold leading-tight">{firstName(profile?.full_name)}</h1>
        {profile?.community_name && (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-[15px] font-semibold text-brand-800 shadow-card">
            <MapPin className="h-4 w-4" aria-hidden /> {profile.community_name}
          </p>
        )}
      </header>

      {/* Collection status */}
      {status.isLoading ? <Skeleton className="h-24" /> : (
        <Card className={cx('overflow-hidden', open ? 'ring-success/30' : '')}>
          <div className={cx('flex items-start gap-3 p-4', open ? 'bg-success-soft' : 'bg-muted-soft')}>
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full', open ? 'bg-success text-white' : 'bg-ink-500 text-white')}>
              {open ? <CircleCheck className="h-6 w-6" aria-hidden /> : <Lock className="h-5 w-5" aria-hidden />}
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Grievance collection</p>
              <p className="text-lg font-bold">{open ? 'OPEN' : 'CLOSED'}</p>
              <p className="text-[15px] text-ink-700">
                {open ? `Grievances are being collected for ${status.data?.community_name} until ${formatDate(status.data?.valid_until)}.`
                      : status.data ? 'Grievance collection is currently closed for your community.' : "We'll check when you're back online."}
              </p>
            </div>
          </div>
        </Card>
      )}

      <Button size="lg" icon={PenLine} onClick={() => nav('/submit')} className="h-16 text-lg">
        Submit a grievance
      </Button>
      {!open && status.data && <p className="-mt-2 text-center text-sm text-ink-500">You can write it now; you'll need the code from your community leader when collection opens.</p>}

      {pending.length > 0 && (
        <Link to="/grievances" className="flex items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 font-semibold text-warning">
          <CloudUpload className="h-5 w-5" aria-hidden />
          <span className="flex-1">{pending.length === 1 ? '1 grievance is saved on this phone, waiting to be sent' : `${pending.length} grievances are saved on this phone, waiting to be sent`}</span>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      )}

      <div className="grid gap-3">
        <HomeCard to="/grievances" icon={FileText} title="My grievances"
          body={mine.data ? (mine.data.length ? `${mine.data.length} submitted${needAck ? ` · ${needAck} need your response` : ''}` : 'Nothing submitted yet') : '…'}
          highlight={needAck > 0} />
        <HomeCard to="/track" icon={Search} title="Track a grievance" body="Find one with its tracking ID" />
        <HomeCard to="/notifications" icon={Bell} title="Notifications" body={unread ? `${unread} new` : 'No new messages'} highlight={unread > 0} />
      </div>

      <Link to="/help" className="block text-center text-[15px] font-semibold text-brand-700">How does this work?</Link>
    </div>
  );
}

function HomeCard({ to, icon: Icon, title, body, highlight }: { to: string; icon: typeof Bell; title: string; body: string; highlight?: boolean }) {
  return (
    <Link to={to} className="group flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line/70 transition-shadow hover:shadow-raised">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-50 to-brand-100 text-brand-700 shadow-[inset_0_-3px_6px_rgb(15_94_91/0.10)]">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className={cx('block text-[15px]', highlight ? 'font-semibold text-accent-700' : 'text-ink-500')}>{body}</span>
      </span>
      <ChevronRight className="h-5 w-5 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
