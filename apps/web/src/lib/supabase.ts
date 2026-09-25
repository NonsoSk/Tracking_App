import { createClient } from '@supabase/supabase-js';
import { config } from './config';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ipl-auth' },
  realtime: { params: { eventsPerSecond: 1 } },
});

/**
 * Sends Supabase sign-in link emails (staff invitations). A separate client that
 * keeps no session, so sending a link never touches the admin's own sign-in, and
 * uses the implicit flow so the link works on the invitee's own phone or computer.
 */
export const mailer = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit', storageKey: 'ipl-mailer' },
});
