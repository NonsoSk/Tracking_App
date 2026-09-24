export type Tone = 'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'muted' | 'danger';

export interface MasterData {
  version: number;
  community_types: { id: number; code: 'HOST' | 'PIPELINE' | 'INDIRECT' | 'JETTY' | string; name: string; has_clusters: boolean }[];
  clusters: { id: number; community_type_id: number; name: string }[];
  communities: { id: string; name: string; affiliations: { community_type_id: number; cluster_id: number | null; is_primary: boolean }[] }[];
  categories: { id: number; name: string; public_label: string; public_hint: string | null; icon: string | null }[];
  subcategories: { id: number; category_id: number; name: string }[];
  statuses: { id: number; code: string; staff_label: string; public_label: string; public_message: string; is_open: boolean; tone: Tone; icon: string | null }[];
  severities: { id: number; code: string; name: string; tone: Tone }[];
  settings: Record<string, unknown>;
}

export interface Access {
  user_id: string;
  is_active: boolean;
  roles: string[];
  permissions: string[];
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gender: 'male' | 'female' | null;
  community_id: string | null;
  community_name: string | null;
  is_active: boolean;
}

export interface SubmissionStatus {
  open: boolean;
  community_id: string | null;
  community_name: string | null;
  code: string | null;
  valid_from: string | null;
  valid_until: string | null;
  server_time: string;
}

export interface MyGrievance {
  id: string;
  tracking_id: string;
  title: string | null;
  date_received: string;
  submitted_at: string | null;
  updated_at: string;
  community_name: string | null;
  status_code: string;
  status_label: string;
  status_message: string;
  status_tone: Tone;
  ack_state: string;
  needs_acknowledgement: boolean;
  category_label: string | null;
}

