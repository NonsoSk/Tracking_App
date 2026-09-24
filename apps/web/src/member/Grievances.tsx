import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, CloudUpload, FileText, MessageSquareWarning, Search, ThumbsUp } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, usePendingOutbox } from '@/app/hooks';
import { api } from '@/lib/api';
import { messageFor, toAppError } from '@/lib/errors';
import { formatDate, formatRelative } from '@/lib/format';
import type { MyGrievanceDetail } from '@/lib/types';
import { Banner, Button, Card, EmptyState, ErrorState, Field, Input, Kbd, NextStep, ProgressRing, Skeleton, StatusBadge, Textarea, cx, useToast } from '@/design/ui';
import { PageHeader } from './shell';

export function MyGrievances() {
  const { userId } = useAuth();
  const q = useCachedQuery(`my-grievances:${userId}`, () => api.myGrievances(), { enabled: !!userId });
  const pending = usePendingOutbox(userId);

  return (
    <div className="animate-fade-up">
      <PageHeader title="My grievances" action={<Link to="/track" className="grid h-11 w-11 place-items-center rounded-full text-brand-700 hover:bg-surface" aria-label="Track a grievance"><Search className="h-6 w-6" /></Link>} />
      {pending.length > 0 && (
        <section className="mb-5 space-y-2" aria-label="Saved on this phone">
          {pending.map((p) => (
            <Link key={p.localId} to={`/submit/done/${p.localId}`} className="flex items-center gap-3 rounded-2xl bg-warning-soft p-4">
              <CloudUpload className="h-6 w-6 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.payload.description}</p>
                <p className="text-sm text-warning">{p.state === 'failed' ? `Not sent: ${messageFor(p.lastError ?? '')}` : 'Saved on this phone · not yet sent'}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-warning" aria-hidden />
            </Link>
          ))}
        </section>
      )}
      {q.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : q.isError ? <ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} />
        : !q.data?.length && !pending.length ? (
          <EmptyState icon={FileText} title="No grievances yet" body="When you submit a grievance, you can follow its progress here."
            action={<Link to="/submit"><Button>Submit a grievance</Button></Link>} />
        ) : (
          <ul className="space-y-3">
            {q.data?.map((g) => (
              <li key={g.id}>
                <Link to={`/grievances/${g.id}`} className="block rounded-2xl bg-surface p-4 shadow-card transition-shadow hover:shadow-raised">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-brand-800">{g.tracking_id}</span>
                    <StatusBadge label={g.status_label} tone={g.status_tone} size="sm" />
                  </div>
                  <p className="mt-2 line-clamp-2 font-semibold">{g.title}</p>
                  <p className="mt-1 text-sm text-ink-500">{g.community_name} · Submitted {formatDate(g.submitted_at ?? g.date_received)} · Updated {formatRelative(g.updated_at)}</p>
                  {g.needs_acknowledgement && (
                    <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-100 px-3 py-2 text-sm font-bold text-brand-700">
                      <ThumbsUp className="h-4 w-4" aria-hidden /> Resolved: please tell us if you agree
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function Track() {
  const nav = useNavigate();
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const found = await api.findMyGrievance(id);
      if (found) nav(`/grievances/${found}`);
      else setError("We couldn't find a grievance with that tracking ID on your account. Please check it and try again.");
    } catch (err) { setError(toAppError(err).message); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-5 animate-fade-up">
      <PageHeader title="Track a grievance" back="/" />
      <Field label="Tracking ID" htmlFor="tid" hint="It looks like IPL-GRV-2026-000123. Older paper forms have IDs like IPL20261391F.">
        <Input id="tid" autoFocus autoCapitalize="characters" className="font-mono uppercase" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="IPL-GRV-2026-000123" />
      </Field>
      {error && <Banner tone="warning">{error}</Banner>}
      <Button size="lg" icon={Search} loading={busy} disabled={id.trim().length < 5}>Find grievance</Button>
    </form>
  );
}

/* ---------------------------------------------------------------- Detail + timeline + acknowledgement */
export function GrievanceDetail() {
  const { id = '' } = useParams();
  const q = useCachedQuery(`my-grievance:${id}`, () => api.myGrievanceDetail(id));
  if (q.isLoading) return <div className="space-y-3"><PageHeader title="Grievance" back="/grievances" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (q.isError || !q.data) return <><PageHeader title="Grievance" back="/grievances" /><ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} /></>;
  const g = q.data;
  return (
    <div className="space-y-4 animate-fade-up">
      <PageHeader title="Grievance" back="/grievances" />
      <TrackingCard g={g} />
      {!(g.status_code === 'RESOLVED' && g.ack_state === 'pending') && g.status_code !== 'CLOSED' && (
        <NextStep>{g.status_code === 'RESOLVED' ? 'Nothing needed from you. The team will close this grievance.' : 'Nothing needed from you now. We will send you an alert when there is news.'}</NextStep>
      )}

      {g.status_code === 'RESOLVED' && g.ack_state === 'pending' && <Acknowledge g={g} />}
      {g.resolution && !(g.status_code === 'RESOLVED' && g.ack_state === 'pending') && (
        <Card className="p-5">
          <h2 className="font-semibold">How it was resolved</h2>
          <p className="mt-2 whitespace-pre-wrap text-ink-700">{g.resolution.details}</p>
          {g.resolution.resolved_at && <p className="mt-2 text-sm text-ink-500">Resolved {formatDate(g.resolution.resolved_at)}</p>}
          {g.acknowledgement && (
            <p className={cx('mt-3 flex items-center gap-2 text-sm font-semibold', g.acknowledgement.response === 'acknowledged' ? 'text-success' : 'text-warning')}>
              {g.acknowledgement.response === 'acknowledged' ? <><Check className="h-4 w-4" aria-hidden /> You acknowledged this resolution</> : <><MessageSquareWarning className="h-4 w-4" aria-hidden /> You told us you were not satisfied</>}
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-4 font-extrabold">Progress</h2>
        <Timeline items={g.timeline} current={g.status_code} />
      </Card>

      {g.updates.length > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Messages from the team</h2>
          <ul className="mt-3 space-y-3">{g.updates.map((u, i) => <li key={i} className="rounded-xl bg-sunken p-3"><p className="whitespace-pre-wrap">{u.body}</p><p className="mt-1 text-xs text-ink-500">{formatDate(u.at)}</p></li>)}</ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Your grievance</h2>
        {g.category_label && <p className="mt-1 text-sm text-ink-500">{g.category_label}</p>}
        <p className="mt-2 whitespace-pre-wrap text-ink-700">{g.description}</p>
        {g.desired_resolution && <><h3 className="mt-4 text-sm font-semibold text-ink-500">What you asked for</h3><p className="mt-1 whitespace-pre-wrap text-ink-700">{g.desired_resolution}</p></>}
      </Card>
    </div>
  );
}

/** How far along the journey a grievance is: Submitted → Reviewed → Worked on → Resolved → Closed. */
const STAGE: Record<string, number> = {
  SUBMITTED: 1, ASSIGNED: 1, UNDER_REVIEW: 2, IN_PROGRESS: 3, AWAITING_ACTION: 3, REOPENED: 3, RESOLVED: 4, CLOSED: 5,
};

function TrackingCard({ g }: { g: MyGrievanceDetail }) {
  const stage = STAGE[g.status_code] ?? 1;
  const settled = g.status_code === 'RESOLVED' || g.status_code === 'CLOSED';
  return (
    <section aria-label="Tracking card" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[rgb(var(--hero-a))] via-[rgb(var(--hero-b))] to-[rgb(var(--hero-c))] p-5 text-white shadow-[0_14px_32px_rgb(0_37_122/0.3)]">
      <span className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute -bottom-[150px] -right-28 h-44 w-80 rotate-[-16deg] rounded-[50%] border-t-[8px] border-[#C00000]/90" aria-hidden />
      <div className="relative flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-white/70">Tracking ID</p>
          <p className="embossed mt-1 whitespace-nowrap text-[15px] !tracking-[0.06em] leading-snug">{g.tracking_id}</p>
          <span className={cx('mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-extrabold', settled ? 'bg-[#FDF3DF] text-[#8C5709]' : 'bg-white/15 text-white')}>
            {g.status_label}
          </span>
        </div>
        <ProgressRing value={stage} max={5} size={78} stroke={8} onBlue label={`Step ${stage} of 5`}>
          <span className="text-center leading-none"><span className="block text-[20px] font-extrabold tabular">{stage}/5</span><span className="text-[10px] font-bold uppercase tracking-wider text-white/70">steps</span></span>
        </ProgressRing>
      </div>
      <p className="relative mt-3 text-[15px] leading-snug text-white/90">{g.status_message}</p>
      <p className="relative mt-2 text-[13px] text-white/65">{g.community_name} · Submitted {formatDate(g.submitted_at ?? g.date_received)}</p>
    </section>
  );
}

function Timeline({ items, current }: { items: MyGrievanceDetail['timeline']; current: string }) {
  const done = current === 'CLOSED';
  return (
    <ol className="relative">
      {items.map((t, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5 bg-brand-200" aria-hidden />}
            <span className={cx('relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full',
              last && !done ? 'bg-sky text-white ring-4 ring-brand-100' : 'bg-btn text-white')}>
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <div className="pt-0.5">
              <p className="font-semibold">{t.label}</p>
              <p className="text-sm text-ink-500">{formatDate(t.at)}</p>
              {last && <p className="mt-1 text-[15px] text-ink-700">{t.message}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Acknowledge({ g }: { g: MyGrievanceDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'ask' | 'dispute'>('ask');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (response: 'acknowledged' | 'disputed') => {
    setBusy(true); setError(null);
    try {
      await api.acknowledge(g.id, response, response === 'disputed' ? reason : undefined);
      toast(response === 'acknowledged' ? 'Thank you. Your acknowledgement was recorded.' : 'Thank you. The team will look at your grievance again.');
      await qc.invalidateQueries();
    } catch (e) { setError(toAppError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="overflow-hidden ring-2 ring-inset ring-brand-200">
      <div className="bg-brand-50 p-5">
        <h2 className="text-lg font-bold">Your grievance has been marked as resolved.</h2>
        <dl className="mt-3 space-y-2 text-[15px]">
          <div><dt className="font-semibold text-ink-500">Tracking ID</dt><dd><Kbd>{g.tracking_id}</Kbd></dd></div>
          <div><dt className="font-semibold text-ink-500">Resolution</dt><dd className="whitespace-pre-wrap text-ink-900">{g.resolution?.details}</dd></div>
          <div><dt className="font-semibold text-ink-500">Date resolved</dt><dd>{formatDate(g.resolution?.resolved_at ?? g.resolved_at)}</dd></div>
        </dl>
      </div>
      <div className="space-y-3 p-5">
        {mode === 'ask' ? (
          <>
            <p className="text-lg font-semibold">Do you acknowledge this resolution?</p>
            <Button size="lg" icon={ThumbsUp} loading={busy} onClick={() => send('acknowledged')}>Yes, I acknowledge</Button>
            <Button size="lg" variant="secondary" icon={MessageSquareWarning} onClick={() => setMode('dispute')}>No, I have a concern</Button>
          </>
        ) : (
          <>
            <Field label="What is still not right?" htmlFor="reason">
              <Textarea id="reason" autoFocus rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell us briefly why you are not satisfied." />
            </Field>
            <Button size="lg" loading={busy} disabled={reason.trim().length < 3} onClick={() => send('disputed')}>Send my response</Button>
            <Button size="lg" variant="ghost" onClick={() => setMode('ask')}>Back</Button>
          </>
        )}
        {error && <Banner tone="warning">{error}</Banner>}
      </div>
    </Card>
  );
}
