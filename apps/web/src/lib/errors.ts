/**
 * The database raises stable machine keys (e.g. 'code_expired'). Users only
 * ever see the plain-language text below, never a database error.
 */
const MESSAGES: Record<string, string> = {
  network: "You're offline or the connection is weak. Please try again when you have signal.",
  not_signed_in: 'Please sign in again.',
  not_allowed: "You don't have permission to do that.",
  not_found: "We couldn't find that grievance.",
  invalid_login: 'That phone number/email and PIN do not match. Please check and try again.',
  account_exists: 'An account with this phone number already exists. Please sign in instead.',
  account_disabled: 'This account has been disabled. Please contact the Community Relations office.',
  weak_pin: 'Your PIN must be 6 digits.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',

  code_invalid: "That submission code isn't correct. Please check it with your community leader.",
  code_expired: 'This submission code has expired. Grievance collection for your community is closed.',
  code_not_yet_valid: 'This submission code is not open yet. Please try again when collection opens.',
  code_deactivated: 'This submission code is no longer active.',
  code_wrong_community: 'This code is for a different community. Please use the code for your community.',
  code_full: 'The maximum number of grievances for this code has been reached.',
  description_too_short: 'Please describe your concern in a little more detail (at least 10 characters).',
  community_invalid: 'Please choose your community from the list.',
  category_invalid: 'Please choose the type of concern again.',
  subcategory_invalid: 'Please choose the type of concern again.',
  text_too_long: 'That text is too long. Please shorten it.',
  client_submission_id_conflict: 'Something went wrong with this draft. Please start a new one.',

  reason_required: 'Please tell us briefly why.',
  resolution_details_required: 'Please describe how the grievance was resolved (at least 10 characters).',
  already_resolved: 'This grievance is already resolved.',
  not_resolved: 'This grievance has not been resolved yet.',
  transition_not_allowed: "That status change isn't allowed from the current status.",
  use_resolve_grievance: 'Use "Resolve" to record how the grievance was resolved.',
  outside_your_responsibility: 'That community is outside your responsibility.',
  officer_invalid: 'Please choose an active officer.',
  validity_invalid: 'The end date must be after the start date.',
  confirmation_mismatch: "The tracking ID you typed doesn't match.",
  archive_first: 'Archive the grievance before deleting it permanently.',
  last_super_admin: 'At least one active Super Administrator is required.',
  cannot_disable_self: "You can't disable your own account.",
  phone_invalid: 'Please enter a valid Nigerian phone number.',
  name_required: "Please enter the complainant's name.",
  file_already_imported: 'This file has already been imported.',
};

/** Errors after which retrying the same request can never succeed. */
const PERMANENT = new Set([
  'code_invalid', 'code_expired', 'code_not_yet_valid', 'code_deactivated', 'code_wrong_community', 'code_full',
  'description_too_short', 'community_invalid', 'category_invalid', 'subcategory_invalid', 'text_too_long',
  'client_submission_id_conflict', 'not_allowed', 'not_found',
]);

export class AppError extends Error {
  constructor(public key: string, message?: string) {
    super(message ?? MESSAGES[key] ?? 'Something went wrong. Please try again.');
  }
  /** true when the request may succeed later (network, server busy) */
  get transient() {
    return this.key === 'network' || this.key === 'server';
  }
  get permanent() {
    return PERMANENT.has(this.key);
  }
}

export function messageFor(key: string): string {
  return MESSAGES[key] ?? 'Something went wrong. Please try again.';
}

type PgLikeError = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

/** Normalise anything thrown by fetch / supabase-js into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as PgLikeError & { status?: number };
  const msg = (err?.message ?? '').trim();
  if (e instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return new AppError('network');
  }
  if (msg in MESSAGES) return new AppError(msg);
  if (/invalid login credentials/i.test(msg)) return new AppError('invalid_login');
  if (/already registered|already exists/i.test(msg)) return new AppError('account_exists');
  if (/rate limit|too many/i.test(msg)) return new AppError('rate_limited');
  if (/JWT|not_signed_in|session/i.test(msg)) return new AppError('not_signed_in');
  if (err?.code === '42501') return new AppError('not_allowed');
  if (err?.status && err.status >= 500) return new AppError('server', 'The service is busy. Please try again shortly.');
  return new AppError('unknown');
}
