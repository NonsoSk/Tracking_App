import { supabase } from './supabase';
import { toAppError } from './errors';
import type {
  Access, AppNotification, AuditRow, DashboardStats, Filters, MasterData, MyGrievance, MyGrievanceDetail,
  OfficerHome, Profile, StaffDetail, StaffList, SubmissionCode, SubmissionStatus, UserRow,
} from './types';

/** Call a database function; every failure becomes an AppError with a friendly message. */
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args ?? {});
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw toAppError({ ...res.error, status: res.status });
  return res.data as T;
}

export interface SubmitPayload {
  client_submission_id: string;
  submission_code: string;
  community_id: string;
  description: string;
  title?: string | null;
  category_id?: number | null;
  desired_resolution?: string | null;
  suggestions?: string | null;
  client_created_at: string;
}

export interface SubmitResult { id: string; tracking_id: string; submitted_at: string; result: 'created' | 'already_submitted' }

export const api = {
  masterData: () => rpc<MasterData>('get_master_data'),
  myAccess: () => rpc<Access>('my_access'),
  myProfile: () => rpc<Profile | null>('my_profile'),
  updateMyProfile: (p: Partial<Pick<Profile, 'full_name' | 'community_id' | 'email' | 'address' | 'gender'>>) =>
    rpc<void>('update_my_profile', { p }),

  // community member
  submissionStatus: (communityId?: string | null) => rpc<SubmissionStatus>('get_submission_status', { p_community: communityId ?? null }),
  submitGrievance: (p: SubmitPayload) => rpc<SubmitResult>('submit_grievance', { p }),
  myGrievances: (since?: string | null) => rpc<MyGrievance[]>('my_grievances', { p_since: since ?? null }),
  myGrievanceDetail: (id: string) => rpc<MyGrievanceDetail>('my_grievance_detail', { p_id: id }),
  findMyGrievance: (trackingId: string) => rpc<string | null>('find_my_grievance', { p_tracking_id: trackingId }),
  acknowledge: (id: string, response: 'acknowledged' | 'disputed', reason?: string) =>
    rpc<void>('acknowledge_resolution', { p_id: id, p_response: response, p_reason: reason ?? null }),
  notifications: (since?: string | null) => rpc<AppNotification[]>('my_notifications', { p_since: since ?? null, p_limit: 100 }),
  markRead: (ids?: number[]) => rpc<number>('mark_notifications_read', { p_ids: ids ?? null }),

  // staff
  staffList: (filters: Filters, page = 1, pageSize = 25, sort = 'received_desc') =>
    rpc<StaffList>('staff_grievance_list', { p_filters: filters, p_page: page, p_page_size: pageSize, p_sort: sort }),
  staffDetail: (id: string) => rpc<StaffDetail>('staff_grievance_detail', { p_id: id }),
  officerHome: () => rpc<OfficerHome>('officer_home'),
  dashboard: (filters: Filters) => rpc<DashboardStats>('dashboard_stats', { p_filters: filters }),
  exportRows: (filters: Filters) => rpc<Record<string, unknown>[]>('export_grievances', { p_filters: filters }),
  submitAssisted: (p: Record<string, unknown>) => rpc<SubmitResult>('submit_grievance_assisted', { p }),

  assign: (id: string, officerId: string, reason?: string) => rpc<void>('assign_grievance', { p_id: id, p_officer: officerId, p_reason: reason ?? null }),
  changeStatus: (id: string, status: string, note?: string, visible = true) =>
    rpc<void>('change_grievance_status', { p_id: id, p_status: status, p_note: note ?? null, p_visible_to_complainant: visible }),
  addComment: (id: string, body: string, visibility: 'internal' | 'complainant') =>
    rpc<number>('add_grievance_comment', { p_id: id, p_body: body, p_visibility: visibility }),
  addAction: (id: string, description: string, type = 'action', date?: string) =>
    rpc<number>('add_grievance_action', { p_id: id, p_description: description, p_action_type: type, p_action_date: date ?? null }),
  triage: (id: string, p: Record<string, unknown>) => rpc<void>('update_grievance_triage', { p_id: id, p }),
  resolve: (id: string, details: string, publicSummary?: string) =>
    rpc<void>('resolve_grievance', { p_id: id, p_details: details, p_public_summary: publicSummary ?? null }),
  requestAck: (id: string) => rpc<void>('request_acknowledgement', { p_id: id }),
  recordAck: (id: string, response: 'acknowledged' | 'disputed', reason: string | null, channel: string) =>
    rpc<void>('record_acknowledgement', { p_id: id, p_response: response, p_reason: reason, p_channel: channel }),
  amendText: (id: string, field: string, value: string, reason: string) =>
    rpc<void>('amend_grievance_text', { p_id: id, p_field: field, p_value: value, p_reason: reason }),
  requestArchive: (id: string, reason: string) => rpc<void>('request_grievance_archive', { p_id: id, p_reason: reason }),
  archive: (id: string, reason: string) => rpc<void>('archive_grievance', { p_id: id, p_reason: reason }),
  restore: (id: string) => rpc<void>('restore_grievance', { p_id: id }),
  hardDelete: (id: string, confirm: string) => rpc<void>('hard_delete_grievance', { p_id: id, p_confirm_tracking_id: confirm }),
  resolveFlag: (flagId: number, resolution: string) => rpc<void>('resolve_grievance_flag', { p_flag_id: flagId, p_resolution: resolution }),

  listStaff: () => rpc<{ id: string; full_name: string; job_title: string | null; roles: string[]; is_active: boolean }[]>('list_staff'),
  codes: () => rpc<SubmissionCode[]>('list_submission_codes', { p_include_inactive: true }),
  createCode: (p: Record<string, unknown>) => rpc<SubmissionCode>('create_submission_code', { p }),
  releaseCode: (id: string) => rpc<unknown>('release_submission_code', { p_id: id }),
  deactivateCode: (id: string, reason?: string) => rpc<unknown>('deactivate_submission_code', { p_id: id, p_reason: reason ?? null }),

  users: (filters: { kind?: 'all' | 'staff' | 'members'; q?: string }) => rpc<UserRow[]>('list_users', { p_filters: filters }),
  setRoles: (userId: string, roles: string[]) => rpc<void>('admin_set_user_roles', { p_user: userId, p_roles: roles }),
  setActive: (userId: string, active: boolean) => rpc<void>('admin_set_user_active', { p_user: userId, p_active: active }),
  setScopes: (officerId: string, scopes: unknown[]) => rpc<void>('admin_set_officer_scopes', { p_officer: officerId, p_scopes: scopes }),
  updateProfile: (userId: string, p: Record<string, unknown>) => rpc<void>('admin_update_profile', { p_user: userId, p }),
  audit: (filters: Record<string, unknown>, page = 1) => rpc<{ total: number; rows: AuditRow[] }>('list_audit_logs', { p_filters: filters, p_page: page, p_page_size: 50 }),
  settings: () => rpc<{ key: string; value: unknown; description: string | null; is_public: boolean; updated_at: string }[]>('list_settings'),
  updateSetting: (key: string, value: unknown) => rpc<void>('update_setting', { p_key: key, p_value: value }),

  /** Staff account creation needs the Auth admin API, so it runs in an Edge Function (service role). */
  async createStaffUser(p: { email: string; full_name: string; job_title?: string; roles: string[]; password: string }) {
    const { data, error } = await supabase.functions.invoke('admin-create-user', { body: p });
    if (error) throw toAppError(error);
    return data as { id: string };
  },

  async resetMemberPin(userId: string) {
    const { data, error } = await supabase.functions.invoke('admin-reset-pin', { body: { user_id: userId } });
    if (error) throw toAppError(error);
    return data as { pin: string };
  },

  // master data tables (RLS: masterdata.manage for writes)
  table: (name: string) => supabase.from(name),
};
