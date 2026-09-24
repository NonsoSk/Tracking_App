import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, FilePlus2, KeyRound, Plus, Rocket } from 'lucide-react';
import { useMasterData } from '@/app/hooks';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import type { SubmissionCode, Tone } from '@/lib/types';
import { Banner, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Kbd, Modal, Select, Skeleton, StatusBadge, Textarea, useToast } from '@/design/ui';
import { PageTitle } from './shell';

const STATE: Record<SubmissionCode['state'], { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' }, draft: { label: 'Not released', tone: 'muted' }, scheduled: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'muted' }, full: { label: 'Limit reached', tone: 'warning' }, deactivated: { label: 'Deactivated', tone: 'danger' },
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export function Codes() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['codes'], queryFn: api.codes });
  const [creating, setCreating] = useState(false);
  const [deactivate, setDeactivate] = useState<SubmissionCode | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); await qc.invalidateQueries({ queryKey: ['codes'] }); return true; }
    catch (e) { toast(toAppError(e).message, 'warning'); return false; }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Submission codes" subtitle="Only the Super Admin creates codes. Share a code with the community leaders; members must type it exactly to submit. Each grievance still gets its own tracking ID."
        actions={<Button icon={Plus} onClick={() => setCreating(true)}>New code</Button>} />
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} />
        : !q.data?.length ? <EmptyState icon={KeyRound} title="No codes yet" body="Create a code to open grievance collection for a community." action={<Button icon={Plus} onClick={() => setCreating(true)}>New code</Button>} />
        : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.data.map((c) => (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.scope_name}</p>
                    {c.label && <p className="text-sm text-ink-500">{c.label}</p>}
                  </div>
                  <StatusBadge label={STATE[c.state].label} tone={STATE[c.state].tone} size="sm" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Kbd>{c.code}</Kbd>
                  <button className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-sunken" aria-label="Copy code"
                    onClick={() => navigator.clipboard?.writeText(c.code).then(() => toast('Code copied'))}><Copy className="h-4 w-4" /></button>
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-ink-500">Valid</dt><dd>{formatDate(c.valid_from)} – {formatDate(c.valid_until)}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Submissions</dt><dd className="tabular">{c.submission_count}{c.max_submissions ? ` / ${c.max_submissions}` : ''}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-500">Created</dt><dd>{c.created_by ?? '—'} · {formatDate(c.created_at)}</dd></div>
                  {c.released_at && <div className="flex justify-between"><dt className="text-ink-500">Released</dt><dd>{c.released_by} · {formatDateTime(c.released_at)}</dd></div>}
                  {c.deactivated_at && <div className="flex justify-between"><dt className="text-ink-500">Deactivated</dt><dd>{c.deactivated_by} · {formatDate(c.deactivated_at)}</dd></div>}
                </dl>
                <div className="mt-4 flex gap-2 pt-1">
                  {c.state === 'draft' && <Button size="sm" icon={Rocket} loading={busy} onClick={() => act(() => api.releaseCode(c.id), 'Activated. Members are told collection is open (without the code); share the code with the leaders.')}>Release</Button>}
                  {['draft', 'active', 'scheduled', 'full'].includes(c.state) && <Button size="sm" variant="secondary" icon={Ban} onClick={() => setDeactivate(c)}>Deactivate</Button>}
                </div>
              </Card>
            ))}
          </div>
        )}
      <CreateCode open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={!!deactivate} onClose={() => setDeactivate(null)} title={`Deactivate ${deactivate?.code}?`} confirmLabel="Deactivate" danger loading={busy}
        onConfirm={async () => { if (deactivate && await act(() => api.deactivateCode(deactivate.id, reason), 'Code deactivated')) { setDeactivate(null); setReason(''); } }}
        body="Members will no longer be able to submit with this code. Grievances already submitted are not affected.">
        <div className="mt-3"><Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </ConfirmDialog>
    </div>
  );
}

