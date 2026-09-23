-- =============================================================================
-- Historical import: batches, verbatim source rows, and legacy value mappings.
-- The importer (Phase 12) writes here; nothing in this migration imports data.
--
-- Rule: every original Excel row is kept verbatim in legacy_source_records,
-- including rows that are NOT turned into grievances (overlap copies and
-- confirmed duplicates), so "what did the original file say?" always has an
-- answer.
-- =============================================================================

create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  file_name    text not null,
  file_sha256  text not null,
  workbook     text not null,               -- short label, e.g. 'Complete 2018-2026'
  status       text not null default 'draft' check (status in ('draft','validated','imported','rolled_back','failed')),
  column_map   jsonb,                       -- sheet -> {legacy column -> standard field}
  counts       jsonb not null default '{}'::jsonb,  -- total/valid/invalid/duplicates/imported/skipped
  report       jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  imported_at  timestamptz,
  rolled_back_at timestamptz
);
create unique index import_batches_file_once on public.import_batches (file_sha256) where status = 'imported';

create table public.legacy_source_records (
  id            bigint generated always as identity primary key,
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  workbook      text not null,
  sheet         text not null,
  row_number    int not null,
  source_serial text,
  raw           jsonb not null,             -- every original cell, header -> value, verbatim
  grievance_id  uuid references public.grievances(id) on delete set null,
  match_role    text not null check (match_role in ('primary','overlap_copy','excluded_duplicate','excluded_invalid')),
  note          text,
  unique (batch_id, sheet, row_number)
);
create index legacy_source_records_g_idx on public.legacy_source_records (grievance_id);

alter table public.grievances
  add constraint grievances_import_batch_fk foreign key (import_batch_id) references public.import_batches(id);

-- Legacy value -> standard id, editable in the import wizard.
create table public.legacy_value_mappings (
  field             text not null check (field in ('category','subcategory','status','severity','community')),
  legacy_value_norm text not null,
  legacy_value      text not null,
  target_id         text,                 -- id of the standard row (text to cover smallint and uuid keys)
  note              text,
  approved_by       uuid,
  approved_at       timestamptz,
  primary key (field, legacy_value_norm)
);
create trigger legacy_value_mappings_audit after insert or update or delete on public.legacy_value_mappings
  for each row execute function app.audit_row();

-- Proposed mappings from docs/01-data-audit.md §8.2–8.3 (pending approval in the wizard).
insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id, note)
select 'category', app.norm_key(m.legacy), m.legacy, c.id::text, 'proposed (data audit §8.2)'
from (values
  ('Employment','Employment & Economic Inclusion'), ('Empowerment','Employment & Economic Inclusion'),
  ('Contracts & Supplies','Employment & Economic Inclusion'), ('Distributions','Employment & Economic Inclusion'),
  ('CSR','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('CSR Project','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('CSR Projects','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('Community Need','Corporate Social Responsibility (CSR) & Community Engagement'),
  ('Electricity','Infrastructure & Public Services'), ('Drinking Water','Infrastructure & Public Services'),
  ('Infrastructure Development','Infrastructure & Public Services'),
  ('Education','Education & Youth Development'), ('Scholarship','Education & Youth Development'),
  ('Skill Acquisition','Education & Youth Development'),
  ('Health','Health & Social Welfare'), ('Feeding','Health & Social Welfare'), ('COVID 19 Pandemic','Health & Social Welfare'),
  ('Equity Share','Governance & Representation'), ('Equity Shares','Governance & Representation'),
  ('Dividends','Governance & Representation'), ('Community Grievance','Governance & Representation'),
  ('Community conflict','Governance & Representation'), ('LGA Grievance','Governance & Representation'),
  ('Security','Governance & Representation'),
  -- a sub-category typed into the category column (tracker 2026.1)
  ('Insufficient Reach of Corporate Social Responsibility (CSR) Initiatives',
   'Corporate Social Responsibility (CSR) & Community Engagement')
) m(legacy, standard)
join public.grievance_categories c on c.name = m.standard;

insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id, note)
select 'status', app.norm_key(m.legacy), m.legacy, s.id::text, m.note
from (values
  ('Closed', 'CLOSED', null), ('WIP', 'IN_PROGRESS', 'legacy open: officer review before alerts'),
  ('Resolved', 'RESOLVED', 'acknowledgement not captured'), ('Ongoing', 'IN_PROGRESS', null),
  ('Not Started', 'ASSIGNED', 'SUBMITTED when no officer is recorded')
) m(legacy, code, note)
join public.grievance_statuses s on s.code = m.code;

insert into public.legacy_value_mappings (field, legacy_value_norm, legacy_value, target_id)
select 'severity', app.norm_key(m.legacy), m.legacy, s.id::text
from (values ('High','HIGH'), ('Medium','MEDIUM'), ('Low','LOW')) m(legacy, code)
join public.severities s on s.code = m.code;
