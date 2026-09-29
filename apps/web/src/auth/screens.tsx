import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, MapPin, MessageSquareText, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useMasterData, useOnline } from '@/app/hooks';
import { Banner, Button, Field, Input, SearchInput, Stepper, ThemeSwitch, cx } from '@/design/ui';
import { IndoramaLogo } from '@/design/brand';
import { AppError, describeError, messageFor } from '@/lib/errors';
import { api } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';

const ONBOARDED = 'ipl.onboarded';
export const hasOnboarded = () => { try { return localStorage.getItem(ONBOARDED) === '1'; } catch { return true; } };
const markOnboarded = () => { try { localStorage.setItem(ONBOARDED, '1'); } catch { /* private mode */ } };

function AuthLayout({ children, back }: { children: React.ReactNode; back?: string }) {
  return (
    <div className="member min-h-dvh bg-canvas">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-4">
        <div className="flex h-12 items-center justify-between">
          {back ? <Link to={back} className="-ml-1 grid h-11 w-11 place-items-center rounded-full bg-surface text-ink-700 shadow-card hover:text-brand-700" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
                : <IndoramaLogo height={22} />}
          <ThemeSwitch />
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-ink-400">Indorama Eleme Petrochemicals Limited · Community Relations</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Welcome */
export function Welcome() {
  const nav = useNavigate();
  return (
    <AuthLayout>
      <div className="flex flex-1 flex-col animate-fade-up">
        <div className="mt-6 rounded-3xl bg-surface p-6 shadow-card">
          <IndoramaLogo height={27} plate={false} />
          <p className="mt-4 eyebrow text-brand-700">Grievance Portal</p>
          <p className="mt-1 text-[15px] text-ink-700">A direct, private line between your community and the Indorama Community Relations team.</p>
        </div>
        <h1 className="mt-8 text-[2rem] font-extrabold leading-tight tracking-[-0.02em] text-ink-900">We're listening.</h1>
        <p className="mt-3 text-lg text-ink-700">Tell Indorama Community Relations about a concern in your community, and follow it until it is resolved.</p>
        <ol className="mt-6 grid grid-cols-4 gap-2 text-center text-[13px] font-semibold text-ink-700">
          {['Submit', 'Track', 'Resolve', 'Confirm'].map((s, i) => (
            <li key={s} className="rounded-2xl bg-surface px-1 py-2.5 shadow-card"><span className={cx('mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full text-sm font-extrabold text-white', i === 3 ? 'bg-gold-500' : 'bg-btn')}>{i + 1}</span>{s}</li>
          ))}
        </ol>
        <div className="mt-auto space-y-3 pt-8">
          <Button size="lg" icon={UserRound} onClick={() => { markOnboarded(); nav('/signup'); }}>Create an account</Button>
          <Button size="lg" variant="secondary" icon={LogIn} onClick={() => { markOnboarded(); nav('/signin'); }}>I already have an account</Button>
        </div>
      </div>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ PIN input */
function PinInput({ id, value, onChange, autoFocus, invalid }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} value={value} inputMode="numeric" autoComplete="current-password" maxLength={6} autoFocus={autoFocus} invalid={invalid}
        type={show ? 'text' : 'password'} placeholder="••••••" className="h-14 pr-14 text-center text-2xl tracking-[.5em]"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-ink-500 hover:bg-sunken"
        aria-label={show ? 'Hide PIN' : 'Show PIN'}>{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ Community picker */
export function CommunityPicker({ value, onChange }: { value: string | null; onChange: (id: string, name: string) => void }) {
  const master = useMasterData();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const d = master.data;
    if (!d) return [];
    const typeName = new Map(d.community_types.map((t) => [t.id, t.name]));
    const clusterName = new Map(d.clusters.map((c) => [c.id, c.name]));
    const list = d.communities
      .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
      .map((c) => {
        const a = c.affiliations.find((x) => x.is_primary) ?? c.affiliations[0];
        return { ...c, group: a ? `${typeName.get(a.community_type_id)}${a.cluster_id ? ` · ${clusterName.get(a.cluster_id)}` : ''}` : 'Other' };
      });
    const byGroup = new Map<string, typeof list>();
    list.forEach((c) => byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]));
    return [...byGroup.entries()];
  }, [master.data, q]);

  if (master.isLoading) return <p className="py-6 text-center text-ink-500">Loading communities…</p>;
  if (!master.data) return <Banner tone="warning">We need a connection once to load the list of communities.</Banner>;
  return (
    <div className="space-y-3">
      <SearchInput placeholder="Search your community" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search communities" />
      <div className="max-h-[46vh] space-y-4 overflow-y-auto pr-1">
        {groups.map(([g, cs]) => (
          <fieldset key={g}>
            <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">{g}</legend>
            <div className="grid grid-cols-2 gap-2">
              {cs.map((c) => (
                <button type="button" key={c.id} onClick={() => onChange(c.id, c.name)} aria-pressed={value === c.id}
                  className={cx('flex min-h-12 items-center gap-2 rounded-xl px-3 text-left font-semibold ring-1 ring-inset transition-colors',
                    value === c.id ? 'bg-btn text-white ring-brand-700' : 'bg-surface text-ink-900 ring-line hover:bg-brand-50')}>
                  <MapPin className="h-4 w-4 shrink-0 opacity-70" aria-hidden />{c.name}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        {groups.length === 0 && <p className="py-4 text-center text-ink-500">No community matches "{q}".</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Sign up */
type SignUpStep = 'about' | 'verify' | 'community' | 'pin';

export function SignUp() {
  const { signUp } = useAuth();
  const nav = useNavigate();
  const online = useOnline();
  const master = useMasterData();
  // Phone confirmation by text message is on unless the administrator switched it off.
  const otpRequired = master.data?.settings?.phone_otp_required !== false;
  const flow: SignUpStep[] = otpRequired ? ['about', 'verify', 'community', 'pin'] : ['about', 'community', 'pin'];
  const labels: Record<SignUpStep, string> = { about: 'About you', verify: 'Confirm phone', community: 'Your community', pin: 'Choose a PIN' };
  const [step, setStep] = useState<SignUpStep>('about');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);      // number the last code went to
  const [verified, setVerified] = useState<string | null>(null);  // number confirmed
  const [resendAt, setResendAt] = useState(0);
  const [community, setCommunity] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idx = Math.max(0, flow.indexOf(step));
  const e164 = normalizePhone(phone);

  const sendCode = async () => {
    if (!e164) return;
    setError(null); setNotice(null); setBusy(true);
    try {
      await api.sendPhoneCode(e164);
      setSentTo(e164); setCode(''); setResendAt(Date.now() + 60_000);
      setNotice(`We sent a 6-digit code by text message to ${formatPhone(e164)}.`);
    } catch (err) {
      setError(describeError(err));
    } finally { setBusy(false); }
  };

  const next = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 'about') {
      if (name.trim().length < 2) return setError('Please enter your full name.');
      if (!e164) return setError('Please enter a valid phone number, e.g. 0803 123 4567.');
      if (!gender) return setError('Please choose your gender.');
      if (!otpRequired || verified === e164) return setStep('community');
      setStep('verify');
      if (sentTo !== e164) await sendCode();
      return;
    }
    if (step === 'verify') {
      if (!/^\d{6}$/.test(code)) return setError('Please enter the 6-digit code from the text message.');
      setBusy(true);
      try {
        const r = await api.verifyPhoneCode(e164!, code);
        if (!r.ok) {
          const msg = describeError(new AppError(r.error ?? 'otp_wrong'));
          return setError(r.error === 'otp_wrong' && r.tries_left != null ? `${msg} ${r.tries_left} ${r.tries_left === 1 ? 'try' : 'tries'} left.` : msg);
        }
        setVerified(e164); setNotice(null); setStep('community');
      } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
      return;
    }
    if (step === 'community') {
      if (!community) return setError('Please choose your community.');
      return setStep('pin');
    }
    if (pin.length !== 6) return setError('Your PIN must be 6 digits.');
    if (pin !== pin2) return setError("The two PINs don't match.");
    setBusy(true);
    signUp({ fullName: name, phone, communityId: community!.id, pin, gender: gender || null })
      .then(() => nav('/', { replace: true }))
      .catch((err) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  const back = () => {
    setError(null); setNotice(null);
    setStep(flow[Math.max(0, idx - 1)] === 'verify' && verified === e164 ? 'about' : flow[Math.max(0, idx - 1)]);
  };

  return (
    <AuthLayout back={step === 'about' ? '/welcome' : undefined}>
      <form onSubmit={next} className="flex flex-1 flex-col gap-6" noValidate>
        <div>
          <h1 className="text-2xl font-bold">Create your account</h1>
          <div className="mt-4"><Stepper steps={flow.map((f) => labels[f])} current={idx} /></div>
        </div>
        {step === 'about' && (
          <div className="space-y-5 animate-fade-up">
            <Field label="Full name" htmlFor="name"><Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field label="Phone number" htmlFor="phone" hint={otpRequired ? "We'll text you a code to confirm it's your number." : "We'll use it to let you know when your grievance is resolved."}>
              <div className="relative"><Phone className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" aria-hidden />
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" className="pl-12" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </Field>
            <fieldset>
              <legend className="mb-1.5 block font-bold text-ink-900">Gender</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {([['male', 'Male'], ['female', 'Female']] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={gender === v} onClick={() => setGender(v)}
                    className={cx('min-h-12 rounded-2xl px-2 py-2 text-[15px] font-bold transition-colors', gender === v ? 'bg-btn text-white shadow-halo' : 'bg-surface text-ink-700 shadow-card')}>{l}</button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        {step === 'verify' && (
          <div className="space-y-5 animate-fade-up">
            <p className="flex items-start gap-2 text-ink-700"><MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
              <span>Enter the 6-digit code we sent by text message to <strong className="text-ink-900">{e164 ? formatPhone(e164) : phone}</strong>.</span></p>
            <Field label="Code" htmlFor="otp">
              <Input id="otp" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="••••••"
                className="h-14 text-center text-2xl tracking-[.5em]" onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
              <ResendButton at={resendAt} busy={busy} onResend={sendCode} />
              <button type="button" className="font-semibold text-brand-700 underline-offset-2 hover:underline" onClick={() => { setError(null); setNotice(null); setStep('about'); }}>Change number</button>
            </div>
          </div>
        )}
        {step === 'community' && <div className="animate-fade-up"><p className="mb-3 text-ink-700">Which community do you live in?</p><CommunityPicker value={community?.id ?? null} onChange={(id, n) => setCommunity({ id, name: n })} /></div>}
        {step === 'pin' && (
          <div className="space-y-5 animate-fade-up">
            <p className="flex items-start gap-2 text-ink-700"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />Choose a 6-digit PIN. You'll use it with your phone number to sign in. Don't share it.</p>
            <Field label="PIN" htmlFor="pin"><PinInput id="pin" value={pin} onChange={setPin} autoFocus /></Field>
            <Field label="Type the PIN again" htmlFor="pin2"><PinInput id="pin2" value={pin2} onChange={setPin2} /></Field>
          </div>
        )}
        {notice && !error && <Banner tone="info">{notice}</Banner>}
        {error && <Banner tone="warning">{error}</Banner>}
        {!online && <Banner tone="warning">You're offline. Creating an account needs a connection.</Banner>}
        <div className="mt-auto flex gap-3">
          {idx > 0 && <Button type="button" variant="secondary" size="lg" className="!w-auto" onClick={back} icon={ArrowLeft}><span className="sr-only">Back</span></Button>}
          <Button type="submit" size="lg" loading={busy} iconRight={step !== 'pin' ? ArrowRight : undefined} disabled={!online && (step === 'pin' || step === 'verify')}>
            {step === 'pin' ? 'Create account' : step === 'verify' ? 'Confirm' : 'Continue'}
          </Button>
        </div>
        <p className="text-center text-ink-500">Already have an account? <Link to="/signin" className="font-semibold text-brand-700 underline-offset-2 hover:underline">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

function formatPhone(e164: string) {
  const d = '0' + e164.slice(4);
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

/** "Send a new code", available a minute after the last one. */
function ResendButton({ at, busy, onResend }: { at: number; busy: boolean; onResend: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (at <= now) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [at, now]);
  const wait = Math.ceil((at - now) / 1000);
  if (wait > 0) return <span className="text-ink-500">Send a new code in {wait}s</span>;
  return <button type="button" disabled={busy} onClick={onResend} className="font-semibold text-brand-700 underline-offset-2 hover:underline disabled:opacity-50">Send a new code</button>;
}

/* ------------------------------------------------------------------ Sign in */
export function SignIn() {
  const { signIn, linkError } = useAuth();
  const nav = useNavigate();
  const online = useOnline();
  const [identifier, setIdentifier] = useState(() => { try { return localStorage.getItem('ipl.lastLogin') ?? ''; } catch { return ''; } });
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEmail = identifier.includes('@');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !secret) return setError('Please enter your phone number (or email) and PIN.');
    setBusy(true);
    signIn(identifier, secret)
      .then(() => { try { localStorage.setItem('ipl.lastLogin', identifier.trim()); } catch { /* ignore */ } nav('/', { replace: true }); })
      .catch((err) => setError(describeError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <AuthLayout back={hasOnboarded() ? undefined : '/welcome'}>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-6 animate-fade-up" noValidate>
        <div className="pt-4">
          <h1 className="text-[28px] font-bold">Welcome back</h1>
          <p className="mt-1 text-ink-700">Sign in to submit and follow your grievances.</p>
        </div>
        <Field label="Phone number" htmlFor="identifier" hint="Staff: use your work email.">
          <Input id="identifier" type={isEmail ? 'email' : 'tel'} inputMode={isEmail ? 'email' : 'tel'} autoComplete="username"
            placeholder="0803 123 4567" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus={!identifier} />
        </Field>
        <Field label={isEmail ? 'Password' : 'PIN'} htmlFor="secret">
          {isEmail
            ? <Input id="secret" type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            : <PinInput id="secret" value={secret} onChange={setSecret} autoFocus={!!identifier} />}
        </Field>
        {linkError && !error && <Banner tone="warning">{messageFor(linkError)}</Banner>}
        {error && <Banner tone="warning">{error}</Banner>}
        {!online && <Banner tone="warning">You're offline. Signing in needs a connection.</Banner>}
        <div className="mt-auto space-y-4">
          <Button type="submit" size="lg" loading={busy} icon={LogIn} disabled={!online}>Sign in</Button>
          <p className="text-center text-ink-500">New here? <Link to="/signup" className="font-semibold text-brand-700 underline-offset-2 hover:underline">Create an account</Link></p>
          <p className="text-center text-sm text-ink-500">Forgot your PIN? Please visit or call the Community Relations office to reset it.</p>
        </div>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ Set password (invited staff) */
export function SetPassword() {
  const { profile, refresh, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checks = [
    { ok: pw.length >= 10, label: 'At least 10 characters' },
    { ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), label: 'Capital and small letters' },
    { ok: /\d/.test(pw), label: 'A number' },
    { ok: /[^A-Za-z0-9]/.test(pw), label: 'A symbol, e.g. # or !' },
  ];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (checks.some((c) => !c.ok)) return setError('Please choose a password that meets all the points below.');
    if (pw !== pw2) return setError('The two passwords are different. Please type them again.');
    setBusy(true);
    try { await api.setMyPassword(pw); await refresh(); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-5 animate-fade-up" noValidate>
        <div className="pt-4">
          <p className="eyebrow text-brand-700">Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</p>
          <h1 className="text-[28px] font-extrabold leading-tight">Choose your password</h1>
          <p className="mt-1 text-ink-700">You were invited to the Indorama Grievance Portal. Set a password to finish. Next time, sign in with <b>{profile?.email}</b> and this password.</p>
        </div>
        <Field label="New password" htmlFor="npw">
          <Input id="npw" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Field label="Type it again" htmlFor="npw2">
          <Input id="npw2" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={show} onChange={(e) => setShow(e.target.checked)} />Show password</label>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {checks.map((c) => (
            <li key={c.label} className={cx('flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-semibold', c.ok ? 'bg-success-soft text-success' : 'bg-sunken text-ink-500')}>
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />{c.label}
            </li>
          ))}
        </ul>
        {error && <Banner tone="warning">{error}</Banner>}
        <div className="mt-auto space-y-3">
          <Button type="submit" size="lg" loading={busy}>Save password and continue</Button>
          <Button type="button" size="lg" variant="ghost" onClick={() => signOut()}>Not you? Sign out</Button>
        </div>
      </form>
    </AuthLayout>
  );
}