export interface MyGrievanceDetail extends MyGrievance {
  description: string;
  desired_resolution: string | null;
  suggestions: string | null;
  resolved_at: string | null;
  timeline: { label: string; message: string; at: string; code: string }[];
  updates: { body: string; at: string }[];
  resolution: { details: string; resolved_at: string | null } | null;
  acknowledgement: { response: 'acknowledged' | 'disputed'; reason: string | null; at: string } | null;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  grievance_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface StaffRow {
  id: string;
  tracking_id: string;
  legacy_tracking_id: string | null;
  title: string | null;
  date_received: string;
  date_received_precision: 'day' | 'month' | 'year';
  complainant_name: string | null;
  community_name: string | null;
  community_type: string | null;
  cluster_name: string | null;
  category_name: string | null;
  severity_name: string | null;
  status_code: string;
  status_label: string;
  status_tone: Tone;
  is_open: boolean;
  assigned_officer_name: string | null;
  days_outstanding: number | null;
  is_overdue: boolean | null;
  is_due_soon: boolean | null;
  ack_state: string;
  is_legacy: boolean;
  open_flags: number;
  updated_at: string;
}

export interface StaffList { total: number; page: number; page_size: number; rows: StaffRow[] }

export interface HistoryItem {
  kind: 'status' | 'comment' | 'action' | 'assignment' | 'acknowledgement';
  at: string;
  by_name: string | null;
  from_label: string | null;
  label: string | null;
  tone: Tone | null;
  body: string | null;
  public: boolean;
}

export interface StaffDetail extends StaffRow {
  description: string;
  incident_details: string | null;
  desired_resolution: string | null;
  suggestions: string | null;
  complainant_phone: string | null;
  complainant_gender: string | null;
  complainant_email: string | null;
  complainant_address: string | null;
  community_id: string | null;
  community_type_id: number | null;
  category_id: number | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  severity_id: number | null;
  assigned_officer_id: string | null;
  origin: string;
  submitted_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  sla_due_at: string | null;
  form_issued_date: string | null;
  review_date: string | null;
  first_response_at: string | null;
  responsibility: string | null;
  text_amended: boolean;
  legacy_needs_review: boolean;
  archived_at: string | null;
  closure_officer_name: string | null;
  legacy: Record<string, string | number>;
  affiliations: { community_type_id: number; type: string; cluster: string | null; is_primary: boolean }[] | null;
  history: HistoryItem[];
  resolution: { details: string; public_summary: string | null; resolved_at: string | null; resolved_by: string | null } | null;
  flags: { id: number; flag: string; detail: Record<string, unknown> | null; created_at: string; resolved_at: string | null }[];
  sources: { workbook: string; sheet: string; row: number; role: string; note: string | null; raw: Record<string, string> }[];
  can: Record<'assign' | 'update_status' | 'comment' | 'resolve' | 'close' | 'triage' | 'record_ack' | 'amend' | 'archive' | 'request_archive' | 'hard_delete', boolean>;
  next_statuses: { code: string; label: string }[];
}

export interface Breakdown { key: string | number; id?: string | number | null; total?: number; open?: number; overdue?: number; resolved?: number; received?: number; code?: string; tone?: Tone }

export interface DashboardStats {
  kpis: {
    total: number; open: number; submitted: number; under_review: number; in_progress: number; resolved: number; closed: number;
    overdue: number; due_soon: number; awaiting_ack: number; resolution_rate: number | null; avg_resolution_days: number | null;
  };
  by_year: Breakdown[];
  by_month: Breakdown[];
  by_type: Breakdown[];
  by_cluster: Breakdown[];
  by_community: Breakdown[];
  by_category: Breakdown[];
  by_severity: Breakdown[];
  by_status: Breakdown[];
  officer_workload: Breakdown[];
  years: number[];
}

export interface OfficerHome {
  overdue: number; due_soon: number; new: number; under_review: number; in_progress: number;
  awaiting_ack: number; resolved: number; needs_review: number; assigned_open: number;
}

export interface SubmissionCode {
  id: string; code: string; label: string | null; scope_type: string; scope_name: string;
  valid_from: string; valid_until: string; max_submissions: number | null; submission_count: number;
  state: 'draft' | 'active' | 'scheduled' | 'expired' | 'full' | 'deactivated';
  created_by: string | null; created_at: string; released_by: string | null; released_at: string | null;
  deactivated_by: string | null; deactivated_at: string | null; deactivation_reason: string | null;
}

export interface UserRow {
  id: string; full_name: string; phone: string | null; email: string | null; job_title: string | null;
  community: string | null; is_active: boolean; created_at: string; roles: string[];
  scopes: { community_type: string | null; cluster_id: number | null; cluster: string | null; community_id: string | null; community: string | null; auto_assign: boolean }[];
}

export interface AuditRow { id: number; at: string; actor: string | null; action: string; entity: string; entity_id: string | null; old: unknown; new: unknown }

export type Filters = Partial<{
  q: string; year: number; date_from: string; date_to: string; community_type_id: number; cluster_id: number;
  community_id: string; category_id: number; subcategory_id: number; severity_id: number; status: string[];
  officer_id: string; unassigned: boolean; open: boolean; overdue: boolean; due_soon: boolean; flagged: boolean;
  legacy: boolean; needs_ack: boolean; archived: boolean;
}>;

/** Who is in charge: a whole community type, a pipeline cluster, or one community. */
export type Scope = { community_type: string } | { cluster_id: number } | { community_id: string };

export interface ScopePerson { id: string; name: string; job_title: string | null; active: boolean; open_grievances: number }

export interface TypeResponsibility {
  id: number; code: string; name: string; has_clusters: boolean;
  communities: number; open_grievances: number; unassigned: number;
  officers: ScopePerson[];
  clusters: { id: number; name: string; communities: number; open_grievances: number; officers: ScopePerson[] }[];
}

export interface CommunityPeople {
  community_id: string; community: string; active: boolean;
  officer_id: string | null; officer: string | null; via: string | null; open_grievances: number;
  officers: { id: string; name: string; via: 'community' | 'cluster' | 'community type'; group: string | null }[];
}
