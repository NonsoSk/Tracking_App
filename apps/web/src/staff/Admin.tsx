import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Printer, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useMasterData } from '@/app/hooks';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import type { Filters, UserRow } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { Avatar, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, InlineConfirm, Input, Modal, Pill, SearchInput, Select, Skeleton, StatusBadge, Tabs, cx } from '@/design/ui';
import { PageTitle, listHref } from './shell';
import { downloadCsv, downloadXlsx } from './export';
import { useSave } from './save';
import { CommunityPeopleDrawer, ResponsibilityBoard } from './Responsibility';


/* ---------------------------------------------------------------- Communities */
export function Communities() {
  const master = useMasterData();
  const all = useQuery({ queryKey: ['admin-communities'], queryFn: async () => {
    const [c, a] = await Promise.all([supabase.from('communities').select('*').order('name'), supabase.from('community_affiliations').select('*')]);
    if (c.error) throw c.error; if (a.error) throw a.error;
    return { communities: c.data as { id: string; name: string; short_code: string | null; active: boolean; notes: string | null }[], affiliations: a.data as { id: number; community_id: string; community_type_id: number; cluster_id: number | null; is_primary: boolean; active: boolean }[] };
  } });
  const officers = useQuery({ queryKey: ['community-officers'], queryFn: api.communityOfficers });
  const { busy, save } = useSave();
  const [edit, setEdit] = useState<null | { id?: string; name: string; short_code: string; notes: string; type: string; cluster: string }>(null);
  const [assign, setAssign] = useState<null | { id: string; name: string }>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'types' | 'communities'>('types');
  const d = master.data;
  const typeName = (id: number) => d?.community_types.find((t) => t.id === id)?.name;
  const clusterName = (id: number | null) => d?.clusters.find((c) => c.id === id)?.name;
  const keys = [['master'], ['admin-communities']];
  const pipelineCount = all.data?.affiliations.filter((a) => a.active && d?.community_types.find((t) => t.id === a.community_type_id)?.code === 'PIPELINE').length;

  const saveCommunity = async () => {
    if (!edit) return;
    const ok = await save(async () => {
      if (edit.id) return supabase.from('communities').update({ name: edit.name.trim(), short_code: edit.short_code || null, notes: edit.notes || null }).eq('id', edit.id);
      const ins = await supabase.from('communities').insert({ name: edit.name.trim(), short_code: edit.short_code.toUpperCase() || null, notes: edit.notes || null }).select().single();
      if (ins.error) return ins;
      return supabase.from('community_affiliations').insert({ community_id: ins.data.id, community_type_id: Number(edit.type), cluster_id: edit.cluster ? Number(edit.cluster) : null, is_primary: true });
    }, edit.id ? 'Community updated' : 'Community added', keys);
    if (ok) setEdit(null);
  };

  return (
    <div>
      <PageTitle title="Communities" subtitle="Who is in charge of each community type, and each community's classification."
        actions={<Tabs value={view} onChange={setView} items={[{ value: 'types', label: 'People in charge', count: d?.community_types.length }, { value: 'communities', label: 'Communities', count: all.data?.communities.length }]} />} />
      {view === 'types' ? <ResponsibilityBoard /> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-sm"><SearchInput placeholder="Search communities" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button icon={Plus} onClick={() => setEdit({ name: '', short_code: '', notes: '', type: String(d?.community_types[0]?.id ?? ''), cluster: '' })}>Add community</Button>
      </div>
      {pipelineCount !== undefined && pipelineCount < 32 && (
        <div className="mb-4"><Banner tone="info" title={`${pipelineCount} pipeline communities are listed; the structure document states 32.`}>Add the missing community here when its name is confirmed.</Banner></div>
      )}
      {all.isLoading ? <Skeleton className="h-96" /> : all.isError ? <ErrorState message={toAppError(all.error).message} /> : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken/70 text-left text-xs font-semibold uppercase tracking-wide text-ink-500"><tr><th className="px-4 py-3">Community</th><th className="px-4 py-3">Classification</th><th className="px-4 py-3">People in charge</th><th className="px-4 py-3">Code prefix</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-line/70">
              {all.data!.communities.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).map((c) => {
                const affs = all.data!.affiliations.filter((a) => a.community_id === c.id && a.active);
                return (
                  <tr key={c.id} className={cx(!c.active && 'opacity-60')}>
                    <td className="px-4 py-3 font-semibold">{c.name}{c.notes && <p className="text-xs font-normal text-ink-500">{c.notes}</p>}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">{affs.map((a) => (
                        <span key={a.id} className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', a.is_primary ? 'bg-brand-100 text-brand-800' : 'bg-sunken text-ink-700')}>
                          {typeName(a.community_type_id)}{a.cluster_id ? ` · ${clusterName(a.cluster_id)}` : ''}{affs.length > 1 && a.is_primary ? ' (default)' : ''}
                        </span>))}</div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const o = officers.data?.find((x) => x.community_id === c.id);
                        const ppl = o?.officers ?? [];
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {!ppl.length && <Pill tone="red">Nobody</Pill>}
                            {ppl.slice(0, 3).map((p) => (
                              <Pill key={p.id} tone={p.via === 'community' ? 'brand' : 'neutral'}>
                                {p.name}<span className="font-normal opacity-75">· {p.via === 'community' ? 'this community' : p.via === 'cluster' ? p.group : `all ${p.group}`}</span>
                              </Pill>
                            ))}
                            {ppl.length > 3 && <Pill>+{ppl.length - 3} more</Pill>}
                            <Button size="sm" variant="ghost" icon={UserPlus} onClick={() => setAssign({ id: c.id, name: c.name })}>Add person</Button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{c.short_code}</td>
                    <td className="px-4 py-3">{c.active ? <StatusBadge label="Active" tone="success" size="sm" /> : <StatusBadge label="Inactive" tone="muted" size="sm" />}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name, short_code: c.short_code ?? '', notes: c.notes ?? '', type: '', cluster: '' })}>Edit</Button>
                      {c.active
                        ? <InlineConfirm label="Deactivate" question="Stop new grievances here?" confirmLabel="Yes, deactivate" loading={busy}
                            onConfirm={() => save(() => supabase.from('communities').update({ active: false }).eq('id', c.id), `${c.name} deactivated`, keys,
                              () => supabase.from('communities').update({ active: true }).eq('id', c.id))} />
                        : <Button size="sm" variant="ghost" loading={busy} onClick={() => save(() => supabase.from('communities').update({ active: true }).eq('id', c.id), 'Activated', keys)}>Activate</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      </>}
      {assign && <CommunityPeopleDrawer community={assign} current={officers.data?.find((x) => x.community_id === assign.id)} onClose={() => setAssign(null)} />}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit community' : 'Add community'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={!edit?.name.trim() || (!edit?.id && !edit?.type)} onClick={saveCommunity}>Save</Button></>}>
        {edit && d && (
          <div className="space-y-4">
            <Field label="Name" htmlFor="cname"><Input id="cname" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Code prefix" htmlFor="ccode" hint="2–5 capital letters/digits, used in submission codes (e.g. AGB)."><Input id="ccode" className="font-mono uppercase" maxLength={5} value={edit.short_code} onChange={(e) => setEdit({ ...edit, short_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>
            {!edit.id && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Community type" htmlFor="ctype"><Select id="ctype" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value, cluster: '' })}>{d.community_types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                {d.community_types.find((t) => String(t.id) === edit.type)?.has_clusters && (
                  <Field label="Cluster" htmlFor="ccl"><Select id="ccl" value={edit.cluster} onChange={(e) => setEdit({ ...edit, cluster: e.target.value })}><option value="" disabled>Choose…</option>{d.clusters.filter((c) => String(c.community_type_id) === edit.type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                )}
              </div>
            )}
            <Field label="Notes" htmlFor="cnotes" optional><Input id="cnotes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Put anyone in charge of one community (they get the Officer role if they don't have it). */
/* ---------------------------------------------------------------- Categories, statuses, severities, holidays */
export function Categories() {
  const [tab, setTab] = useState<'categories' | 'statuses' | 'severities' | 'holidays'>('categories');
  const master = useMasterData();
  const { busy, save } = useSave();
  const holidays = useQuery({ queryKey: ['holidays'], queryFn: async () => { const r = await supabase.from('holidays').select('*').order('day'); if (r.error) throw r.error; return r.data as { day: string; name: string }[]; } });
  const [newSub, setNewSub] = useState<{ category_id: number; name: string } | null>(null);
  const [newCat, setNewCat] = useState<{ name: string; public_label: string } | null>(null);
  const [hol, setHol] = useState({ day: '', name: '' });
  const [catSel, setCatSel] = useState<number | null>(null);
  const d = master.data;
  return (
    <div>
      <PageTitle title="Categories & statuses" subtitle="The values staff and community members choose from. Changes apply immediately."
        actions={<Tabs value={tab} onChange={setTab} items={[{ value: 'categories', label: 'Categories', count: d?.categories.length }, { value: 'statuses', label: 'Statuses', count: d?.statuses.length }, { value: 'severities', label: 'Severity' }, { value: 'holidays', label: 'Holidays', count: holidays.data?.length }]} />} />
      <div>
        {tab === 'categories' && d && (() => {
          const sel = d.categories.find((c) => c.id === catSel) ?? d.categories[0];
          const subs = (id: number) => d.subcategories.filter((x) => x.category_id === id);
          return (
            <div className="flex flex-col gap-4 lg:flex-row">
              {/* Master: a list on desktop, a horizontal scroller on phones */}
              <div className="lg:w-80 lg:shrink-0">
                <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0" aria-label="Categories">
                  {d.categories.map((c) => {
                    const on = c.id === sel?.id;
                    return (
                      <li key={c.id} className="shrink-0">
                        <button onClick={() => setCatSel(c.id)} aria-current={on || undefined}
                          className={cx('flex w-full items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-left text-sm font-bold transition-colors lg:whitespace-normal lg:rounded-2xl',
                            on ? 'bg-btn text-white shadow-halo' : 'bg-surface text-ink-700 shadow-card hover:text-brand-700')}>
                          <span className="flex-1">{c.name}</span>
                          <span className={cx('rounded-full px-1.5 text-xs tabular', on ? 'bg-white/20' : 'bg-sunken')}>{subs(c.id).length}</span>
                        </button>
                      </li>
                    );
                  })}
                  <li className="shrink-0"><Button variant="ghost" icon={Plus} onClick={() => setNewCat({ name: '', public_label: '' })}>Add category</Button></li>
                </ul>
              </div>
              {/* Detail */}
              {sel && (
                <Card className="min-w-0 flex-1 p-5 animate-fade-up" key={sel.id}>
                  <p className="eyebrow text-brand-700">Category</p>
                  <h2 className="text-xl font-extrabold">{sel.name}</h2>
                  <p className="mt-1 text-sm text-ink-500">Community members see: “{sel.public_label}”</p>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <h3 className="font-extrabold">Sub-categories <span className="text-ink-400 tabular">{subs(sel.id).length}</span></h3>
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setNewSub({ category_id: sel.id, name: '' })}>Sub-category</Button>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {subs(sel.id).map((x) => <li key={x.id}><Pill className="!whitespace-normal">{x.name}</Pill></li>)}
                  </ul>
                </Card>
              )}
            </div>
          );
        })()}
        {tab === 'statuses' && d && (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-sunken/70 text-left text-xs font-semibold uppercase text-ink-500"><tr><th className="px-4 py-3">Staff label</th><th className="px-4 py-3">Complainant sees</th><th className="px-4 py-3">Counts as open</th></tr></thead>
              <tbody className="divide-y divide-line/70">{d.statuses.map((s) => (
                <tr key={s.id}><td className="px-4 py-3"><StatusBadge label={s.staff_label} tone={s.tone} size="sm" /></td><td className="px-4 py-3"><b>{s.public_label}</b><p className="text-ink-500">{s.public_message}</p></td><td className="px-4 py-3">{s.is_open ? 'Yes' : 'No'}</td></tr>
              ))}</tbody>
            </table>
            <p className="border-t border-line px-4 py-3 text-xs text-ink-500">Allowed moves between statuses are configured in the database table <code>grievance_status_transitions</code>.</p>
          </Card>
        )}
        {tab === 'severities' && d && <Card className="p-5"><ul className="space-y-2">{d.severities.map((s) => <li key={s.id} className="flex items-center gap-3"><StatusBadge label={s.name} tone={s.tone} size="sm" /></li>)}</ul></Card>}
        {tab === 'holidays' && (
          <Card className="p-5">
            <p className="mb-4 flex items-start gap-2 text-sm text-ink-700"><CalendarDays className="h-5 w-5 shrink-0 text-brand-700" />Public holidays are skipped by the 3-working-day overdue clock. Adding one recalculates open deadlines.</p>
            <div className="mb-4 flex flex-wrap gap-2">
              <Input type="date" className="h-10 !w-auto" aria-label="Date" value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} />
              <Input className="h-10 w-64" aria-label="Holiday name" placeholder="e.g. Independence Day" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />
              <Button loading={busy} disabled={!hol.day || !hol.name} onClick={async () => { if (await save(() => supabase.from('holidays').insert(hol), 'Holiday added', [['holidays']])) setHol({ day: '', name: '' }); }}>Add</Button>
            </div>
            <ul className="divide-y divide-line/70">{holidays.data?.map((h) => (
              <li key={h.day} className="flex items-center justify-between py-2"><span><b>{formatDate(h.day)}</b> · {h.name}</span>
                <InlineConfirm label="Remove" question="Remove this holiday?" confirmLabel="Yes, remove" loading={busy} onConfirm={() => save(() => supabase.from('holidays').delete().eq('day', h.day), 'Holiday removed', [['holidays']], () => supabase.from('holidays').insert(h))} /></li>
            ))}</ul>
          </Card>
        )}
      </div>
      <Modal open={!!newSub} onClose={() => setNewSub(null)} title="New sub-category"
        footer={<Button loading={busy} disabled={!newSub?.name.trim()} onClick={async () => { if (newSub && await save(() => supabase.from('grievance_subcategories').insert({ category_id: newSub.category_id, name: newSub.name.trim() }), 'Sub-category added')) setNewSub(null); }}>Add</Button>}>
        <Field label="Name" htmlFor="sn"><Input id="sn" value={newSub?.name ?? ''} onChange={(e) => newSub && setNewSub({ ...newSub, name: e.target.value })} /></Field>
      </Modal>
      <Modal open={!!newCat} onClose={() => setNewCat(null)} title="New category"
        footer={<Button loading={busy} disabled={!newCat?.name.trim() || !newCat?.public_label.trim()} onClick={async () => { if (newCat && await save(() => supabase.from('grievance_categories').insert({ ...newCat, sort_order: 50 }), 'Category added')) setNewCat(null); }}>Add</Button>}>
        <div className="space-y-4">
          <Field label="Official name (reports)" htmlFor="cn2"><Input id="cn2" value={newCat?.name ?? ''} onChange={(e) => newCat && setNewCat({ ...newCat, name: e.target.value })} /></Field>
          <Field label="Plain label (community members)" htmlFor="cl2" hint="Short and simple, e.g. “Roads, water & light”."><Input id="cl2" value={newCat?.public_label ?? ''} onChange={(e) => newCat && setNewCat({ ...newCat, public_label: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- Users & officers */
const ROLES: [string, string][] = [['super_admin', 'Super Administrator'], ['officer', 'Officer in Charge'], ['supervisor', 'Supervisor'], ['cr_staff', 'Community Relations Staff'], ['data_entry', 'Data Entry Officer'], ['viewer', 'Viewer'], ['community_member', 'Community Member']];

const titleCase = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ') : '');

export function Users() {
  const [kind, setKind] = useState<'staff' | 'members'>('staff');
  const [q, setQ] = useState('');
  const users = useQuery({ queryKey: ['users', kind, q], queryFn: () => api.users({ kind, q }) });
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageTitle title="Users & officers" subtitle="Roles decide what someone can do; responsibility decides which grievances an officer sees."
        actions={<Button icon={UserPlus} onClick={() => setCreating(true)}>Add staff member</Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={kind} onChange={setKind} items={[{ value: 'staff', label: 'Staff', count: kind === 'staff' ? users.data?.length : undefined }, { value: 'members', label: 'Community members', count: kind === 'members' ? users.data?.length : undefined }]} />
        <div className="flex-1 sm:max-w-sm"><SearchInput placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {users.isLoading ? <Skeleton className="h-64" /> : users.isError ? <ErrorState message={toAppError(users.error).message} /> : (
        users.data!.length === 0 ? <EmptyState icon={UserPlus} title="No one found" body="Try another name or phone number." /> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {users.data!.map((u) => {
              const resp = u.scopes.map((s) => s.community ?? s.cluster ?? titleCase(s.community_type)).filter(Boolean).join(', ');
              return (
                <li key={u.id} className={cx('flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card', !u.is_active && 'opacity-60')}>
                  <div className="flex items-start gap-3">
                    <Avatar name={u.full_name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-extrabold">{u.full_name}</p>
                      <p className="truncate text-sm text-ink-500">{[u.job_title ?? u.community, u.email?.endsWith('iplgrievance.app') ? formatPhone(u.phone) : u.email ?? formatPhone(u.phone)].filter(Boolean).join(' · ')}</p>
                    </div>
                    {u.is_active ? <StatusBadge label="Active" tone="success" size="sm" /> : <StatusBadge label="Disabled" tone="muted" size="sm" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((r) => <Pill key={r} tone={r === 'super_admin' ? 'gold' : r === 'officer' ? 'brand' : 'neutral'}>{ROLES.find(([k]) => k === r)?.[1] ?? r}</Pill>)}
                  </div>
                  {u.roles.includes('officer') && (
                    <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
                      <p className="eyebrow text-brand-700">In charge of</p>
                      <p className="font-semibold text-ink-900">{resp || 'Nothing yet. Open Manage to give them communities.'}</p>
                    </div>
                  )}
                  <div className="mt-auto flex justify-end"><Button size="sm" variant="secondary" onClick={() => setEdit(u)}>Manage</Button></div>
                </li>
              );
            })}
          </ul>
        )
      )}
      {edit && <ManageUser user={edit} onClose={() => setEdit(null)} />}
      <CreateStaff open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ManageUser({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const master = useMasterData();
  const { userId } = useAuth();
  const { busy, save } = useSave();
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [scopes, setScopes] = useState<string[]>(user.scopes.map((s) => s.community_id ? `c:${s.community_id}` : s.cluster_id ? `k:${s.cluster_id}` : `t:${s.community_type}`));
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const keys = [['users'], ['staff-directory']];
  const isMember = user.roles.length === 1 && user.roles[0] === 'community_member';
  const d = master.data;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const scopePayload = scopes.map((s) => s.startsWith('c:') ? { community_id: s.slice(2) } : s.startsWith('k:') ? { cluster_id: Number(s.slice(2)) } : { community_type: s.slice(2) });
  return (
    <Modal open onClose={onClose} title={user.full_name} wide
      footer={<>
        {user.id !== userId && <Button variant={user.is_active ? 'danger' : 'secondary'} onClick={() => (user.is_active ? setConfirmDisable(true) : save(() => api.setActive(user.id, true), 'Account enabled', keys).then((ok) => ok && onClose()))}>{user.is_active ? 'Disable account' : 'Enable account'}</Button>}
        <Button loading={busy} onClick={async () => {
          const ok = await save(async () => { await api.setRoles(user.id, roles); if (roles.includes('officer')) await api.setScopes(user.id, scopePayload); }, 'Saved', keys);
          if (ok) onClose();
        }}>Save changes</Button>
      </>}>
      <div className="space-y-6">
        {isMember && (
          <section className="rounded-2xl bg-sunken p-4">
            <h3 className="font-semibold">Forgotten PIN</h3>
            <p className="mt-1 text-sm text-ink-700">Only reset a PIN after confirming the person's identity (in person or by calling their registered number {formatPhone(user.phone)}).</p>
            {pin ? <p className="mt-3 text-sm">Temporary PIN: <span className="rounded-lg bg-surface px-2 py-1 font-mono text-lg font-bold tracking-widest ring-1 ring-line">{pin}</span> · give it to the member; it is not shown again.</p>
              : <Button className="mt-3" size="sm" variant="secondary" loading={busy} onClick={() => save(async () => setPin((await api.resetMemberPin(user.id)).pin), 'PIN reset', keys)}>Reset PIN</Button>}
          </section>
        )}
        <section>
          <h3 className="mb-2 font-semibold">Roles</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 rounded-xl p-2 ring-1 ring-line"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={roles.includes(k)} onChange={() => setRoles(toggle(roles, k))} />{l}</label>
            ))}
          </div>
        </section>
        {roles.includes('officer') && d && (
          <section>
            <h3 className="font-semibold">Responsibility</h3>
            <p className="mb-2 text-sm text-ink-500">The officer sees and is auto-assigned grievances from these groups. The most specific match wins.</p>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">{d.community_types.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-xl px-3 py-2 ring-1 ring-line"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={scopes.includes(`t:${t.code}`)} onChange={() => setScopes(toggle(scopes, `t:${t.code}`))} />All {t.name}</label>
              ))}</div>
              <div className="flex flex-wrap gap-2">{d.clusters.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ring-line"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={scopes.includes(`k:${c.id}`)} onChange={() => setScopes(toggle(scopes, `k:${c.id}`))} />Pipeline {c.name}</label>
              ))}</div>
              <Select aria-label="Add a single community" value="" onChange={(e) => e.target.value && setScopes([...scopes, `c:${e.target.value}`])}>
                <option value="">Add a single community…</option>{d.communities.filter((c) => !scopes.includes(`c:${c.id}`)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <div className="flex flex-wrap gap-1.5">{scopes.filter((s) => s.startsWith('c:')).map((s) => (
                <button key={s} onClick={() => setScopes(scopes.filter((x) => x !== s))} className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-800">{d.communities.find((c) => `c:${c.id}` === s)?.name} ✕</button>
              ))}</div>
            </div>
          </section>
        )}
      </div>
      <ConfirmDialog open={confirmDisable} onClose={() => setConfirmDisable(false)} title={`Disable ${user.full_name}?`} confirmLabel="Disable" danger loading={busy}
        onConfirm={async () => { if (await save(() => api.setActive(user.id, false), 'Account disabled', keys)) { setConfirmDisable(false); onClose(); } }}
        body="They will no longer be able to use the app. Their past work stays in the records and can be reassigned." />
    </Modal>
  );
}

function CreateStaff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { busy, save } = useSave();
  const [f, setF] = useState({ full_name: '', email: '', job_title: '', role: 'officer', password: '' });
  return (
    <Modal open={open} onClose={onClose} title="Add a staff member"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.full_name || !f.email.includes('@') || f.password.length < 10}
        onClick={async () => { if (await save(() => api.createStaffUser({ ...f, roles: [f.role] }), 'Staff account created. Share the temporary password securely.', [['users'], ['staff-directory']])) { setF({ full_name: '', email: '', job_title: '', role: 'officer', password: '' }); onClose(); } }}>Create account</Button></>}>
      <div className="space-y-4">
        <Field label="Full name" htmlFor="sfn"><Input id="sfn" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Work email" htmlFor="sfe"><Input id="sfe" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Job title" htmlFor="sfj" optional><Input id="sfj" value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} /></Field>
        <Field label="Role" htmlFor="sfr"><Select id="sfr" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.filter(([k]) => k !== 'community_member').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Temporary password" htmlFor="sfp" hint="At least 10 characters. Ask them to change it after first sign-in."><Input id="sfp" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {f.role === 'officer' && <p className="text-sm text-ink-500">After creating the account, use “Manage” here, or <b>Communities → Change</b>, to set which communities they are responsible for.</p>}
        <p className="rounded-xl bg-sunken p-3 text-sm text-ink-700"><b>Other way:</b> ask the person to create an account in the app themselves. Then find them under <b>Community members</b>, click <b>Manage</b> and give them a role, or put them in charge of a community on the <b>Communities</b> page.</p>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Import & review queue */
