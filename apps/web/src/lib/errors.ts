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
  account_exists: 'An account with this phone number or email already exists. Sign in instead, or use a different one.',
  account_disabled: 'This account has been disabled. Please contact the Community Relations office.',
  weak_pin: 'Your PIN must be 6 digits.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  email_not_confirmed: 'This account is waiting for confirmation. The administrator must turn off "Confirm email" in Supabase (Authentication → Sign In / Providers → Email), then you can sign in.',
  email_send_failed: 'The account could not be created because the server tried to send a confirmation email. The administrator must turn off "Confirm email" in Supabase (Authentication → Sign In / Providers → Email).',
  email_not_sent: 'The invitation was saved, but Supabase could not send the email. Check Supabase → Authentication → Emails → SMTP Settings, then press Resend.',
  email_not_authorized: "The invitation was saved, but Supabase's built-in email only sends to members of your Supabase team. Set up your own email sender under Supabase → Authentication → Emails → SMTP Settings, then press Resend.",
  email_rate_limited: 'The invitation was saved, but too many emails were sent recently (Supabase\'s built-in email allows only a few per hour). Wait and press Resend, or set up your own email sender (SMTP).',
  link_expired: 'This sign-in link has expired or was already used. Ask the administrator to resend your invitation.',
  same_password: 'Please choose a different password.',
  email_address_invalid: 'The server rejected the sign-in address. The administrator should check the Supabase email settings.',
  signup_disabled: 'New accounts are switched off. The administrator must allow new users to sign up in Supabase (Authentication → Sign In / Providers).',
  weak_password: 'That password is too weak for the server\'s rules. Use at least 10 characters with capital and small letters, a number and a symbol.',
  signup_db_error: 'The account could not be saved. The database setup may be incomplete; the administrator should re-run the latest update script.',

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
  email_invalid: 'Please enter a valid email address.',
  password_too_short: 'The temporary password must be at least 10 characters.',
  role_invalid: 'Please choose a role.',
  not_a_member: 'PIN reset is only for community member accounts.',
};

/** Errors after which retrying the same request can never succeed. */
const PERMANENT = new Set([
  'code_invalid', 'code_expired', 'code_not_yet_valid', 'code_deactivated', 'code_wrong_community', 'code_full',
  'description_too_short', 'community_invalid', 'category_invalid', 'subcategory_invalid', 'text_too_long',
  'client_submission_id_conflict', 'not_allowed', 'not_found',
]);

export class AppError extends Error {
  /** The original technical message, shown small under unexpected errors so it can be reported. */
  detail?: string;
  constructor(public key: string, message?: string, detail?: string) {
    super(message ?? MESSAGES[key] ?? 'Something went wrong. Please try again.');
    this.detail = detail;
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

/** Supabase Auth error codes → our keys. */
const AUTH_CODES: Record<string, string> = {
  invalid_credentials: 'invalid_login', email_not_confirmed: 'email_not_confirmed', user_already_exists: 'account_exists',
  email_exists: 'account_exists', weak_password: 'weak_password', signup_disabled: 'signup_disabled', email_provider_disabled: 'signup_disabled',
  email_address_invalid: 'email_address_invalid', email_address_not_authorized: 'email_not_authorized', over_email_send_rate_limit: 'email_rate_limited', same_password: 'same_password',
  over_request_rate_limit: 'rate_limited', user_banned: 'account_disabled', unexpected_failure: 'signup_db_error',
};

/** Normalise anything thrown by fetch / supabase-js into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as PgLikeError & { status?: number };
  const msg = (err?.message ?? '').trim();
  if (e instanceof TypeError || /fetch|network|Failed to fetch|Load failed/i.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return new AppError('network');
  }
  if (msg in MESSAGES) return new AppError(msg);
  if (err?.code && AUTH_CODES[err.code]) return new AppError(AUTH_CODES[err.code], undefined, msg);
  if (/email not confirmed/i.test(msg)) return new AppError('email_not_confirmed', undefined, msg);
  if (/confirmation email/i.test(msg)) return new AppError('email_send_failed', undefined, msg);
  if (/not authorized/i.test(msg)) return new AppError('email_not_authorized', undefined, msg);
  if (/sending .*email|magic link/i.test(msg)) return new AppError('email_not_sent', undefined, msg);
  if (/email address .* is invalid|invalid format/i.test(msg)) return new AppError('email_address_invalid', undefined, msg);
  if (/signups? not allowed|signup.* disabled/i.test(msg)) return new AppError('signup_disabled', undefined, msg);
  if (/password should|weak password|password is known/i.test(msg)) return new AppError('weak_password', undefined, msg);
  if (/database error saving new user/i.test(msg)) return new AppError('signup_db_error', undefined, msg);
  if (/invalid login credentials/i.test(msg)) return new AppError('invalid_login');
  if (/already registered|already exists/i.test(msg)) return new AppError('account_exists');
  if (/rate limit|too many/i.test(msg)) return new AppError('rate_limited');
  if (/JWT|not_signed_in|session/i.test(msg)) return new AppError('not_signed_in');
  if (err?.code === '42501') return new AppError('not_allowed');
  if (err?.status && err.status >= 500) return new AppError('server', 'The service is busy. Please try again shortly.', msg || undefined);
  return new AppError('unknown', undefined, [err?.code, msg].filter(Boolean).join(': ') || undefined);
}

/** Plain message, plus the technical detail for unexpected errors so it can be reported. */
export function describeError(e: unknown): string {
  const a = toAppError(e);
  return a.detail && (a.key === 'unknown' || a.key === 'server') ? `${a.message} (Details: ${a.detail})` : a.message;
}
