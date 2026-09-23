import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, CircleCheck, FileText, LogOut, MapPin, MessageCircle, PenLine, Phone, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useCachedQuery, usePendingOutbox } from '@/app/hooks';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { toAppError } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { formatRelative } from '@/lib/format';
import { Banner, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Skeleton, cx, useToast } from '@/design/ui';
import { CommunityPicker } from '@/auth/screens';
import { PageHeader } from './shell';

/* ---------------------------------------------------------------- Notifications (members and staff) */
export function Notifications({ basePath = '/grievances' }: { basePath?: string }) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const q = useCachedQuery(`notifications:${userId}`, () => api.notifications(), { enabled: !!userId });
  const unread = (q.data ?? []).filter((n) => !n.read_at);
  useEffect(() => {
    // Mark as read shortly after the list is seen.
    if (!unread.length) return;
    const t = setTimeout(() => api.markRead(unread.map((n) => n.id)).then(() => qc.invalidateQueries({ queryKey: [`notifications:${userId}`] })).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [unread.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="animate-fade-up">
      <PageHeader title="Notifications" action={unread.length > 0 && <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => api.markRead().then(() => qc.invalidateQueries())}>Mark all read</Button>} />
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : !q.data?.length ? <EmptyState icon={Bell} title="No notifications" body="We'll let you know here when there is news about your grievances." />
        : (
          <ul className="space-y-2">
            {q.data.map((n) => {
              const inner = (
                <div className={cx('flex gap-3 rounded-2xl p-4 ring-1 transition-colors', n.read_at ? 'bg-surface ring-line/70' : 'bg-brand-50 ring-brand-200')}>
                  <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent-500')} aria-label={n.read_at ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-[15px] text-ink-700">{n.body}</p>
                    <p className="mt-1 text-xs text-ink-500">{formatRelative(n.created_at)}</p>
                  </div>
                </div>
              );
              return <li key={n.id}>{n.grievance_id ? <Link to={`${basePath}/${n.grievance_id}`}>{inner}</Link> : inner}</li>;
            })}
          </ul>
        )}
    </div>
  );
}

/* ---------------------------------------------------------------- Profile */
export function Profile() {
  const { profile, signOut, refresh, userId } = useAuth();
  const pending = usePendingOutbox(userId);
  const nav = useNavigate();
  const toast = useToast();
  const [edit, setEdit] = useState<'name' | 'community' | 'contact' | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (p: Parameters<typeof api.updateMyProfile>[0]) => {
    setBusy(true); setError(null);
    try { await api.updateMyProfile(p); await refresh(); setEdit(null); toast('Saved'); }
    catch (e) { setError(toAppError(e).message); }
    finally { setBusy(false); }
  };

  if (!profile) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4 animate-fade-up">
      <PageHeader title="Profile" />
      <Card className="divide-y divide-line">
        <Row label="Name" value={profile.full_name} onEdit={() => { setName(profile.full_name); setEdit('name'); }} />
        <Row label="Phone" value={formatPhone(profile.phone)} icon={Phone} />
        <Row label="Community" value={profile.community_name ?? 'Not set'} icon={MapPin} onEdit={() => setEdit('community')} />
        <Row label="Email and address" value={[profile.email, profile.address].filter(Boolean).join(' · ') || 'Not added (optional)'} onEdit={() => { setEmail(profile.email ?? ''); setAddress(profile.address ?? ''); setEdit('contact'); }} />
      </Card>
      <Link to="/help" className="flex items-center gap-3 rounded-2xl bg-surface p-4 font-semibold shadow-card ring-1 ring-line/70"><ShieldCheck className="h-5 w-5 text-brand-700" /> Help and privacy</Link>
      <Button size="lg" variant="secondary" icon={LogOut} onClick={() => setConfirmOut(true)}>Sign out</Button>

      <Modal open={edit === 'name'} onClose={() => setEdit(null)} title="Your name"
        footer={<Button onClick={() => save({ full_name: name })} loading={busy} disabled={name.trim().length < 2}>Save</Button>}>
        <Field label="Full name" htmlFor="pn"><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
      </Modal>
      <Modal open={edit === 'community'} onClose={() => setEdit(null)} title="Your community">
        <CommunityPicker value={profile.community_id} onChange={(id) => save({ community_id: id })} />
        {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
      </Modal>
      <Modal open={edit === 'contact'} onClose={() => setEdit(null)} title="Email and address"
        footer={<Button onClick={() => save({ email, address })} loading={busy}>Save</Button>}>
        <div className="space-y-4">
          <Field label="Email" htmlFor="pe" optional><Input id="pe" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Address" htmlFor="pa" optional><Input id="pa" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          {error && <Banner tone="warning">{error}</Banner>}
        </div>
      </Modal>
      <ConfirmDialog open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?" confirmLabel="Sign out" danger={pending.length > 0}
        onConfirm={async () => { await signOut(); nav('/signin', { replace: true }); }}
        body={pending.length > 0
          ? <Banner tone="warning" title={`${pending.length} grievance(s) not yet sent`}>Signing out removes them from this phone. Connect to the internet first so they can be sent.</Banner>
          : 'Your grievances are safe on the IPL system. Sign in again any time with your phone number and PIN.'} />
    </div>
  );
}

function Row({ label, value, onEdit, icon: Icon }: { label: string; value: string; onEdit?: () => void; icon?: typeof Phone }) {
  return (
    <div className="flex items-center gap-3 p-4">
      {Icon && <Icon className="h-5 w-5 text-ink-400" aria-hidden />}
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-500">{label}</p><p className="truncate">{value}</p></div>
      {onEdit && <Button size="sm" variant="ghost" onClick={onEdit}>Change</Button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Help */
export function Help() {
  const steps = [
    { icon: PenLine, title: 'Submit', body: 'When grievance collection is open for your community, write your concern in your own words. You get a tracking ID.' },
    { icon: Search, title: 'Track', body: 'Open "My grievances" to see where your grievance is. We notify you when something changes.' },
    { icon: FileText, title: 'Resolve', body: 'The officer responsible for your community works on it and records how it was resolved.' },
    { icon: CircleCheck, title: 'Acknowledge', body: 'You tell us whether you agree with the resolution. If not, it is looked at again.' },
  ];
  return (
    <div className="space-y-4 animate-fade-up">
      <PageHeader title="How it works" back="/" />
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title}><Card className="flex gap-4 p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700"><s.icon className="h-6 w-6" aria-hidden /></span>
            <div><p className="font-semibold">{i + 1}. {s.title}</p><p className="text-[15px] text-ink-700">{s.body}</p></div>
          </Card></li>
        ))}
      </ol>
      <Card className="space-y-2 p-4">
        <p className="font-semibold">No internet?</p>
        <p className="text-[15px] text-ink-700">You can still write a grievance. It is saved on your phone and sent automatically when you are back online. It only counts as received when you see your tracking ID.</p>
      </Card>
      <Card className="space-y-2 p-4">
        <p className="font-semibold">Your privacy</p>
        <p className="text-[15px] text-ink-700">Only you and the Community Relations staff responsible for your community can see your grievances. Other community members cannot.</p>
      </Card>
      {config.supportPhone && <a href={`tel:${config.supportPhone}`} className="flex items-center gap-3 rounded-2xl bg-surface p-4 font-semibold shadow-card"><MessageCircle className="h-5 w-5 text-brand-700" /> Call Community Relations</a>}
    </div>
  );
}
