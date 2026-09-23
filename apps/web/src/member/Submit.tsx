import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Briefcase, CircleHelp, Factory, GraduationCap, Handshake, HeartPulse, KeyRound, Leaf, MapPin,
  Pencil, Route, Send, Users, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, useMasterData, useOnline } from '@/app/hooks';
import { api } from '@/lib/api';
import { messageFor } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { db, type OutboxItem } from '@/offline/db';
import { enqueue, newLocalId, onOutboxChange, retryItem, saveDraft, syncOutbox, discardItem } from '@/offline/sync';
import { Banner, Button, Card, Field, Input, Kbd, Stepper, Textarea, cx } from '@/design/ui';
import { SavedOnDeviceMark, SuccessMark } from '@/design/art';
import { CommunityPicker } from '@/auth/screens';
import { PageHeader } from './shell';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase, handshake: Handshake, road: Route, graduation: GraduationCap, heart: HeartPulse,
  people: Users, leaf: Leaf, factory: Factory,
};

type Draft = OutboxItem['payload'];
const CODE_RE = /^[A-Z0-9]{2,5}-\d{4}-\d{4}-[A-Z0-9]{4}$/;

export function Submit() {
  const { profile, userId } = useAuth();
  const nav = useNavigate();
  const online = useOnline();
  const master = useMasterData();
  const status = useCachedQuery(`submission-status:${userId}:${profile?.community_id}`, () => api.submissionStatus(profile?.community_id), { enabled: !!userId });

  const [localId, setLocalId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString());
  const [draft, setDraft] = useState<Draft>({
    submission_code: '', community_id: profile?.community_id ?? '', community_name: profile?.community_name ?? '',
    description: '', category_id: null, category_label: null, desired_resolution: '', suggestions: '',
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickCommunity, setPickCommunity] = useState(false);

  // Resume an unfinished draft, or start a new one.
  useEffect(() => {
    if (!userId) return;
    db.outbox.where('userId').equals(userId).filter((i) => i.state === 'draft').first().then((d) => {
      if (d) { setLocalId(d.localId); setDraft(d.payload); setCreatedAt(d.createdAt); }
      else setLocalId(newLocalId());
    });
  }, [userId]);

  // The released code is filled in for the member; they only type one if they were given it offline.
  const autoCode = status.data?.open && status.data.code ? status.data.code : null;
  useEffect(() => { if (autoCode && !draft.submission_code) setDraft((d) => ({ ...d, submission_code: autoCode })); }, [autoCode, draft.submission_code]);

  // Autosave (the draft survives closing the app or losing power).
  const first = useRef(true);
  useEffect(() => {
    if (!localId || !userId) return;
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveDraft({ localId, userId, createdAt, payload: draft }), 400);
    return () => clearTimeout(t);
  }, [draft, localId, userId, createdAt]);

  const steps = useMemo(() => [...(autoCode ? [] : ['Code']), 'Community', 'Your concern', 'Type of concern', 'What should we do?', 'Review'], [autoCode]);
  const name = steps[step];
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string | null => {
    if (name === 'Code' && !CODE_RE.test(draft.submission_code.trim().toUpperCase())) return 'Please enter the code exactly as given, e.g. AGB-2026-0923-X7P4.';
    if (name === 'Community' && !draft.community_id) return 'Please choose the community.';
    if (name === 'Your concern' && draft.description.trim().length < 10) return messageFor('description_too_short');
    return null;
  };
  const next = () => {
    const e = validate();
    setError(e);
    if (!e) { setStep((s) => Math.min(s + 1, steps.length - 1)); window.scrollTo({ top: 0 }); }
  };
  const back = () => { setError(null); if (step === 0) nav('/'); else setStep(step - 1); };

  const submit = async () => {
    if (!localId || !userId) return;
    setBusy(true);
    const payload = { ...draft, submission_code: draft.submission_code.trim().toUpperCase() };
    await saveDraft({ localId, userId, createdAt, payload });
    await enqueue(localId);                        // safe on the device from here
    if (navigator.onLine) await syncOutbox(userId, { force: true });
    setBusy(false);
    nav(`/submit/done/${localId}`, { replace: true });
  };

  if (!localId || master.isLoading) return <PageHeader title="Submit a grievance" back="/" />;

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={back} className="-ml-2 grid h-11 w-11 place-items-center rounded-full text-ink-700 hover:bg-surface" aria-label="Back"><ArrowLeft className="h-6 w-6" /></button>
        <h1 className="text-[22px] font-bold">Submit a grievance</h1>
      </div>
      <Stepper steps={steps} current={step} />

      <div className="mt-6 min-h-[44vh] space-y-5">
        {name === 'Code' && (
          <div className="space-y-4 animate-fade-up" key="code">
            <div className="flex items-start gap-3"><KeyRound className="mt-1 h-6 w-6 shrink-0 text-brand-700" aria-hidden />
              <p className="text-ink-700">{status.data && !status.data.open
                ? 'Collection is closed right now. If your community leader gave you a code, enter it below. Otherwise you can write your grievance and send it when collection opens.'
                : 'Enter the grievance submission code from your community leader.'}</p></div>
            <Field label="Submission code" htmlFor="code">
              <Input id="code" autoCapitalize="characters" autoComplete="off" placeholder="AGB-2026-0923-X7P4" className="font-mono text-lg uppercase tracking-wide"
                value={draft.submission_code} onChange={(e) => set({ submission_code: e.target.value.toUpperCase() })} />
            </Field>
          </div>
        )}

        {name === 'Community' && (
          <div className="space-y-4 animate-fade-up" key="community">
            {!pickCommunity && draft.community_id ? (
              <>
                <p className="text-lg text-ink-700">Is this grievance about your community?</p>
                <Card className="flex items-center gap-3 p-4"><MapPin className="h-6 w-6 text-brand-700" aria-hidden /><span className="text-xl font-bold">{draft.community_name}</span></Card>
                <Button size="lg" onClick={next}>Yes, {draft.community_name}</Button>
                <Button size="lg" variant="secondary" onClick={() => setPickCommunity(true)}>No, another community</Button>
              </>
            ) : (
              <CommunityPicker value={draft.community_id} onChange={(id, n) => { set({ community_id: id, community_name: n }); setPickCommunity(false); }} />
            )}
          </div>
        )}

        {name === 'Your concern' && (
          <div className="animate-fade-up" key="concern">
            <Field label="What is your concern?" htmlFor="desc" hint="Say what happened, where, and who is affected. Write in your own words.">
              <Textarea id="desc" autoFocus rows={7} maxLength={5000} value={draft.description} onChange={(e) => set({ description: e.target.value })}
                placeholder="For example: The road to Agbonchia market has been flooded since June. Children cannot get to school." />
            </Field>
            <p className="mt-1 text-right text-sm text-ink-400 tabular">{draft.description.length} / 5000</p>
          </div>
        )}

        {name === 'Type of concern' && (
          <div className="animate-fade-up" key="type">
            <p className="mb-3 text-lg text-ink-700">What is it mostly about?</p>
            <div className="grid grid-cols-2 gap-2.5">
              {master.data?.categories.map((c) => {
                const Icon = CATEGORY_ICONS[c.icon ?? ''] ?? CircleHelp;
                const active = draft.category_id === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => set({ category_id: c.id, category_label: c.public_label })} aria-pressed={active}
                    className={cx('flex min-h-[104px] flex-col items-start gap-2 rounded-2xl p-3.5 text-left ring-1 ring-inset transition-all',
                      active ? 'bg-brand-700 text-white ring-brand-700 shadow-raised' : 'bg-surface ring-line shadow-card hover:bg-brand-50')}>
                    <Icon className={cx('h-7 w-7', active ? 'text-accent-500' : 'text-brand-700')} aria-hidden />
                    <span className="font-semibold leading-tight">{c.public_label}</span>
                  </button>
                );
              })}
              <button type="button" onClick={() => set({ category_id: null, category_label: "I'm not sure" })} aria-pressed={draft.category_id === null && draft.category_label === "I'm not sure"}
                className={cx('col-span-2 flex min-h-14 items-center gap-3 rounded-2xl px-4 text-left font-semibold ring-1 ring-inset',
                  draft.category_id === null && draft.category_label === "I'm not sure" ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface ring-line')}>
                <CircleHelp className="h-6 w-6 shrink-0" aria-hidden /> <span>I'm not sure <span className="font-normal opacity-80">· the team will decide</span></span>
              </button>
            </div>
          </div>
        )}

        {name === 'What should we do?' && (
          <div className="space-y-5 animate-fade-up" key="resolution">
            <Field label="What would you like us to do?" htmlFor="want" optional hint="Tell us what would solve the problem for you.">
              <Textarea id="want" rows={4} maxLength={2000} value={draft.desired_resolution ?? ''} onChange={(e) => set({ desired_resolution: e.target.value })}
                placeholder="For example: Please repair the drainage before the rainy season." />
            </Field>
            <Field label="Any other suggestions?" htmlFor="sugg" optional>
              <Textarea id="sugg" rows={3} maxLength={2000} className="min-h-[96px]" value={draft.suggestions ?? ''} onChange={(e) => set({ suggestions: e.target.value })} />
            </Field>
          </div>
        )}

        {name === 'Review' && (
          <div className="space-y-3 animate-fade-up" key="review">
            <p className="text-lg text-ink-700">Please check everything before you send it.</p>
            <ReviewRow label="Community" value={draft.community_name} onEdit={() => setStep(steps.indexOf('Community'))} />
            <ReviewRow label="Your concern" value={draft.description} onEdit={() => setStep(steps.indexOf('Your concern'))} />
            <ReviewRow label="Type" value={draft.category_label ?? 'Not chosen'} onEdit={() => setStep(steps.indexOf('Type of concern'))} />
            {!!draft.desired_resolution?.trim() && <ReviewRow label="What you'd like us to do" value={draft.desired_resolution} onEdit={() => setStep(steps.indexOf('What should we do?'))} />}
            {!!draft.suggestions?.trim() && <ReviewRow label="Suggestions" value={draft.suggestions} onEdit={() => setStep(steps.indexOf('What should we do?'))} />}
            <p className="flex items-center gap-2 pt-1 text-sm text-ink-500"><KeyRound className="h-4 w-4" aria-hidden /> Submission code <Kbd>{draft.submission_code || '—'}</Kbd></p>
            {!online && <Banner tone="warning" title="You're offline">Your grievance will be saved on this phone and sent automatically when you're back online.</Banner>}
          </div>
        )}

        {error && <Banner tone="warning">{error}</Banner>}
      </div>

      {name !== 'Community' || pickCommunity || !draft.community_id ? (
        <div className="sticky bottom-20 mt-6 flex gap-3 bg-canvas/90 py-3 backdrop-blur">
          {name === 'Review'
            ? <Button size="lg" icon={Send} loading={busy} onClick={submit} className="h-16 text-lg">{online ? 'Send grievance' : 'Save and send later'}</Button>
            : <Button size="lg" iconRight={ArrowRight} onClick={next}>{name === 'What should we do?' && !draft.desired_resolution?.trim() && !draft.suggestions?.trim() ? 'Skip' : 'Continue'}</Button>}
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string | null | undefined; onEdit: () => void }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-500">{label}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words">{value}</p>
      </div>
      <button onClick={onEdit} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand-700 hover:bg-brand-50" aria-label={`Change ${label.toLowerCase()}`}><Pencil className="h-5 w-5" /></button>
    </Card>
  );
}

/* ---------------------------------------------------------------- Result */
export function SubmitDone() {
  const { localId } = useParams();
  const { userId } = useAuth();
  const nav = useNavigate();
  const online = useOnline();
  const [item, setItem] = useState<OutboxItem | null | undefined>(undefined);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!localId) return;
    const load = () => db.outbox.get(localId).then((i) => setItem(i ?? null));
    load();
    return onOutboxChange(load);
  }, [localId]);

  if (item === undefined) return null;
  if (item === null) return <div className="pt-10 text-center"><p>This draft is no longer on this phone.</p><Link to="/grievances" className="font-semibold text-brand-700">My grievances</Link></div>;

  if (item.state === 'synced') {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center animate-fade-up">
        <SuccessMark />
        <h1 className="mt-6 text-2xl font-bold">Your grievance has been submitted.</h1>
        <p className="mt-2 text-ink-700">It has reached the IPL Community Relations team.</p>
        <Card className="mt-6 w-full p-5">
          <p className="text-sm font-semibold text-ink-500">Tracking ID</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wide text-brand-800" data-testid="tracking-id">{item.trackingId}</p>
          <p className="mt-2 text-ink-700">Keep this tracking ID for reference.</p>
        </Card>
        <div className="mt-6 w-full space-y-3">
          <Button size="lg" onClick={() => nav(`/grievances/${item.serverId}`, { replace: true })}>Follow this grievance</Button>
          <Button size="lg" variant="secondary" onClick={() => nav('/', { replace: true })}>Back to home</Button>
        </div>
      </div>
    );
  }

  if (item.state === 'failed') {
    const codeProblem = item.lastError?.startsWith('code_');
    return (
      <div className="pt-8 animate-fade-up">
        <SavedOnDeviceMark />
        <h1 className="mt-6 text-center text-2xl font-bold">We couldn't submit your grievance</h1>
        <div className="mt-4"><Banner tone="warning">{messageFor(item.lastError ?? 'unknown')}</Banner></div>
        <p className="mt-4 text-center text-ink-700">Don't worry: your grievance is still saved on this phone.</p>
        {codeProblem && (
          <div className="mt-6 space-y-3">
            <Field label="New submission code" htmlFor="newcode">
              <Input id="newcode" className="font-mono uppercase" placeholder="AGB-2026-0923-X7P4" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </Field>
            <Button size="lg" disabled={!CODE_RE.test(code)} onClick={async () => { await retryItem(item.localId, { submission_code: code }); if (userId) await syncOutbox(userId, { force: true }); }}>Try again with this code</Button>
          </div>
        )}
        <div className="mt-6 space-y-3">
          <Button size="lg" variant="secondary" onClick={() => nav('/grievances')}>Keep it for later</Button>
          <Button size="lg" variant="ghost" onClick={async () => { if (confirm('Delete this grievance from your phone? This cannot be undone.')) { await discardItem(item.localId); nav('/'); } }}>Delete it</Button>
        </div>
      </div>
    );
  }

  // queued / syncing: honest "saved on this phone" state
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center text-center animate-fade-up">
      <SavedOnDeviceMark />
      <h1 className="mt-6 text-2xl font-bold">{item.state === 'syncing' ? 'Submitting your grievance…' : 'Saved on this phone'}</h1>
      <p className="mt-2 max-w-sm text-ink-700">
        {online
          ? "We're sending it to IPL now. Please keep the app open for a moment."
          : "You're offline. Your grievance is saved on this phone and will be submitted automatically when connection returns."}
      </p>
      <Card className="mt-6 w-full p-4 text-left">
        <p className="flex items-center gap-2 font-semibold text-warning"><span className="h-2.5 w-2.5 rounded-full bg-accent-500" aria-hidden /> Not yet received by IPL</p>
        <p className="mt-1 text-sm text-ink-500">Written {formatDate(item.createdAt)} · {item.payload.community_name}. You'll get a tracking ID once it arrives.</p>
      </Card>
      <div className="mt-6 w-full space-y-3">
        {online && <Button size="lg" variant="secondary" onClick={() => userId && syncOutbox(userId, { force: true })}>Try sending now</Button>}
        <Button size="lg" variant={online ? 'ghost' : 'primary'} onClick={() => nav('/', { replace: true })}>Back to home</Button>
      </div>
    </div>
  );
}
