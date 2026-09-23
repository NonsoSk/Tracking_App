-- =============================================================================
-- Master data: community types, clusters, communities (+ affiliations and
-- aliases), grievance categories/sub-categories, statuses, severities,
-- holidays. Everything here is editable by `masterdata.manage`; nothing about
-- a specific community or category is hard-coded in application logic.
--
-- Sources: "Host Communities in Indorama.docx", "Pipeline Communities
-- Structure.pdf", "Jetty Communities Structure.pdf", the brief (indirectly
-- impacted list) and the LOOKUP sheet of "Indorama_Grievance Tracker_2026.1".
-- =============================================================================

create table public.community_types (
  id           smallint generated always as identity primary key,
  code         text not null unique,
  name         text not null unique,
  has_clusters boolean not null default false,
  sort_order   smallint not null default 0,
  active       boolean not null default true
);

create table public.clusters (
  id                smallint generated always as identity primary key,
  community_type_id smallint not null references public.community_types(id),
  name              text not null,
  sort_order        smallint not null default 0,
  active            boolean not null default true,
  unique (community_type_id, name)
);

create table public.communities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 0),
  short_code text unique check (short_code ~ '^[A-Z0-9]{2,5}$'),  -- used in submission codes
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A community can belong to more than one type (Akpajo is Host AND Pipeline
-- Cluster 1). Exactly one affiliation is primary; grievances default to it.
create table public.community_affiliations (
  id                smallint generated always as identity primary key,
  community_id      uuid not null references public.communities(id) on delete cascade,
  community_type_id smallint not null references public.community_types(id),
  cluster_id        smallint references public.clusters(id),
  is_primary        boolean not null default false,
  active            boolean not null default true,
  unique (community_id, community_type_id)
);
create unique index community_affiliations_one_primary
  on public.community_affiliations (community_id) where is_primary and active;

create or replace function app.check_affiliation() returns trigger
language plpgsql as $$
declare v_has_clusters boolean; v_cluster_type smallint;
begin
  select has_clusters into v_has_clusters from public.community_types where id = new.community_type_id;
  if v_has_clusters and new.cluster_id is null then
    raise exception 'cluster_required' using errcode = '23514';
  end if;
  if not v_has_clusters and new.cluster_id is not null then
    raise exception 'cluster_not_allowed' using errcode = '23514';
  end if;
  if new.cluster_id is not null then
    select community_type_id into v_cluster_type from public.clusters where id = new.cluster_id;
    if v_cluster_type <> new.community_type_id then
      raise exception 'cluster_type_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger community_affiliations_check before insert or update on public.community_affiliations
  for each row execute function app.check_affiliation();

-- Legacy / alternative spellings, matched after normalisation (lowercase,
-- letters and digits only). Used by the importer and by staff search.
create table public.community_aliases (
  alias_norm   text primary key,
  alias        text not null,
  community_id uuid not null references public.communities(id) on delete cascade,
  note         text
);