export function ImportPage() {
  const batches = useQuery({ queryKey: ['import-batches'], queryFn: async () => { const r = await supabase.from('import_batches').select('*').order('created_at', { ascending: false }); if (r.error) throw r.error; return r.data as { id: string; file_name: string; workbook: string; status: string; counts: Record<string, number>; imported_at: string | null }[]; } });
  const flagged = useQuery({ queryKey: ['staff-list', { flagged: true, open: undefined }], queryFn: () => api.staffList({ flagged: true }, 1, 1) });
  return (
    <div>
      <PageTitle title="Historical data" subtitle="Every original spreadsheet row is kept exactly as it was, linked to its standardised grievance." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Import batches</h2>
          {batches.isLoading ? <Skeleton className="mt-3 h-24" /> : !batches.data?.length ? <p className="mt-3 text-ink-500">Nothing imported yet.</p> : (
            <ul className="mt-3 space-y-3">{batches.data.map((b) => (
              <li key={b.id} className="rounded-xl bg-sunken p-3">
                <div className="flex items-center justify-between gap-2"><p className="font-semibold">{b.workbook}</p><StatusBadge label={b.status} tone={b.status === 'imported' ? 'success' : 'muted'} size="sm" /></div>
                <p className="text-xs text-ink-500">{b.file_name} · {formatDateTime(b.imported_at)}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-5">
                  {[['Rows', b.counts.total], ['Imported', b.counts.imported], ['Linked copies', b.counts.linked_copies], ['Duplicates removed', b.counts.excluded], ['Flags', b.counts.flags]].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-surface p-2"><dd className="text-lg font-bold tabular">{v ?? 0}</dd><dt className="text-[11px] text-ink-500">{l}</dt></div>
                  ))}
                </dl>
              </li>
            ))}</ul>
          )}
          <div className="mt-4 rounded-xl bg-info-soft p-3 text-sm text-ink-700">
            <p className="font-semibold text-info">How to import</p>
            <p className="mt-1">Run <code>scripts/migration/import_workbooks.py</code> for a dry run and review report, then apply it. Each file can only be imported once, and a batch can be rolled back as a whole.</p>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Review queue</h2>
          <p className="mt-1 text-sm text-ink-500">Imported records with something to check: possible duplicates, invalid phone numbers, unknown communities, shared legacy IDs and old open items.</p>
          <p className="mt-4 text-4xl font-bold tabular">{flagged.data?.total ?? '…'}</p>
          <p className="text-sm text-ink-500">grievances need review</p>
          <Link to={listHref({ flagged: true })}><Button className="mt-4">Open review queue</Button></Link>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Audit log */
