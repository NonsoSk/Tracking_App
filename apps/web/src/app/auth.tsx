import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { config } from '@/lib/config';
import { AppError, toAppError } from '@/lib/errors';
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

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: secret });
    if (error) throw toAppError(error);
    setSession(data.session);
    await load(data.user.id);
    if (access && !access.is_active) throw new AppError('account_disabled');
  }, [load, access]);

  const signUp = useCallback(async (p: { fullName: string; phone: string; communityId: string; pin: string }) => {
    const e164 = normalizePhone(p.phone);
    if (!e164) throw new AppError('phone_invalid');
    if (!/^\d{6}$/.test(p.pin)) throw new AppError('weak_pin');
    const { data, error } = await supabase.auth.signUp({
      email: loginEmailFor(e164),
      password: p.pin,
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
    signIn, signUp, signOut,
    refresh: async () => { if (userId) await load(userId); },
  }), [ready, session, userId, access, profile, signIn, signUp, signOut, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
