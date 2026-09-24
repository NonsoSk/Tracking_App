import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { plural } from '@/lib/format';
import type { CommunityPeople, Scope, ScopePerson, TypeResponsibility, UserRow } from '@/lib/types';
import { Avatar, Banner, Button, ErrorState, InlineConfirm, Modal, NextStep, Pill, SearchInput, Skeleton, cx, useToast } from '@/design/ui';
import { Object3D, type ObjectKind } from '@/design/art';

const KEYS = [['responsibilities'], ['community-officers'], ['users'], ['staff-directory'], ['staff-list'], ['officer-home']];
const TYPE_ART: Record<string, ObjectKind> = { HOST: 'block', PIPELINE: 'sphere', INDIRECT: 'bubble', JETTY: 'box' };

/** Add / remove a person, with plain-language results and Undo. */
function useResponsibility() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));

  const add = async (person: { id: string; name: string }, scope: Scope, quiet = false) => {
    setBusy(true);
    try {
      const r = await api.addResponsibility(person.id, scope);
      if (!quiet) toast(`${person.name} is now in charge of ${r.label}` + (r.picked_up ? `, and took ${plural(r.picked_up, 'waiting grievance')}` : ''));
      await refresh();
      return true;
    } catch (e) { toast(toAppError(e).message, 'warning'); return false; }
    finally { setBusy(false); }
  };

  const remove = async (person: { id: string; name: string }, scope: Scope) => {
    setBusy(true);
    try {
      const r = await api.removeResponsibility(person.id, scope);
      const parts = [`${person.name} is no longer in charge of ${r.label}.`];
      if (r.handed_over) parts.push(`${plural(r.handed_over, 'open grievance')} handed to the others in charge.`);
      if (r.unassigned) parts.push(`${plural(r.unassigned, 'open grievance')} now wait for someone. Add a person.`);
      toast(parts.join(' '), r.unassigned ? 'warning' : 'success', { label: 'Undo', run: () => { void add(person, scope, true).then((ok) => ok && toast('Undone')); } });
      await refresh();
      return true;
    } catch (e) { toast(toAppError(e).message, 'warning'); return false; }
    finally { setBusy(false); }
  };
  return { busy, add, remove };
}

