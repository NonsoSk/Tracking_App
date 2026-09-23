// Public configuration only. The anon key is designed to be public; every
// permission is enforced by the database (RLS + checked functions).
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'dev-anon-key',
  // Community members sign in with phone + PIN. Supabase Auth keys accounts by
  // email, so the phone maps to a stable, never-emailed login address. This
  // avoids depending on an SMS provider for sign-up.
  memberLoginDomain: import.meta.env.VITE_MEMBER_LOGIN_DOMAIN ?? 'members.iplgrievance.app',
  supportPhone: import.meta.env.VITE_SUPPORT_PHONE ?? '',
};
