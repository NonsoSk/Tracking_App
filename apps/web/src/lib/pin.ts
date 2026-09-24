/**
 * Members use a 6-digit PIN, but Supabase applies the project's password rules
 * (length, required letters/symbols, sometimes a leaked-password check) to it.
 * The PIN is therefore stored as a fixed-format password that meets any of those
 * rules. It is exactly as strong as the PIN itself; Supabase's sign-in rate
 * limits are what protect it. Keep in sync with supabase/functions/admin-reset-pin.
 */
export function pinPassword(pin: string): string {
  return `Ipl#Pin-${pin}-Grv`;
}