export function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit', page, action], queryFn: () => api.audit(action ? { action } : {}, page) });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / 50)) : 1;
  return (
    <div>
      <PageTitle title="Audit log" subtitle="Every important action, who did it and when. Entries can't be edited or deleted." />
      <div className="mb-3 max-w-sm"><SearchInput placeholder="Filter by action, e.g. status, resolved, code" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></div>
      {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? <ErrorState message={toAppError(q.error).message} /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunken/70 text-left text-xs font-semibold uppercase text-ink-500"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Change</th></tr></thead>
            <tbody className="divide-y divide-line/70">{q.data!.rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{formatDateTime(r.at)}</td>
                <td className="px-4 py-2.5">{r.actor ?? 'System'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2.5 text-xs">{r.entity === 'grievances' && r.entity_id ? <Link className="font-semibold text-brand-700" to={`/grievances/${r.entity_id}`}>grievance</Link> : r.entity}</td>
                <td className="max-w-md px-4 py-2.5 text-xs text-ink-700"><Diff old={r.old} next={r.new} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      <div className="mt-4 flex items-center justify-between"><p className="text-sm text-ink-500">{q.data?.total.toLocaleString()} entries · page {page} of {pages}</p>
        <div className="flex gap-2"><Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="secondary" iconRight={ChevronRight} disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button></div></div>
    </div>
  );
}

function Diff({ old, next }: { old: unknown; next: unknown }) {
  const o = (old ?? {}) as Record<string, unknown>; const n = (next ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !['search_tsv'].includes(k)).slice(0, 6);
  if (!keys.length) return null;
  const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80);
  return <ul className="space-y-0.5">{keys.map((k) => <li key={k} className="break-words"><b>{k}</b>: {k in o && <span className="text-danger line-through">{show(o[k])}</span>} {k in n && <span className="text-success">{show(n[k])}</span>}</li>)}</ul>;
}

/* ---------------------------------------------------------------- Settings */
const SETTING_UI: Record<string, { label: string; type: 'number' | 'bool' | 'select' | 'text'; options?: [string, string][] }> = {
  sla_threshold_days: { label: 'Overdue after (days)', type: 'number' },
  sla_clock: { label: 'Count days as', type: 'select', options: [['working_days', 'Working days (Mon–Fri, minus holidays)'], ['calendar_days', 'Calendar days']] },
  sla_due_soon_hours: { label: '“Due soon” window (hours)', type: 'number' },
  overdue_realert_hours: { label: 'Re-alert officers every (hours)', type: 'number' },
  code_offline_grace_hours: { label: 'Offline grace period for codes (hours)', type: 'number' },
  whatsapp_enabled: { label: 'Send WhatsApp notifications', type: 'bool' },
  whatsapp_resolution_template: { label: 'WhatsApp resolution template name', type: 'text' },
  app_name: { label: 'App name', type: 'text' },
};

export function SettingsPage() {
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { busy, save } = useSave();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  return (
    <div className="max-w-3xl">
      <PageTitle title="Settings" />
      {q.isLoading ? <Skeleton className="h-96" /> : (
        <Card className="divide-y divide-line">
          {q.data?.filter((s) => SETTING_UI[s.key]).map((s) => {
            const ui = SETTING_UI[s.key];
            const v = s.key in draft ? draft[s.key] : s.value;
            const changed = s.key in draft && JSON.stringify(draft[s.key]) !== JSON.stringify(s.value);
            return (
              <div key={s.key} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                <div className="flex-1"><p className="font-semibold">{ui.label}</p><p className="text-sm text-ink-500">{s.description}</p></div>
                <div className="flex items-center gap-2">
                  {ui.type === 'number' && <Input type="number" className="h-10 w-24" value={String(v ?? '')} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value === '' ? null : Number(e.target.value) })} />}
                  {ui.type === 'text' && <Input className="h-10 w-56" value={String(v ?? '')} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />}
                  {ui.type === 'select' && <Select className="h-10 w-72" value={String(v)} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}>{ui.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
                  {ui.type === 'bool' && <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-brand-700" checked={v === true} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })} />{v === true ? 'On' : 'Off'}</label>}
                  {changed && <Button size="sm" loading={busy} onClick={async () => { if (await save(() => api.updateSetting(s.key, draft[s.key]), 'Setting saved', [['settings'], ['master']])) setDraft(({ [s.key]: _, ...rest }) => rest); }}>Save</Button>}
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <Card className="mt-5 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand-700" />WhatsApp (Meta Cloud API)</h2>
        <p className="mt-1 text-sm text-ink-700">Messages are sent by the <code>notify-dispatch</code> server function. Its access token and phone-number ID are stored as server secrets, never in the app. Messages count as delivered only when Meta confirms delivery.</p>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- Reports */
const REPORTS = [
  { id: 'annual', label: 'Annual grievance report', key: 'by_year', head: ['Year', 'Grievances', 'Still open'] },
  { id: 'monthly', label: 'Monthly grievance report', key: 'by_month', head: ['Month', 'Received', 'Resolved'] },
  { id: 'community', label: 'Community grievance report', key: 'by_community', head: ['Community', 'Grievances', 'Open'] },
  { id: 'type', label: 'Community type report', key: 'by_type', head: ['Community type', 'Grievances', 'Open'] },
  { id: 'cluster', label: 'Pipeline cluster report', key: 'by_cluster', head: ['Cluster', 'Grievances', 'Open'] },
  { id: 'category', label: 'Category report', key: 'by_category', head: ['Category', 'Grievances', 'Open'] },
  { id: 'resolution', label: 'Resolution report', key: 'by_status', head: ['Status', 'Grievances'] },
  { id: 'officer', label: 'Officer workload report', key: 'officer_workload', head: ['Officer', 'Open', 'Overdue', 'Resolved/closed'] },
  { id: 'outstanding', label: 'Outstanding grievance report', list: { open: true } as Filters },
  { id: 'overdue', label: 'Overdue grievance report', list: { overdue: true } as Filters },
] as const;

export function Reports() {
  const { can } = useAuth();
  const [id, setId] = useState<(typeof REPORTS)[number]['id']>('annual');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const r = REPORTS.find((x) => x.id === id)!;
  const filters: Filters = { ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) };
  const stats = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api.dashboard(filters), enabled: !('list' in r) });
  const list = useQuery({ queryKey: ['report-list', id, filters], queryFn: () => api.exportRows({ ...filters, ...('list' in r ? r.list : {}) }), enabled: 'list' in r && can('export.run') });
  const rows: (string | number)[][] = useMemo(() => {
    if ('list' in r) return (list.data ?? []).map((x) => [String(x['Tracking ID']), String(x['Community'] ?? ''), String(x['Category'] ?? ''), String(x['Status']), String(x['Officer'] ?? ''), Number(x['Days Outstanding'] ?? 0)]);
    const data = stats.data?.[r.key as 'by_year'] ?? [];
    if (r.id === 'monthly') return data.map((d) => [String(d.key), d.received ?? 0, d.resolved ?? 0]);
    if (r.id === 'officer') return data.map((d) => [String(d.key), d.open ?? 0, d.overdue ?? 0, d.resolved ?? 0]);
    if (r.id === 'resolution') return data.map((d) => [String(d.key), d.total ?? 0]);
    return data.map((d) => [String(d.key), d.total ?? 0, d.open ?? 0]);
  }, [r, stats.data, list.data]);
  const head = 'list' in r ? ['Tracking ID', 'Community', 'Category', 'Status', 'Officer', 'Days outstanding'] : [...r.head];
  const asObjects = rows.map((row) => Object.fromEntries(head.map((h, i) => [h, row[i]])));
  const name = `${r.label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  const k = stats.data?.kpis;

  return (
    <div>
      <PageTitle title="Reports" subtitle="Choose a report and a period. Export to Excel or CSV, or print / save as PDF."
        actions={<>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
          {can('export.run') && <><Button variant="secondary" icon={Download} onClick={() => downloadXlsx(asObjects, `${name}.xlsx`, 'Report')}>Excel</Button>
          <Button variant="secondary" icon={Download} onClick={() => downloadCsv(asObjects, `${name}.csv`)}>CSV</Button></>}
        </>} />
      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end no-print">
        <Field label="Report" htmlFor="rep"><Select id="rep" value={id} onChange={(e) => setId(e.target.value as typeof id)}>{REPORTS.filter((x) => !('list' in x) || can('export.run')).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <Field label="From" htmlFor="rf"><Input id="rf" type="date" className="h-11" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="rt"><Input id="rt" type="date" className="h-11" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </Card>
      <Card className="p-6">
        <div className="mb-4 border-b border-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Indorama Eleme Petrochemicals · Community Relations</p>
          <h2 className="mt-1 text-xl font-bold">{r.label}</h2>
          <p className="text-sm text-ink-500">{from || to ? `Grievances received ${from ? `from ${formatDate(from)}` : ''} ${to ? `to ${formatDate(to)}` : ''}` : 'All grievances since 2018'} · generated {formatDateTime(new Date())}</p>
          {k && !('list' in r) && <p className="mt-2 text-sm">Total <b>{k.total}</b> · open <b>{k.open}</b> · overdue <b>{k.overdue}</b> · resolution rate <b>{k.resolution_rate ?? '—'}%</b></p>}
        </div>
        {(stats.isLoading || list.isLoading) ? <Skeleton className="h-64" /> : (
          <table className="w-full text-sm">
            <thead><tr>{head.map((h, i) => <th key={h} className={cx('border-b border-line pb-2 font-semibold text-ink-500', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={cx('border-b border-line/60 py-2', j ? 'text-right tabular' : 'font-medium')}>{c}</td>)}</tr>)}</tbody>
          </table>
        )}
        {!rows.length && !stats.isLoading && !list.isLoading && <p className="py-6 text-center text-ink-500">No grievances in this period.</p>}
      </Card>
    </div>
  );
}