function CreateCode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const master = useMasterData();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState('community');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(today());
  const [until, setUntil] = useState(plusDays(3));
  const [max, setMax] = useState('');
  const [label, setLabel] = useState('');
  const [release, setRelease] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = master.data;
  const options: [string, string][] = !d ? [] : scope === 'community' ? d.communities.map((c) => [c.id, c.name])
    : scope === 'cluster' ? d.clusters.map((c) => [String(c.id), `Pipeline · ${c.name}`])
    : scope === 'community_type' ? d.community_types.map((t) => [String(t.id), `All ${t.name} communities`]) : [];

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const p: Record<string, unknown> = {
        scope_type: scope, label: label || null, release,
        valid_from: new Date(`${from}T00:00:00+01:00`).toISOString(),
        valid_until: new Date(`${until}T23:59:59+01:00`).toISOString(),
        max_submissions: max ? Number(max) : null,
      };
      if (scope === 'community') p.community_id = target;
      if (scope === 'cluster') p.cluster_id = Number(target);
      if (scope === 'community_type') p.community_type_id = Number(target);
      const c = await api.createCode(p);
      toast(`Code ${c.code} ${release ? 'released' : 'created'}`);
      await qc.invalidateQueries({ queryKey: ['codes'] });
      onClose();
    } catch (e) { setError(toAppError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New submission code"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={scope !== 'all' && !target} onClick={submit}>{release ? 'Create and release' : 'Create'}</Button></>}>
      <div className="space-y-4">
        <Field label="Who can use it?" htmlFor="scope">
          <Select id="scope" value={scope} onChange={(e) => { setScope(e.target.value); setTarget(''); }}>
            <option value="community">One community</option><option value="cluster">A pipeline cluster</option>
            <option value="community_type">A community type</option><option value="all">All communities</option>
          </Select>
        </Field>
        {scope !== 'all' && (
          <Select aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>Choose…</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opens" htmlFor="from"><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Closes (end of day)" htmlFor="until"><Input id="until" type="date" value={until} min={from} onChange={(e) => setUntil(e.target.value)} /></Field>
        </div>
        <Field label="Maximum submissions" htmlFor="max" optional><Input id="max" type="number" min={1} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        <Field label="Label" htmlFor="lbl" optional hint="e.g. September town hall"><Input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={release} onChange={(e) => setRelease(e.target.checked)} />Activate now (members are told collection is open, but never shown the code)</label>
        {error && <Banner tone="warning">{error}</Banner>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- paper / assisted entry */
export function NewGrievance() {
  const master = useMasterData();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ origin: 'paper', complainant_name: '', complainant_phone: '', complainant_gender: '', complainant_email: '', complainant_address: '',
    community_id: '', date_received: today(), form_issued_date: '', description: '', desired_resolution: '', suggestions: '', category_id: '', subcategory_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const d = master.data;

  const submit = async () => {
    setError(null);
    if (f.complainant_phone && !normalizePhone(f.complainant_phone)) return setError('Please check the phone number.');
    setBusy(true);
    try {
      const r = await api.submitAssisted({
        ...f, client_submission_id: crypto.randomUUID(),
        category_id: f.category_id ? Number(f.category_id) : null, subcategory_id: f.subcategory_id ? Number(f.subcategory_id) : null,
        form_issued_date: f.form_issued_date || null, complainant_gender: f.complainant_gender || null,
      });
      toast(`Saved as ${r.tracking_id}`);
      nav(`/grievances/${r.id}`);
    } catch (e) { setError(toAppError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Enter a paper grievance form" subtitle="For forms collected through community leaders, or when helping someone in person." />
      <Card className="space-y-6 p-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="How was it received?" htmlFor="origin"><Select id="origin" value={f.origin} onChange={(e) => set('origin', e.target.value)}><option value="paper">Paper form</option><option value="assisted">In person / by phone</option></Select></Field>
          <Field label="Date on the form" htmlFor="dr"><Input id="dr" type="date" max={today()} value={f.date_received} onChange={(e) => set('date_received', e.target.value)} /></Field>
          <Field label="Full name" htmlFor="cn"><Input id="cn" value={f.complainant_name} onChange={(e) => set('complainant_name', e.target.value)} /></Field>
          <Field label="Phone number" htmlFor="cp" optional><Input id="cp" type="tel" value={f.complainant_phone} onChange={(e) => set('complainant_phone', e.target.value)} placeholder="0803 123 4567" /></Field>
          <Field label="Community" htmlFor="cm"><Select id="cm" value={f.community_id} onChange={(e) => set('community_id', e.target.value)}><option value="" disabled>Choose…</option>{d?.communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Gender" htmlFor="cg" optional><Select id="cg" value={f.complainant_gender} onChange={(e) => set('complainant_gender', e.target.value)}><option value="">Not stated</option><option value="female">Female</option><option value="male">Male</option></Select></Field>
          <Field label="Email" htmlFor="ce" optional><Input id="ce" type="email" value={f.complainant_email} onChange={(e) => set('complainant_email', e.target.value)} /></Field>
          <Field label="Address" htmlFor="ca" optional><Input id="ca" value={f.complainant_address} onChange={(e) => set('complainant_address', e.target.value)} /></Field>
        </section>
        <Field label="Concern / grievance (as written on the form)" htmlFor="desc"><Textarea id="desc" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="What they would like done" htmlFor="dres" optional><Textarea id="dres" className="min-h-[90px]" value={f.desired_resolution} onChange={(e) => set('desired_resolution', e.target.value)} /></Field>
        <Field label="Suggestions" htmlFor="sug" optional><Textarea id="sug" className="min-h-[90px]" value={f.suggestions} onChange={(e) => set('suggestions', e.target.value)} /></Field>
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="cat" optional><Select id="cat" value={f.category_id} onChange={(e) => { set('category_id', e.target.value); set('subcategory_id', ''); }}><option value="">Not sure</option>{d?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Sub-category" htmlFor="sub" optional><Select id="sub" value={f.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)}><option value="">Not set</option>{d?.subcategories.filter((s) => !f.category_id || s.category_id === Number(f.category_id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </section>
        {error && <Banner tone="warning">{error}</Banner>}
        <div className="flex justify-end"><Button icon={FilePlus2} loading={busy} disabled={!f.complainant_name.trim() || !f.community_id || f.description.trim().length < 10} onClick={submit}>Save grievance</Button></div>
      </Card>
    </div>
  );
}
