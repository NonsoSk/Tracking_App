import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { AppError, toAppError } from '@/lib/errors';
import { pinPassword } from '@/lib/pin';
import { normalizePhone } from '@/lib/phone';
import type { Access, Profile } from '@/lib/types';
import { cacheGet, cachePut, clearUserData } from '@/offline/db';

const STAFF_ROLES = ['super_admin', 'officer', 'supervisor', 'cr_staff', 'data_entry', 'viewer'];

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  access: Access | null;
  profile: Profile | null;
  isStaff: boolean;
  can: (perm: string) => boolean;
  hasRole: (role: string) => boolean;
  signIn: (identifier: string, secret: string) => Promise<void>;
  signUp: (p: { fullName: string; phone: string; communityId: string; pin: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Set when an emailed sign-in link could not be used (expired or already used). */
  linkError: string | null;
}

/**
 * Invitation emails bring people back with the session in the address
 * (#access_token=…), or an error (#error=…). Use it once, then tidy the address.
 */
async function consumeEmailLink(): Promise<string | null> {
  const h = typeof window !== 'undefined' ? window.location.hash : '';
  if (!h || h.length < 2) return null;
  const p = new URLSearchParams(h.slice(1));
  const at = p.get('access_token'); const rt = p.get('refresh_token');
  const failed = p.get('error') || p.get('error_code');
  if (!at && !failed) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (failed) return 'link_expired';
  const { error } = await supabase.auth.setSession({ access_token: at!, refresh_token: rt ?? '' });
  return error ? 'link_expired' : null;
}

const Ctx = createContext<AuthState | null>(null);

/** Members sign in with a phone number; it maps to a never-emailed login address. */
export function loginEmailFor(identifier: string): string {
  const id = identifier.trim();
  if (id.includes('@')) return id.toLowerCase();
  const e164 = normalizePhone(id);
  if (!e164) throw new AppError('phone_invalid');
  return `${e164.slice(1)}@${config.memberLoginDomain}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const userId = session?.user.id ?? null;

  const load = useCallback(async (uid: string) => {
    // Cached copies let the app open with no signal.
    const [ca, cp] = await Promise.all([cacheGet<Access>(`access:${uid}`), cacheGet<Profile>(`profile:${uid}`)]);
    if (ca) setAccess(ca.value);
    if (cp) setProfile(cp.value);
    try {
      const [a, p] = await Promise.all([api.myAccess(), api.myProfile()]);
      setAccess(a); setProfile(p);
      await Promise.all([cachePut(`access:${uid}`, a), cachePut(`profile:${uid}`, p)]);
    } catch (e) {
      if (!ca) throw e;
    }
  }, []);

  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    consumeEmailLink().then((e) => { if (e) setLinkError(e); }).then(() => supabase.auth.getSession()).then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) { try { await load(data.session.user.id); } catch { /* shown by screens */ } }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setAccess(null); setProfile(null); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const signIn = useCallback(async (identifier: string, secret: string) => {
    const email = loginEmailFor(identifier);
    const isPin = email.endsWith(`@${config.memberLoginDomain}`) && /^\d{6}$/.test(secret);
    let { data, error } = await supabase.auth.signInWithPassword({ email, password: isPin ? pinPassword(secret) : secret });
    // Accounts created before PINs were stored in the password-safe format use the bare PIN.
    if (error && isPin && /invalid login credentials/i.test(error.message)) {
      ({ data, error } = await supabase.auth.signInWithPassword({ email, password: secret }));
    }
    if (error || !data.session) throw toAppError(error);
    setSession(data.session);
    await load(data.session.user.id);
    if (access && !access.is_active) throw new AppError('account_disabled');
  }, [load, access]);

  const signUp = useCallback(async (p: { fullName: string; phone: string; communityId: string; pin: string }) => {
    const e164 = normalizePhone(p.phone);
    if (!e164) throw new AppError('phone_invalid');
    if (!/^\d{6}$/.test(p.pin)) throw new AppError('weak_pin');
    const { data, error } = await supabase.auth.signUp({
      email: loginEmailFor(e164),
      password: pinPassword(p.pin),
      options: { data: { full_name: p.fullName.trim(), phone: e164, community_id: p.communityId } },
    });
    if (error) throw toAppError(error);
    if (!data.session) throw new AppError('unknown', 'Your account was created. Please sign in.');
    setSession(data.session);
    await load(data.session.user.id);
  }, [load]);

  const signOut = useCallback(async () => {
    const uid = userId;
    await supabase.auth.signOut().catch(() => {});
    if (uid) await clearUserData(uid);
    setSession(null); setAccess(null); setProfile(null);
  }, [userId]);

  const value = useMemo<AuthState>(() => ({
    ready, session, userId, access, profile,
    isStaff: !!access?.roles.some((r) => STAFF_ROLES.includes(r)),
    can: (perm) => !!access && (access.roles.includes('super_admin') || access.permissions.includes(perm)),
    hasRole: (role) => !!access?.roles.includes(role),
    signIn, signUp, signOut, linkError,
    refresh: async () => { if (userId) await load(userId); },
  }), [ready, session, userId, access, profile, signIn, signUp, signOut, load, linkError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
