/** Nigerian mobile numbers: 0803 123 4567, 803 123 4567, +234 803 123 4567 -> +2348031234567 */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (/^234[789][01]\d{8}$/.test(d)) return `+${d}`;
  if (/^0[789][01]\d{8}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^[789][01]\d{8}$/.test(d)) return `+234${d}`;
  return null;
}

/** +2348031234567 -> 0803 123 4567 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = e164.match(/^\+234(\d{3})(\d{3})(\d{4})$/);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