create or replace function app.norm_key(p text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g') $$;

-- Resolved classification of a community (primary, or a specific type).
create or replace function app.community_classification(p_community uuid, p_type smallint default null)
returns table (community_type_id smallint, cluster_id smallint)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.community_type_id, a.cluster_id
  from public.community_affiliations a
  where a.community_id = p_community and a.active
    and (case when p_type is null then a.is_primary else a.community_type_id = p_type end)
  limit 1
$$;

-- ---- seed: types and clusters -------------------------------------------------
insert into public.community_types (code, name, has_clusters, sort_order) values
  ('HOST',     'Host',                false, 1),
  ('PIPELINE', 'Pipeline',            true,  2),
  ('INDIRECT', 'Indirectly Impacted', false, 3),
  ('JETTY',    'Jetty',               false, 4);

insert into public.clusters (community_type_id, name, sort_order)
select t.id, 'Cluster ' || n, n from public.community_types t, generate_series(1, 5) n where t.code = 'PIPELINE';

-- ---- seed: communities ---------------------------------------------------------
-- NOTE: the pipeline structure states 32 communities but names 31. The 32nd is
-- intentionally NOT invented; an administrator adds it once confirmed.
with src(name, short_code, type_code, cluster_no, is_primary) as (values
  -- Host (6)
  ('Okerewa','OKR','HOST',null,true), ('Njuru','NJR','HOST',null,true), ('Nwakohu','NWK','HOST',null,true),
  ('Agbonchia','AGB','HOST',null,true), ('Aleto','ALT','HOST',null,true), ('Akpajo','AKP','HOST',null,true),
  -- Pipeline cluster 1 (Akpajo's pipeline affiliation is added below as non-primary)
  ('Rumuokruoshi','RMK','PIPELINE',1,true), ('Atali','ATL','PIPELINE',1,true), ('Elelenwo','ELE','PIPELINE',1,true),
  -- cluster 2
  ('Abara','ABR','PIPELINE',2,true), ('Umuecheme','UMC','PIPELINE',2,true), ('Chokocho','CHK','PIPELINE',2,true),
  ('Umuakuru','UMK','PIPELINE',2,true), ('Edegelem','EDG','PIPELINE',2,true), ('Imeh','IMH','PIPELINE',2,true),
  ('Umuogodo','UMG','PIPELINE',2,true),
  -- cluster 3
  ('Ipo','IPO','PIPELINE',3,true), ('Omadame','OMD','PIPELINE',3,true), ('Ozuoha','OZH','PIPELINE',3,true),
  ('Ubima','UBM','PIPELINE',3,true), ('Omerelu','OMR','PIPELINE',3,true), ('Omuanwa','OMW','PIPELINE',3,true),
  -- cluster 4 (names exactly as supplied, including "Awarra (11)")
  ('Awarra (1)','AWR1','PIPELINE',4,true), ('Awarra (11)','AWR11','PIPELINE',4,true), ('Akanu','AKN','PIPELINE',4,true),
  ('Assa','ASA','PIPELINE',4,true), ('Ochia','OCH','PIPELINE',4,true),
  -- cluster 5
  ('Omoku I','OMK1','PIPELINE',5,true), ('Omoku II','OMK2','PIPELINE',5,true), ('Obor','OBR','PIPELINE',5,true),
  ('Okprukpuali','OKP','PIPELINE',5,true), ('Obrikom','OBK','PIPELINE',5,true), ('Uju','UJU','PIPELINE',5,true),
  ('Okansu','OKS','PIPELINE',5,true), ('Egbogoro','EGG','PIPELINE',5,true), ('Egbeda','EGB','PIPELINE',5,true),
  -- Indirectly impacted (10). Rumuokwurusi is NOT Rumuokruoshi.
  ('Rumuokwurusi','RMW','INDIRECT',null,true), ('Alesa','ALS','INDIRECT',null,true), ('Alode','ALD','INDIRECT',null,true),
  ('Ogale','OGL','INDIRECT',null,true), ('Iriebe','IRB','INDIRECT',null,true), ('Umuebule','UMB','INDIRECT',null,true),
  ('Ebubu','EBB','INDIRECT',null,true), ('Okujagu','OKJ','INDIRECT',null,true), ('Abam-ama','ABM','INDIRECT',null,true),
  ('Woji','WOJ','INDIRECT',null,true),
  -- Jetty (2)
  ('Onne','ONN','JETTY',null,true), ('Ogu','OGU','JETTY',null,true)
), ins as (
  insert into public.communities (name, short_code) select name, short_code from src returning id, name
)
insert into public.community_affiliations (community_id, community_type_id, cluster_id, is_primary)
select ins.id, t.id, c.id, src.is_primary
from src join ins on ins.name = src.name
join public.community_types t on t.code = src.type_code
left join public.clusters c on c.community_type_id = t.id and c.sort_order = src.cluster_no;

-- Akpajo: second affiliation, Pipeline Cluster 1 (Host stays primary).
insert into public.community_affiliations (community_id, community_type_id, cluster_id, is_primary)
select cm.id, t.id, c.id, false
from public.communities cm, public.community_types t, public.clusters c
where cm.name = 'Akpajo' and t.code = 'PIPELINE' and c.community_type_id = t.id and c.name = 'Cluster 1';

insert into public.community_aliases (alias_norm, alias, community_id, note)
select app.norm_key(a.alias), a.alias, c.id, a.note
from (values
  ('Wakohu',         'Nwakohu', 'Spelling used in the historical trackers'),
  ('Wakohu Family',  'Nwakohu', 'Family group within Nwakohu (2019–2021 records)'),
  ('Rumuwakohu',     'Nwakohu', null),
  ('Njuru/Akpakpan', 'Njuru',   'Njuru and its Akpakpan compound (2019–2021 records)'),
  ('Akpakpan',       'Njuru',   null)
) a(alias, canonical, note)
join public.communities c on c.name = a.canonical;

alter table public.profiles
  add constraint profiles_community_fk foreign key (community_id) references public.communities(id);

-- -----------------------------------------------------------------------------
-- Categories. `name` is the official label used in reports; `public_label`
-- is the plain-language label shown to community members, with an icon key.
-- -----------------------------------------------------------------------------
create table public.grievance_categories (
  id           smallint generated always as identity primary key,
  name         text not null unique,
  public_label text not null,
  public_hint  text,
  icon         text,
  sort_order   smallint not null default 0,
  active       boolean not null default true
);

create table public.grievance_subcategories (
  id          smallint generated always as identity primary key,
  category_id smallint not null references public.grievance_categories(id),
  name        text not null unique,
  sort_order  smallint not null default 0,
  active      boolean not null default true
);

insert into public.grievance_categories (name, public_label, public_hint, icon, sort_order) values
  ('Employment & Economic Inclusion', 'Jobs & business', 'Employment, contracts, small businesses, training placements', 'briefcase', 1),
  ('Corporate Social Responsibility (CSR) & Community Engagement', 'Community projects', 'CSR projects, sponsorships, how the company engages the community', 'handshake', 2),
  ('Infrastructure & Public Services', 'Roads, water & light', 'Roads, electricity, water, street lights, sanitation, housing', 'road', 3),
  ('Education & Youth Development', 'School & youth', 'Scholarships, skills training, youth programmes', 'graduation', 4),
  ('Health & Social Welfare', 'Health & welfare', 'Health care, welfare packages, support for families', 'heart', 5),
  ('Governance & Representation', 'Leadership & fairness', 'Representation, equity shares, royalties, leaders'' welfare', 'people', 6),
  ('Environmental Impact', 'Environment & pollution', 'Air or water pollution, damage to land or heritage', 'leaf', 7),
  ('Operational Impact', 'Company operations', 'Traffic, road blockage or disturbance from plant operations', 'factory', 8);

insert into public.grievance_subcategories (category_id, name, sort_order)
select c.id, s.name, s.ord
from (values
  (1,  'Poor Road Infrastructure and Commuting Difficulties', 'Infrastructure & Public Services'),
  (2,  'Inadequate Employment Opportunities for Youth', 'Employment & Economic Inclusion'),
  (3,  'Lack of Quality Healthcare Services', 'Health & Social Welfare'),
  (4,  'Insufficient Street Lighting and Community Safety', 'Infrastructure & Public Services'),
  (5,  'Dangerous Road Conditions Leading to Accidents', 'Infrastructure & Public Services'),
  (6,  'Unemployment and Scarcity of Job Opportunities', 'Employment & Economic Inclusion'),
  (7,  'Unfair Job Sharing Practices', 'Employment & Economic Inclusion'),
  (8,  'Lack of Representation in Decision-Making Processes', 'Governance & Representation'),
  (9,  'Air and Water Pollution', 'Environmental Impact'),
  (10, 'Insufficient Corporate Social Responsibility (CSR) Initiatives', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (11, 'Lack of Educational Scholarships for Youth', 'Education & Youth Development'),
  (12, 'Poor Electrical Infrastructure and Unstable Power Supply', 'Infrastructure & Public Services'),
  (13, 'Inadequate Training Opportunities for Community Children', 'Education & Youth Development'),
  (14, 'Sale of Community Job Opportunities', 'Employment & Economic Inclusion'),
  (15, 'Cancellation of Sponsored Community Events', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (16, 'Support for Women and Families', 'Health & Social Welfare'),
  (17, 'Lack of Representation in Indorama Community Relations', 'Governance & Representation'),
  (18, 'Poor Handling of Legal Matters in Host Communities', 'Governance & Representation'),
  (19, 'Need for Youth Volunteer and Empowerment Programs', 'Education & Youth Development'),
  (20, 'Unfair Equity Shares and Distribution', 'Governance & Representation'),
  (21, 'Lack of Access to Clean Water', 'Infrastructure & Public Services'),
  (22, 'Poor Waste Management and Sanitation', 'Infrastructure & Public Services'),
  (23, 'Insufficient Public Transportation Services', 'Infrastructure & Public Services'),
  (24, 'High Cost of Living and Financial Strain on Residents', 'Health & Social Welfare'),
  (25, 'Lack of Recreational Facilities for Youth and Adults', 'Education & Youth Development'),
  (26, 'Inadequate Support for Small Businesses', 'Employment & Economic Inclusion'),
  (27, 'Limited Access to Affordable Housing', 'Infrastructure & Public Services'),
  (28, 'Lack of Mental Health Support Services', 'Health & Social Welfare'),
  (29, 'Low Community Involvement in Company Decisions', 'Governance & Representation'),
  (30, 'Neglect of Cultural and Historical Preservation Efforts', 'Environmental Impact'),
  (31, 'Equitable Distribution of CSR Benefits', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (32, 'Collaboration Between Indorama and Stakeholders', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (33, 'Lack of Industrial Training Placements for Students', 'Employment & Economic Inclusion'),
  (34, 'Road Blockage and Congestion Due to Indorama Operations', 'Operational Impact'),
  (35, 'Insufficient Reach of Corporate Social Responsibility (CSR) Initiatives', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (36, 'Lack of Communication of Job Openings', 'Employment & Economic Inclusion'),
  (37, 'Preference of Non Eleme Contractors/Workers Over Eleme Contractors/Workers', 'Employment & Economic Inclusion'),
  (38, 'Employment Progression & Inclusion', 'Employment & Economic Inclusion'),
  (39, 'Recognition and Inclusion of Pipeline Communities', 'Governance & Representation'),
  (40, 'Inadequate Community Development Projects', 'Infrastructure & Public Services'),
  (41, 'Poor Quality or Value of Community Welfare Packages', 'Health & Social Welfare'),
  (42, 'Non-Payment of Community Royalty and Traditional Entitlements', 'Governance & Representation'),
  (43, 'Poor Implementation and Funding of CSR Projects', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (44, 'Lack of Support for Community Contractors', 'Employment & Economic Inclusion'),
  (45, 'Inadequate Skill Acquisition and Workforce Absorption', 'Education & Youth Development'),
  (46, 'Limited Beneficiaries of Grants and Empowerment Programs', 'Education & Youth Development'),
  (47, 'Poor Community Relations and Stakeholder Engagement', 'Corporate Social Responsibility (CSR) & Community Engagement'),
  (48, 'Compensation and Welfare of Community and Cluster leaders', 'Governance & Representation')
) s(ord, name, category)
join public.grievance_categories c on c.name = s.category;

-- -----------------------------------------------------------------------------
-- Statuses. Staff see `staff_label`; community members only ever see
-- `public_label` / `public_message` (internal stages collapse into plain ones).
-- -----------------------------------------------------------------------------
create table public.grievance_statuses (
  id             smallint generated always as identity primary key,
  code           text not null unique,
  staff_label    text not null,
  public_label   text not null,
  public_message text not null,
  is_open        boolean not null,    -- counts as outstanding
  stops_sla      boolean not null,    -- the SLA clock stops in this status
  sort_order     smallint not null,
  icon           text,
  tone           text not null default 'neutral' check (tone in ('neutral','info','progress','warning','success','muted')),
  active         boolean not null default true
);

insert into public.grievance_statuses (code, staff_label, public_label, public_message, is_open, stops_sla, sort_order, icon, tone) values
  ('SUBMITTED',       'Submitted',       'Received',     'Your grievance has been received.',            true,  false, 1, 'inbox',    'info'),
  ('UNDER_REVIEW',    'Under Review',    'Under review', 'Our team is reviewing your grievance.',        true,  false, 2, 'search',   'info'),
  ('ASSIGNED',        'Assigned',        'Under review', 'Our team is reviewing your grievance.',        true,  false, 3, 'user',     'info'),
  ('IN_PROGRESS',     'In Progress',     'In progress',  'Action is being taken.',                       true,  false, 4, 'progress', 'progress'),
  ('AWAITING_ACTION', 'Awaiting Action', 'In progress',  'Action is being taken.',                       true,  false, 5, 'clock',    'warning'),
  ('RESOLVED',        'Resolved',        'Resolved',     'Your grievance has been resolved.',            false, true,  6, 'check',    'success'),
  ('CLOSED',          'Closed',          'Closed',       'This grievance has been closed.',              false, true,  7, 'lock',     'muted'),
  ('REOPENED',        'Reopened',        'Reopened',     'We are looking at your grievance again.',      true,  false, 8, 'refresh',  'warning');

-- Allowed moves for change_grievance_status(). RESOLVED is reached only via
-- resolve_grievance() (it needs resolution details); REOPENED via a dispute or
-- an explicit reopen.
create table public.grievance_status_transitions (
  from_status_id smallint not null references public.grievance_statuses(id),
  to_status_id   smallint not null references public.grievance_statuses(id),
  required_permission text not null references public.permissions(code) default 'grievance.update_status',
  primary key (from_status_id, to_status_id)
);

insert into public.grievance_status_transitions (from_status_id, to_status_id, required_permission)
select f.id, t.id, x.perm
from (values
  ('SUBMITTED','UNDER_REVIEW','grievance.update_status'), ('SUBMITTED','ASSIGNED','grievance.update_status'),
  ('SUBMITTED','IN_PROGRESS','grievance.update_status'),
  ('UNDER_REVIEW','ASSIGNED','grievance.update_status'), ('UNDER_REVIEW','IN_PROGRESS','grievance.update_status'),
  ('UNDER_REVIEW','AWAITING_ACTION','grievance.update_status'),
  ('ASSIGNED','UNDER_REVIEW','grievance.update_status'), ('ASSIGNED','IN_PROGRESS','grievance.update_status'),
  ('ASSIGNED','AWAITING_ACTION','grievance.update_status'),
  ('IN_PROGRESS','AWAITING_ACTION','grievance.update_status'), ('AWAITING_ACTION','IN_PROGRESS','grievance.update_status'),
  ('REOPENED','UNDER_REVIEW','grievance.update_status'), ('REOPENED','IN_PROGRESS','grievance.update_status'),
  ('REOPENED','AWAITING_ACTION','grievance.update_status'),
  ('RESOLVED','CLOSED','grievance.close'),
  ('RESOLVED','REOPENED','grievance.update_status'), ('CLOSED','REOPENED','grievance.close')
) x(f, t, perm)
join public.grievance_statuses f on f.code = x.f
join public.grievance_statuses t on t.code = x.t;

create table public.severities (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null unique,
  sort_order smallint not null,
  tone       text not null default 'neutral',
  active     boolean not null default true
);
insert into public.severities (code, name, sort_order, tone) values
  ('LOW', 'Low', 1, 'neutral'), ('MEDIUM', 'Medium', 2, 'warning'), ('HIGH', 'High', 3, 'danger');

-- Public holidays for the working-day SLA clock (maintained by admins).
create table public.holidays (
  day  date primary key,
  name text not null
);

-- A version stamp clients use to know when to refresh cached master data.
create table public.master_data_version (
  id         boolean primary key default true check (id),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.master_data_version default values;

create or replace function app.bump_master_data_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.master_data_version set version = version + 1, updated_at = now();
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['community_types','clusters','communities','community_affiliations','community_aliases',
                           'grievance_categories','grievance_subcategories','grievance_statuses',
                           'grievance_status_transitions','severities','holidays']
  loop
    execute format('create trigger %1$s_version after insert or update or delete on public.%1$s
                    for each statement execute function app.bump_master_data_version()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

create trigger communities_touch before update on public.communities for each row execute function app.touch_updated_at();