/* ---------------------------------------------------------------- by community type */
export function ResponsibilityBoard() {
  const q = useQuery({ queryKey: ['responsibilities'], queryFn: api.responsibilities });
  const act = useResponsibility();
  const [adding, setAdding] = useState<null | { scope: Scope; label: string; exclude: string[] }>(null);

  if (q.isLoading) return <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}</div>;
  if (q.isError) return <ErrorState message={toAppError(q.error).message} onRetry={() => q.refetch()} />;

  const people = (list: ScopePerson[], scope: Scope, label: string) => (
    <ul className="space-y-2">
      {list.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunken px-3 py-2.5">
          <Avatar name={p.name} size={36} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-bold">{p.name}</p>
            <p className="truncate text-xs text-ink-500">{[p.job_title, `${p.open_grievances} open assigned`].filter(Boolean).join(' · ')}</p>
          </div>
          <InlineConfirm label="Remove" question={`Remove ${p.name.split(' ')[0]} from ${label}?`} confirmLabel="Yes, remove" loading={act.busy}
            onConfirm={() => act.remove({ id: p.id, name: p.name }, scope)} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-[18px]">
      <NextStep>Put people in charge of a whole community type and they see every community in it. Several people can share one; new grievances go to whoever has the fewest open.</NextStep>
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data!.map((t: TypeResponsibility) => {
          const scope: Scope = { community_type: t.code };
          const label = `all ${t.name} communities`;
          const nobody = !t.officers.length && !t.clusters.some((c) => c.officers.length);
          return (
            <section key={t.id} className="flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card" aria-label={`${t.name} communities`}>
              <header className="flex items-start gap-3">
                <Object3D kind={TYPE_ART[t.code] ?? 'sphere'} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow text-brand-700">Community type</p>
                  <h2 className="text-xl font-extrabold leading-tight">{t.name}</h2>
                  <p className="text-sm text-ink-500 tabular">{plural(t.communities, 'community', 'communities')} · {t.open_grievances} open</p>
                </div>
                {t.unassigned > 0 && <Pill tone="red">{t.unassigned} waiting</Pill>}
              </header>

              <div>
                <p className="eyebrow mb-2 text-ink-500">In charge of every {t.name} community <span className="tabular">({t.officers.length})</span></p>
                {t.officers.length ? people(t.officers, scope, label)
                  : <p className={cx('rounded-2xl px-3 py-2.5 text-sm font-semibold', nobody ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink-500')}>
                      {nobody ? `Nobody is in charge. New ${t.name} grievances will wait unassigned.` : 'Nobody for the whole type; see the clusters below.'}
                    </p>}
                <Button size="sm" variant="secondary" icon={UserPlus} className="mt-3"
                  onClick={() => setAdding({ scope, label, exclude: t.officers.map((o) => o.id) })}>Add person to {t.name}</Button>
              </div>

              {t.has_clusters && t.clusters.length > 0 && (
                <details className="group rounded-2xl bg-sunken/60 p-3 open:pb-4">
                  <summary className="cursor-pointer list-none text-sm font-bold text-brand-700">
                    By cluster (optional) <span className="text-ink-500">· people for one cluster only</span>
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {t.clusters.map((c) => {
                      const cs: Scope = { cluster_id: c.id };
                      const cl = `${t.name} ${c.name}`;
                      return (
                        <li key={c.id} className="rounded-2xl bg-surface p-3 shadow-card">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="font-bold">{c.name} <span className="text-sm font-normal text-ink-500 tabular">· {plural(c.communities, 'community', 'communities')} · {c.open_grievances} open</span></p>
                            <Button size="sm" variant="ghost" icon={UserPlus} onClick={() => setAdding({ scope: cs, label: cl, exclude: c.officers.map((o) => o.id) })}>Add</Button>
                          </div>
                          {c.officers.length ? people(c.officers, cs, cl) : <p className="text-sm text-ink-500">{t.officers.length ? `Covered by the ${t.name} people above.` : 'Nobody yet.'}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>
      {adding && (
        <AddPersonDrawer title={`Add a person to ${adding.label}`} exclude={adding.exclude} busy={act.busy} onClose={() => setAdding(null)}
          note={`They will see and work grievances from ${adding.label}. Anyone already in charge stays in charge.`}
          onAdd={async (u) => { if (await act.add({ id: u.id, name: u.full_name }, adding.scope)) setAdding(null); }} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- pick a person */
function PersonPicker({ picked, onPick, exclude = [] }: { picked: UserRow | null; onPick: (u: UserRow) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const people = useQuery({ queryKey: ['users', 'all', q], queryFn: () => api.users({ kind: 'all', q }) });
  const list = (people.data ?? []).filter((u) => u.is_active && !exclude.includes(u.id)).slice(0, 30);
  return (
    <div className="space-y-3">
      <SearchInput placeholder="Search anyone by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {people.isLoading && <li className="py-3 text-center text-sm text-ink-500">Loading…</li>}
        {list.map((u) => {
          const on = picked?.id === u.id;
          return (
            <li key={u.id}>
              <button onClick={() => onPick(u)} aria-pressed={on}
                className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors', on ? 'bg-btn text-white shadow-halo' : 'hover:bg-sunken')}>
                <Avatar name={u.full_name} size={34} />
                <span className="min-w-0 flex-1"><span className="block font-bold">{u.full_name}</span>
                  <span className={cx('block truncate text-xs', on ? 'text-white/80' : 'text-ink-500')}>{[u.job_title ?? u.community, u.roles.includes('officer') ? 'Officer' : u.roles.includes('super_admin') ? 'Super Admin' : 'Not an officer yet'].filter(Boolean).join(' · ')}</span></span>
              </button>
            </li>
          );
        })}
        {!people.isLoading && !list.length && <li className="py-3 text-center text-sm text-ink-500">No one found. They need to have an account first.</li>}
      </ul>
    </div>
  );
}

function AddPersonDrawer({ title, note, exclude, busy, onClose, onAdd, extra, confirmLabel = 'Put in charge' }: {
  title: string; note: string; exclude: string[]; busy: boolean; onClose: () => void; onAdd: (u: UserRow) => void; extra?: ReactNode; confirmLabel?: string;
}) {
  const [picked, setPicked] = useState<UserRow | null>(null);
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!picked} onClick={() => picked && onAdd(picked)}>{confirmLabel}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-700">{note}</p>
        <PersonPicker picked={picked} onPick={setPicked} exclude={exclude} />
        {picked && !picked.roles.includes('officer') && <Banner tone="info">{picked.full_name} will be given the Officer role. They will use the officer workspace when they next sign in.</Banner>}
        {extra}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- one community */
export function CommunityPeopleDrawer({ community, current, onClose }: { community: { id: string; name: string }; current: CommunityPeople | undefined; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const act = useResponsibility();
  const [handover, setHandover] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = current?.officers ?? [];
  const scope: Scope = { community_id: community.id };
  const put = async (u: UserRow) => {
    setBusy(true);
    try {
      const r = await api.setCommunityOfficer(community.id, u.id, handover);
      toast(`${u.full_name} is now in charge of ${community.name}` + (r.reassigned ? ` and took over ${plural(r.reassigned, 'open grievance')}` : ''));
      await Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
      onClose();
    } catch (e) { toast(toAppError(e).message, 'warning'); }
    finally { setBusy(false); }
  };
  return (
    <AddPersonDrawer title={`People in charge of ${community.name}`} busy={busy || act.busy} onClose={onClose} onAdd={put}
      exclude={people.filter((p) => p.via === 'community').map((p) => p.id)}
      note="Add someone for this community only. Everyone below stays in charge too."
      extra={<>
        {(current?.open_grievances ?? 0) > 0 && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={handover} onChange={(e) => setHandover(e.target.checked)} />
            Also hand them the {current!.open_grievances} open grievance(s) from {community.name}</label>
        )}
        <div>
          <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-500"><Users className="h-3.5 w-3.5" aria-hidden />Now in charge ({people.length})</p>
          {!people.length && <p className="rounded-2xl bg-danger-soft px-3 py-2.5 text-sm font-semibold text-danger">Nobody. New grievances from {community.name} will wait unassigned.</p>}
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunken px-3 py-2">
                <Avatar name={p.name} size={32} />
                <div className="min-w-0 flex-1 leading-tight"><p className="truncate font-bold">{p.name}</p>
                  <p className="text-xs text-ink-500">{p.via === 'community' ? 'this community only' : `via ${p.via === 'cluster' ? p.group : `all ${p.group}`}`}</p></div>
                {p.via === 'community'
                  ? <InlineConfirm label="Remove" question="Remove?" confirmLabel="Yes, remove" loading={act.busy} onConfirm={() => act.remove({ id: p.id, name: p.name }, scope)} />
                  : <span className="text-xs text-ink-400">change on Community types</span>}
              </li>
            ))}
          </ul>
        </div>
      </>} />
  );
}
