import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArrowLeft, ArrowRightLeft, CheckCircle2, ClipboardCheck, FileSpreadsheet, Flag, History, Lock,
  MessageSquare, MessageSquarePlus, Phone, Send, ShieldAlert, Trash2, UserRound, Wrench,
} from 'lucide-react';
import { useMasterData } from '@/app/hooks';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { HistoryItem, StaffDetail } from '@/lib/types';
import { Banner, Button, Card, ConfirmDialog, ErrorState, Field, Input, Modal, OverdueBadge, Select, Skeleton, StatusBadge, Tabs, Textarea, cx, useToast } from '@/design/ui';
import { useStaffDirectory } from './Grievances';

type Tab = 'update' | 'remark' | 'resolve' | 'assign' | 'ack';

export function Workspace() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['staff-detail', id], queryFn: () => api.staffDetail(id) });
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div></div>;
  if (q.isError || !q.data) return <><BackLink /><ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} /></>;
  return <WorkspaceView g={q.data} />;
}

function BackLink() {
  const nav = useNavigate();
  return <button onClick={() => (history.length > 1 ? nav(-1) : nav('/grievances'))} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 no-print"><ArrowLeft className="h-4 w-4" />Back</button>;
}

function WorkspaceView({ g }: { g: StaffDetail }) {
  const closed = g.status_code === 'CLOSED';
  return (
    <div className="animate-fade-up">
      <BackLink />
      <header className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-brand-900">{g.tracking_id}</h1>
            <StatusBadge label={g.status_label} tone={g.status_tone} />
            {g.is_overdue && <OverdueBadge days={g.days_outstanding} />}
            {g.is_due_soon && <StatusBadge label="Due soon" tone="warning" size="sm" />}
            {g.is_legacy && <StatusBadge label="Historical record" tone="muted" size="sm" icon={History} />}
            {g.archived_at && <StatusBadge label="Archived" tone="danger" size="sm" icon={Archive} />}
          </div>
          <p className="mt-1 text-ink-500">
            {g.community_name ?? 'Community not recorded'}{g.community_type && ` · ${g.community_type}`}{g.cluster_name && ` · ${g.cluster_name}`}
            {' · '}Received {formatDate(g.date_received, g.date_received_precision)}
            {g.days_outstanding != null && <> · <b className={g.is_overdue ? 'text-danger' : 'text-ink-700'}>{g.days_outstanding} working days outstanding</b></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => window.print()}>Print</Button>
          <MoreActions g={g} />
        </div>
      </header>

      {g.legacy_needs_review && <div className="mb-4"><Banner tone="warning" title="Historical open item: review needed">This grievance was imported as still open. It does not raise overdue alerts until you review it and resolve its "needs review" flag.</Banner></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <SectionTitle>Grievance</SectionTitle>
            {g.title && g.title !== g.description.slice(0, 80) && <p className="mb-2 font-semibold">{g.title}</p>}
            <p className="whitespace-pre-wrap leading-relaxed text-ink-900">{g.description}</p>
            {g.text_amended && <p className="mt-2 text-xs text-ink-500">Text corrected by an administrator (see the audit log for the original).</p>}
            {g.incident_details && <Block label="Incident details">{g.incident_details}</Block>}
            {g.desired_resolution && <Block label="What the complainant asked for">{g.desired_resolution}</Block>}
            {g.suggestions && <Block label="Suggestions">{g.suggestions}</Block>}
          </Card>

          {g.resolution && (
            <Card className="border-l-4 border-success p-5">
              <SectionTitle icon={<CheckCircle2 className="h-5 w-5 text-success" />}>Resolution</SectionTitle>
              <p className="whitespace-pre-wrap">{g.resolution.details}</p>
              {g.resolution.public_summary && <Block label="Summary sent to the complainant">{g.resolution.public_summary}</Block>}
              <p className="mt-3 text-sm text-ink-500">
                {g.resolution.resolved_at ? `Resolved ${formatDate(g.resolution.resolved_at)}` : 'Resolution date not recorded'}{g.resolution.resolved_by && ` by ${g.resolution.resolved_by}`}
                {' · '}Acknowledgement: <b>{ackLabel(g.ack_state)}</b>
              </p>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle icon={<History className="h-5 w-5 text-ink-500" />}>History</SectionTitle>
            <HistoryTimeline items={g.history} monthOnly={g.is_legacy && g.date_received_precision === 'month'} />
          </Card>

          {g.sources.length > 0 && <SourceRecords g={g} />}
        </div>

        <aside className="space-y-5">
          {!closed && !g.archived_at && <ActionPanel g={g} />}
          <Card className="p-5">
            <SectionTitle icon={<UserRound className="h-5 w-5 text-ink-500" />}>Complainant</SectionTitle>
            <dl className="space-y-2 text-[15px]">
              <Row label="Name">{g.complainant_name ?? <span className="text-ink-400">Not recorded</span>}</Row>
              {g.complainant_phone && <Row label="Phone"><a className="inline-flex items-center gap-1 font-semibold text-brand-700" href={`tel:${g.complainant_phone}`}><Phone className="h-4 w-4" />{formatPhone(g.complainant_phone)}</a></Row>}
              {g.complainant_gender && <Row label="Gender"><span className="capitalize">{g.complainant_gender}</span></Row>}
              {g.complainant_email && <Row label="Email">{g.complainant_email}</Row>}
              {g.complainant_address && <Row label="Address">{g.complainant_address}</Row>}
              <Row label="Channel">{originLabel(g.origin)}</Row>
            </dl>
          </Card>
          <Card className="p-5">
            <SectionTitle>Details</SectionTitle>
            <dl className="space-y-2 text-[15px]">
              <Row label="Category">{g.category_name ?? <span className="text-ink-400">Not set</span>}</Row>
              <Row label="Sub-category">{g.subcategory_name ?? <span className="text-ink-400">Not set</span>}</Row>
              <Row label="Severity">{g.severity_name ?? <span className="text-ink-400">Not set</span>}</Row>
              <Row label="Officer">{g.assigned_officer_name ?? <span className="text-ink-400">Unassigned</span>}</Row>
              {g.sla_due_at && g.is_open && <Row label="Due">{formatDateTime(g.sla_due_at)}</Row>}
              {g.submitted_at && <Row label="Submitted">{formatDateTime(g.submitted_at)}</Row>}
              {g.first_response_at && <Row label="First response">{formatDateTime(g.first_response_at)}</Row>}
              {g.closed_at && <Row label="Closed">{formatDate(g.closed_at)}{g.closure_officer_name && ` by ${g.closure_officer_name}`}</Row>}
            </dl>
          </Card>
          {g.flags.some((f) => !f.resolved_at) && <FlagsCard g={g} />}
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- action panel */
function ActionPanel({ g }: { g: StaffDetail }) {
  const tabs = ([
    g.can.update_status && { value: 'update' as Tab, label: 'Status' },
    g.can.comment && { value: 'remark' as Tab, label: 'Remark' },
    g.can.resolve && g.status_code !== 'RESOLVED' && { value: 'resolve' as Tab, label: 'Resolve' },
    (g.can.assign || g.can.triage) && { value: 'assign' as Tab, label: 'Assign' },
    g.can.record_ack && g.status_code === 'RESOLVED' && { value: 'ack' as Tab, label: 'Acknowledgement' },
  ].filter(Boolean)) as { value: Tab; label: string }[];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? 'remark');
  if (!tabs.length) return null;
  return (
    <Card className="p-4 no-print">
      <Tabs value={tab} onChange={setTab} items={tabs} />
      <div className="mt-4">
        {tab === 'update' && <StatusForm g={g} />}
        {tab === 'remark' && <RemarkForm g={g} />}
        {tab === 'resolve' && <ResolveForm g={g} />}
        {tab === 'assign' && <AssignForm g={g} />}
        {tab === 'ack' && <AckForm g={g} />}
      </div>
    </Card>
  );
}

function useAct(g: StaffDetail) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(null);
    try {
      await fn();
      toast(ok);
      await Promise.all([qc.invalidateQueries({ queryKey: ['staff-detail', g.id] }), qc.invalidateQueries({ queryKey: ['staff-list'] }),
        qc.invalidateQueries({ queryKey: ['officer-home'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
      return true;
    } catch (e) { setError(toAppError(e).message); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

function StatusForm({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const [to, setTo] = useState(g.next_statuses[0]?.code ?? '');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  if (!g.next_statuses.length) return <p className="text-sm text-ink-500">No status changes are available from "{g.status_label}". Use Resolve to record a resolution.</p>;
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.changeStatus(g.id, to, note, visible), 'Status updated')) setNote(''); }}>
      <Field label="Move to" htmlFor="st"><Select id="st" value={to} onChange={(e) => setTo(e.target.value)}>{g.next_statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</Select></Field>
      <Field label="Note" htmlFor="stn" optional><Textarea id="stn" className="min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={visible} onChange={(e) => setVisible(e.target.checked)} />Show this step on the complainant's timeline</label>
      {error && <Banner tone="warning">{error}</Banner>}
      <Button type="submit" loading={busy} icon={ArrowRightLeft} className="w-full">Update status</Button>
    </form>
  );
}

function RemarkForm({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const [kind, setKind] = useState<'internal' | 'complainant' | 'action'>('internal');
  const [body, setBody] = useState('');
  const [actionType, setActionType] = useState('action');
  const submit = async () => {
    const ok = kind === 'action'
      ? await run(() => api.addAction(g.id, body, actionType), 'Action recorded')
      : await run(() => api.addComment(g.id, body, kind), kind === 'internal' ? 'Internal remark added' : 'Message sent to the complainant');
    if (ok) setBody('');
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1 text-sm font-semibold">
        {([['internal', 'Internal remark'], ['action', 'Action taken'], ['complainant', 'Message complainant']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-lg px-2 py-2', kind === k ? 'bg-surface shadow-card text-brand-800' : 'text-ink-500')}>{l}</button>
        ))}
      </div>
      {kind === 'action' && (
        <Select aria-label="Action type" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          <option value="action">Action</option><option value="management_action">Management action</option><option value="field_visit">Field visit</option>
          <option value="meeting">Meeting</option><option value="call">Phone call</option><option value="referral">Referral</option>
        </Select>
      )}
      <Textarea aria-label="Text" className="min-h-[110px]" value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'internal' ? 'Only staff can see this.' : kind === 'complainant' ? 'The complainant will see this in the app.' : 'What was done?'} />
      {kind === 'complainant' && <p className="flex items-start gap-1.5 text-xs text-ink-500"><ShieldAlert className="h-4 w-4 shrink-0" />Visible to the complainant. Don't include internal or personal information.</p>}
      {error && <Banner tone="warning">{error}</Banner>}
      <Button loading={busy} disabled={body.trim().length < 2} onClick={submit} icon={kind === 'complainant' ? Send : MessageSquarePlus} className="w-full">
        {kind === 'internal' ? 'Add remark' : kind === 'action' ? 'Record action' : 'Send message'}
      </Button>
    </div>
  );
}

function ResolveForm({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const [details, setDetails] = useState('');
  const [summary, setSummary] = useState('');
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      <Field label="How was it resolved?" htmlFor="rd" hint="The complainant will see this and be asked whether they agree.">
        <Textarea id="rd" value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <Field label="Short summary for WhatsApp" htmlFor="rs" optional hint="Leave blank to use the text above (first 600 characters).">
        <Textarea id="rs" className="min-h-[80px]" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      {error && <Banner tone="warning">{error}</Banner>}
      <Button icon={ClipboardCheck} disabled={details.trim().length < 10} onClick={() => setConfirm(true)} className="w-full">Mark as resolved</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Mark as resolved?" confirmLabel="Resolve and notify" loading={busy}
        onConfirm={async () => { if (await run(() => api.resolve(g.id, details, summary || undefined), 'Resolved. The complainant has been notified.')) setConfirm(false); }}
        body={<>The complainant{g.complainant_phone ? ' will be notified in the app and by WhatsApp (when enabled), and' : ''} will be asked to acknowledge the resolution. If they don't agree, the grievance reopens.</>} />
    </div>
  );
}

function AssignForm({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const staff = useStaffDirectory();
  const master = useMasterData();
  const [officer, setOfficer] = useState(g.assigned_officer_id ?? '');
  const [reason, setReason] = useState('');
  const [cat, setCat] = useState<number | ''>(g.category_id ?? '');
  const [sub, setSub] = useState<number | ''>(g.subcategory_id ?? '');
  const [sev, setSev] = useState<number | ''>(g.severity_id ?? '');
  const [aff, setAff] = useState<number | ''>(g.community_type_id ?? '');
  const officers = (staff.data ?? []).filter((s) => s.is_active && (s.roles.includes('officer') || s.roles.includes('supervisor')));
  const subs = master.data?.subcategories.filter((s) => !cat || s.category_id === cat) ?? [];
  return (
    <div className="space-y-5">
      {g.can.assign && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api.assign(g.id, officer, reason || undefined), 'Assigned'); }}>
          <Field label="Officer in charge" htmlFor="off">
            <Select id="off" value={officer} onChange={(e) => setOfficer(e.target.value)}><option value="" disabled>Choose an officer</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</Select>
          </Field>
          <Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" variant="secondary" loading={busy} disabled={!officer || officer === g.assigned_officer_id} className="w-full">Assign</Button>
        </form>
      )}
      {g.can.triage && master.data && (
        <form className="space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); run(() => api.triage(g.id, { category_id: cat || null, subcategory_id: sub || null, severity_id: sev || null, ...(aff && aff !== g.community_type_id ? { community_type_id: aff } : {}) }), 'Details updated'); }}>
          <p className="font-semibold">Classify</p>
          <Select aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value ? Number(e.target.value) : ''); setSub(''); }}><option value="">Category: not set</option>{master.data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select aria-label="Sub-category" value={sub} onChange={(e) => setSub(e.target.value ? Number(e.target.value) : '')}><option value="">Sub-category: not set</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value ? Number(e.target.value) : '')}><option value="">Severity: not set</option>{master.data.severities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {(g.affiliations?.length ?? 0) > 1 && (
            <Field label="Count this grievance as" htmlFor="aff" hint={`${g.community_name} belongs to more than one group.`}>
              <Select id="aff" value={aff} onChange={(e) => setAff(Number(e.target.value))}>
                {g.affiliations!.map((a) => <option key={a.community_type_id} value={a.community_type_id}>{a.type}{a.cluster ? ` · ${a.cluster}` : ''}{a.is_primary ? ' (default)' : ''}</option>)}
              </Select>
            </Field>
          )}
          <Button type="submit" variant="secondary" loading={busy} className="w-full">Save classification</Button>
        </form>
      )}
      {error && <Banner tone="warning">{error}</Banner>}
    </div>
  );
}

function AckForm({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const [response, setResponse] = useState<'acknowledged' | 'disputed'>('acknowledged');
  const [channel, setChannel] = useState('phone');
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-700">Status: <b>{ackLabel(g.ack_state)}</b>. Record what the complainant told you, or send a reminder.</p>
      <Select aria-label="Response" value={response} onChange={(e) => setResponse(e.target.value as 'acknowledged')}><option value="acknowledged">They agree (acknowledged)</option><option value="disputed">They do not agree</option></Select>
      <Select aria-label="How" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="phone">By phone</option><option value="in_person">In person</option><option value="whatsapp">By WhatsApp</option><option value="paper">On paper</option></Select>
      {response === 'disputed' && <Textarea aria-label="Reason" className="min-h-[80px]" placeholder="What did they say?" value={reason} onChange={(e) => setReason(e.target.value)} />}
      {error && <Banner tone="warning">{error}</Banner>}
      <Button loading={busy} className="w-full" onClick={() => run(() => api.recordAck(g.id, response, reason || null, channel), 'Acknowledgement recorded')}>Record response</Button>
      <Button variant="ghost" className="w-full" loading={busy} onClick={() => run(() => api.requestAck(g.id), 'Reminder sent')}>Send reminder to complainant</Button>
    </div>
  );
}

/* ---------------------------------------------------------------- archive / delete / amend */
function MoreActions({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const nav = useNavigate();
  const [mode, setMode] = useState<null | 'archive' | 'request' | 'delete' | 'amend' | 'close'>(null);
  const [reason, setReason] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [amendText, setAmendText] = useState(g.description);
  const close = () => { setMode(null); setReason(''); setConfirmId(''); };
  const canClose = g.status_code === 'RESOLVED' && g.can.close;
  return (
    <>
      {canClose && <Button icon={Lock} onClick={() => setMode('close')}>Close grievance</Button>}
      {g.can.amend && <Button variant="secondary" icon={Wrench} onClick={() => setMode('amend')}>Correct text</Button>}
      {g.can.archive && !g.archived_at && <Button variant="secondary" icon={Archive} onClick={() => setMode('archive')}>Archive</Button>}
      {!g.can.archive && g.can.request_archive && <Button variant="secondary" icon={Archive} onClick={() => setMode('request')}>Request archive</Button>}
      {g.archived_at && g.can.archive && <Button variant="secondary" onClick={() => run(() => api.restore(g.id), 'Restored')}>Restore</Button>}
      {g.archived_at && g.can.hard_delete && <Button variant="danger" icon={Trash2} onClick={() => setMode('delete')}>Delete permanently</Button>}

      <ConfirmDialog open={mode === 'close'} onClose={close} title="Close this grievance?" confirmLabel="Close grievance" loading={busy}
        onConfirm={async () => { if (await run(() => api.changeStatus(g.id, 'CLOSED', reason || undefined), 'Grievance closed')) close(); }}
        body={g.ack_state === 'acknowledged' ? 'The complainant has acknowledged the resolution.' : <Banner tone="warning">The complainant has not acknowledged the resolution yet ({ackLabel(g.ack_state)}).</Banner>}>
        <div className="mt-3"><Input aria-label="Closing note" placeholder="Closing note (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
      </ConfirmDialog>

      <ConfirmDialog open={mode === 'archive' || mode === 'request'} onClose={close} title={mode === 'archive' ? 'Archive this grievance?' : 'Request archive'}
        confirmLabel={mode === 'archive' ? 'Archive' : 'Send request'} danger loading={busy}
        onConfirm={async () => { if (await run(() => (mode === 'archive' ? api.archive(g.id, reason) : api.requestArchive(g.id, reason)), mode === 'archive' ? 'Archived' : 'Request sent to the Super Administrator')) close(); }}
        body={mode === 'archive' ? 'Archived grievances are hidden from officers, complainants and reports, but kept, and can be restored.' : 'A Super Administrator will review your request.'}>
        <div className="mt-3"><Field label="Reason" htmlFor="arr"><Input id="arr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
      </ConfirmDialog>

      <ConfirmDialog open={mode === 'delete'} onClose={close} title="Delete permanently?" confirmLabel="Delete forever" danger loading={busy}
        onConfirm={async () => { if (await run(() => api.hardDelete(g.id, confirmId), 'Deleted permanently')) nav('/grievances', { replace: true }); }}
        body={<Banner tone="danger" title="This cannot be undone">The grievance and its history are removed. Only a record of the deletion stays in the audit log.</Banner>}>
        <div className="mt-3"><Field label={`Type ${g.tracking_id} to confirm`} htmlFor="cid"><Input id="cid" className="font-mono" value={confirmId} onChange={(e) => setConfirmId(e.target.value.toUpperCase())} /></Field></div>
        {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
      </ConfirmDialog>

      <Modal open={mode === 'amend'} onClose={close} title="Correct the grievance text" wide
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 3 || amendText === g.description}
          onClick={async () => { if (await run(() => api.amendText(g.id, 'description', amendText, reason), 'Text corrected; the original is kept in the audit log')) close(); }}>Save correction</Button></>}>
        <Banner tone="info">The complainant's original words are kept in the audit log. Only correct typing errors or text the complainant asked you to change.</Banner>
        <div className="mt-4 space-y-3">
          <Textarea aria-label="Corrected text" value={amendText} onChange={(e) => setAmendText(e.target.value)} />
          <Field label="Reason for the correction" htmlFor="amr"><Input id="amr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {error && <Banner tone="warning">{error}</Banner>}
        </div>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- history, flags, sources */
function HistoryTimeline({ items, monthOnly }: { items: HistoryItem[]; monthOnly?: boolean }) {
  if (!items.length) return <p className="text-ink-500">No history yet.</p>;
  const icon = (i: HistoryItem) => i.kind === 'status' ? ArrowRightLeft : i.kind === 'comment' ? MessageSquare : i.kind === 'assignment' ? UserRound : i.kind === 'acknowledgement' ? CheckCircle2 : Wrench;
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
      {items.map((i, idx) => {
        const Icon = icon(i);
        return (
          <li key={idx} className="relative flex gap-3">
            <span className={cx('relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-surface',
              i.kind === 'status' ? 'bg-brand-100 text-brand-800' : i.kind === 'acknowledgement' ? 'bg-success-soft text-success' : 'bg-canvas text-ink-500')}><Icon className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[15px]">
                {i.kind === 'status' && <><b>{i.label}</b>{i.from_label && <span className="text-ink-500"> (from {i.from_label})</span>}</>}
                {i.kind === 'comment' && <><b>{i.label === 'officer_remark' ? 'Officer remark' : 'Remark'}</b>{i.public && <span className="ml-1.5 rounded bg-info-soft px-1.5 text-xs font-semibold text-info">sent to complainant</span>}</>}
                {i.kind === 'action' && <b className="capitalize">{(i.label ?? 'action').replace('_', ' ')}</b>}
                {i.kind === 'assignment' && <>Assigned to <b>{i.label ?? 'nobody'}</b></>}
                {i.kind === 'acknowledgement' && <b>{i.label === 'acknowledged' ? 'Complainant acknowledged the resolution' : 'Complainant did not accept the resolution'}</b>}
              </p>
              {i.body && <p className="mt-0.5 whitespace-pre-wrap text-[15px] text-ink-700">{i.body}</p>}
              <p className="mt-0.5 text-xs text-ink-500">{monthOnly && i.by_name == null ? formatDate(i.at, 'month') : formatDateTime(i.at)}{i.by_name && ` · ${i.by_name}`}{i.kind === 'status' && !i.public && ' · internal'}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const FLAG_LABEL: Record<string, string> = {
  duplicate_candidate: 'Possible duplicate', id_collision: 'Legacy ID shared with another person', date_suspect: 'Date needs checking',
  unmapped_value: 'Value could not be mapped', invalid_phone: 'Invalid phone number', community_unknown: 'Community unknown',
  needs_review: 'Needs review', archive_requested: 'Archive requested',
};

function FlagsCard({ g }: { g: StaffDetail }) {
  const { busy, error, run } = useAct(g);
  const [note, setNote] = useState<Record<number, string>>({});
  return (
    <Card className="p-5">
      <SectionTitle icon={<Flag className="h-5 w-5 text-warning" />}>Needs review</SectionTitle>
      <ul className="space-y-3">
        {g.flags.filter((f) => !f.resolved_at).map((f) => (
          <li key={f.id} className="rounded-xl bg-warning-soft/60 p-3">
            <p className="font-semibold text-warning">{FLAG_LABEL[f.flag] ?? f.flag}</p>
            {f.detail && <p className="mt-0.5 break-words text-sm text-ink-700">{Object.entries(f.detail).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</p>}
            {g.can.triage && (
              <div className="mt-2 flex gap-2">
                <Input aria-label="Resolution note" className="h-9 text-sm" placeholder="What did you decide?" value={note[f.id] ?? ''} onChange={(e) => setNote({ ...note, [f.id]: e.target.value })} />
                <Button size="sm" variant="secondary" loading={busy} disabled={!note[f.id]?.trim()} onClick={() => run(() => api.resolveFlag(f.id, note[f.id]), 'Marked as reviewed')}>Done</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="mt-3"><Banner tone="warning">{error}</Banner></div>}
    </Card>
  );
}

function SourceRecords({ g }: { g: StaffDetail }) {
  const [open, setOpen] = useState(false);
  const legacyEntries = Object.entries(g.legacy).filter(([k]) => !['workbook', 'sheet', 'row', 'year'].includes(k));
  return (
    <Card className="p-5">
      <SectionTitle icon={<FileSpreadsheet className="h-5 w-5 text-ink-500" />}>Original record</SectionTitle>
      <p className="text-sm text-ink-700">Imported from <b>{g.legacy.workbook}</b>, sheet <b>{g.legacy.sheet}</b>, row {g.legacy.row}. The values below are exactly what the spreadsheet said; the standardised values are shown above.</p>
      {legacyEntries.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {legacyEntries.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="shrink-0 capitalize text-ink-500">{k.replace(/_/g, ' ')}:</dt><dd className="font-medium">{String(v)}</dd></div>)}
        </dl>
      )}
      <button onClick={() => setOpen((o) => !o)} className="mt-3 text-sm font-semibold text-brand-700">{open ? 'Hide' : 'Show'} every original cell ({g.sources.length} source row{g.sources.length > 1 ? 's' : ''})</button>
      {open && g.sources.map((s, i) => (
        <div key={i} className="mt-3 overflow-x-auto rounded-xl bg-canvas p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{s.workbook} · {s.sheet} · row {s.row} · {s.role.replace('_', ' ')}{s.note && ` · ${s.note}`}</p>
          <table className="text-sm"><tbody>{Object.entries(s.raw).map(([k, v]) => <tr key={k}><th className="whitespace-nowrap pr-4 text-left align-top font-medium text-ink-500">{k}</th><td className="whitespace-pre-wrap">{v}</td></tr>)}</tbody></table>
        </div>
      ))}
    </Card>
  );
}

/* ---------------------------------------------------------------- bits */
function SectionTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink-900">{icon}{children}</h2>;
}
function Block({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mt-4"><p className="text-sm font-semibold text-ink-500">{label}</p><p className="mt-0.5 whitespace-pre-wrap">{children}</p></div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex gap-3"><dt className="w-28 shrink-0 text-ink-500">{label}</dt><dd className="min-w-0 flex-1 break-words">{children}</dd></div>;
}
export function ackLabel(s: string) {
  return ({ not_requested: 'not requested', pending: 'waiting for the complainant', acknowledged: 'acknowledged', disputed: 'disputed', not_captured: 'not recorded (historical)' } as Record<string, string>)[s] ?? s;
}
function originLabel(o: string) {
  return ({ app: 'Submitted in the app', assisted: 'Entered by staff (assisted)', paper: 'Paper form', legacy_import: 'Historical spreadsheet' } as Record<string, string>)[o] ?? o;
}
