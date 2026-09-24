import { createPortal } from 'react-dom';
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react';
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDot, Clock, Inbox, Loader2, Lock, Moon, RefreshCw, Search, Sun, X, type LucideIcon,
} from 'lucide-react';
import type { Tone } from '@/lib/types';
import { useTheme } from '@/app/theme';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* ---------------------------------------------------------------- Button */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'md' | 'lg' | 'sm';
const variants: Record<Variant, string> = {
  primary: 'bg-btn text-white hover:bg-btn-hover active:bg-btn-hover shadow-cta disabled:bg-ink-300 disabled:text-white/80 disabled:shadow-none',
  accent: 'bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700 shadow-[0_6px_16px_rgb(192_0_0/0.25)] disabled:bg-ink-300 disabled:shadow-none',
  secondary: 'bg-surface text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 active:bg-brand-100 disabled:text-ink-400 disabled:ring-line',
  ghost: 'text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:text-ink-400',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80 disabled:bg-ink-300',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm rounded-full gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-full gap-2',
  lg: 'h-14 px-6 text-[17px] rounded-full gap-2.5 w-full',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: LucideIcon; iconRight?: LucideIcon;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon: Icon, iconRight: IconRight, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      className={cx('inline-flex items-center justify-center font-bold transition-[background,box-shadow,transform] duration-150',
        'active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100', variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight className="h-5 w-5 shrink-0" aria-hidden /> : null}
    </button>
  );
});

/* ---------------------------------------------------------------- Card */
export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return <As className={cx('rounded-2xl bg-surface shadow-card', className)} {...rest}>{children}</As>;
}

/* ---------------------------------------------------------------- Fields */
export function Field({ label, hint, error, children, htmlFor, optional }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-bold text-ink-900">
        {label} {optional && <span className="font-normal text-ink-500">(optional)</span>}
      </label>
      {hint && <p className="text-sm text-ink-500">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

const inputBase = 'w-full rounded-xl bg-surface px-4 text-ink-900 ring-1 ring-inset ring-line-strong placeholder:text-ink-400 transition-shadow focus:outline-none focus:ring-2 focus:ring-sky focus:shadow-halo disabled:bg-sunken';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-12', invalid && 'ring-2 ring-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'min-h-[140px] py-3 leading-relaxed', invalid && 'ring-2 ring-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
});
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputBase, 'h-11 pr-8 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat', className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236B7390' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
    {...rest}>{children}</select>;
}
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" aria-hidden />
      <Input type="search" className="h-11 pl-11" {...props} />
    </div>
  );
}

/* ---------------------------------------------------------------- Status */
const toneClass: Record<Tone, string> = {
  neutral: 'bg-muted-soft text-ink-700', muted: 'bg-muted-soft text-ink-700',
  info: 'bg-info-soft text-info', progress: 'bg-progress-soft text-progress',
  warning: 'bg-warning-soft text-warning', success: 'bg-success-soft text-success', danger: 'bg-danger-soft text-danger',
};
const toneIcon: Record<Tone, LucideIcon> = {
  neutral: CircleDot, muted: Lock, info: Inbox, progress: RefreshCw, warning: Clock, success: CheckCircle2, danger: AlertTriangle,
};
/** Status is always icon + word, never colour alone. */
export function StatusBadge({ label, tone = 'neutral', size = 'md', icon }: { label: string; tone?: Tone; size?: 'sm' | 'md'; icon?: LucideIcon }) {
  const Icon = icon ?? toneIcon[tone];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold', toneClass[tone],
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]')}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> {label}
    </span>
  );
}
export function OverdueBadge({ days }: { days?: number | null }) {
  return <StatusBadge tone="danger" size="sm" icon={AlertTriangle} label={days != null ? `Overdue · ${days}d` : 'Overdue'} />;
}

/* ---------------------------------------------------------------- Feedback */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-10 text-ink-500"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /><span>{label}…</span></div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-sunken', className)} aria-hidden />;
}
export function EmptyState({ icon: Icon = Inbox, title, body, action, art }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-up">
      {art ?? (
        <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-[#3D7BF0] to-[#00257A] text-white shadow-[inset_0_2px_0_rgb(255_255_255/0.25),0_12px_24px_rgb(0_51_161/0.25)] float-3d">
          <span className="absolute left-3 top-2.5 h-3 w-5 rounded-full bg-white/40 blur-[2px]" />
          <Icon className="h-9 w-9" aria-hidden />
        </div>
      )}
      <h3 className="text-lg font-extrabold text-ink-900">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-ink-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function Banner({ tone = 'info', icon: Icon, title, children, action }: { tone?: Tone; icon?: LucideIcon; title?: string; children?: ReactNode; action?: ReactNode }) {
  const I = Icon ?? toneIcon[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-2xl px-4 py-3', toneClass[tone])}>
      <I className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx('text-[15px]', title ? 'text-ink-700' : '')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="p-4"><Banner tone="warning" title="Couldn't load this" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry} icon={RefreshCw}>Try again</Button>}>{message}</Banner></div>;
}

/* ---------------------------------------------------------------- Modal / confirm */
/**
 * Panels: a bottom sheet on phones; on larger screens a drawer from the right
 * (or a small centred card for short confirmations, `center`).
 */
export function Modal({ open, onClose, title, children, footer, wide, center }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; center?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  // Portal: page wrappers animate with transforms, which would trap a fixed overlay inside them.
  return createPortal(
    <div className={cx('fixed inset-0 z-50 flex items-end justify-center bg-[#0B1224]/45 backdrop-blur-[3px] p-0',
      center ? 'sm:items-center sm:p-4' : 'sm:items-stretch sm:justify-end')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-raised animate-sheet-up',
          center ? 'sm:max-w-md sm:rounded-3xl sm:animate-pop'
                 : cx('sm:max-h-none sm:h-full sm:rounded-none sm:rounded-l-3xl sm:animate-slide-in', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'))}>
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3 sm:pt-5">
          <h2 id={titleId} className="text-lg font-extrabold">{title}</h2>
          <button data-close onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-sunken text-ink-700 hover:bg-brand-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && <div className="flex shrink-0 flex-col-reverse gap-2 bg-surface px-5 py-4 shadow-[0_-8px_24px_rgb(var(--shadow)/0.06)] sm:flex-row sm:justify-end safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} center
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {body && <div className="text-ink-700">{body}</div>}
      {children}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Toasts */
type ToastAction = { label: string; run: () => void };
type ToastItem = { id: number; tone: Tone; text: string; action?: ToastAction };
const ToastCtx = createContext<(text: string, tone?: Tone, action?: ToastAction) => void>(() => {});
/** Dark rounded message at the bottom. An optional action (e.g. "Undo") keeps it up a little longer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((text: string, tone: Tone = 'success', action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text, action }]);
    setTimeout(() => dismiss(id), action ? 7000 : 4000);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl bg-[#1A1F36] px-4 py-3 font-semibold text-white shadow-raised ring-1 ring-white/10 animate-fade-up">
            {t.tone === 'success'
              ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#0F8A4A]"><Check className="h-4 w-4" aria-hidden /></span>
              : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#C8312B]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /></span>}
            <span className="flex-1">{t.text}</span>
            {t.action && <button onClick={() => { t.action!.run(); dismiss(t.id); }} className="-my-1 rounded-full px-3 py-1 font-extrabold text-[#8FB0FF] hover:bg-white/10">{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------------------------------------------------------- Stepper */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <li key={s} className="flex-1" aria-current={i === current ? 'step' : undefined}>
            <div className={cx('h-1.5 rounded-full transition-colors duration-300', i < current ? 'bg-btn' : i === current ? 'bg-sky' : 'bg-line')} />
            <span className="sr-only">{`Step ${i + 1}: ${s}${i < current ? ' (done)' : ''}`}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm font-bold text-ink-500">Step {current + 1} of {steps.length} · <span className="text-ink-900">{steps[current]}</span></p>
    </nav>
  );
}

/* ---------------------------------------------------------------- Tabs */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex w-full gap-1 overflow-x-auto rounded-full bg-surface p-1 shadow-card scrollbar-none sm:w-auto">
      {items.map((it) => {
        const on = value === it.value;
        return (
          <button key={it.value} role="tab" aria-selected={on} onClick={() => onChange(it.value)}
            className={cx('flex h-9 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold transition-colors sm:flex-none',
              on ? 'bg-btn text-white shadow-cta' : 'text-ink-500 hover:text-brand-700')}>
            {it.label}{it.count != null && <span className={cx('min-w-5 rounded-full px-1.5 text-xs tabular', on ? 'bg-white/20 text-white' : 'bg-sunken text-ink-700')}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Misc */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-lg bg-sunken px-2 py-0.5 font-mono text-[15px] font-bold tracking-[0.08em] text-ink-900">{children}</span>;
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx('inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition-colors',
        active ? 'bg-btn text-white shadow-halo' : 'bg-surface text-ink-700 shadow-card hover:text-brand-700')}>
      {children}
    </button>
  );
}


/* ---------------------------------------------------------------- Theme switch */
/** Sun / moon switch; the knob bounces when it moves. */
export function ThemeSwitch({ onBlue }: { onBlue?: boolean }) {
  const [theme, toggle] = useTheme();
  const dark = theme === 'dark';
  return (
    <button onClick={toggle} role="switch" aria-checked={dark} aria-label="Dark mode" title={dark ? 'Switch to light' : 'Switch to dark'}
      className={cx('relative inline-flex h-8 w-[58px] shrink-0 items-center rounded-full p-1 transition-colors',
        onBlue ? 'bg-white/15 ring-1 ring-inset ring-white/25' : 'bg-sunken ring-1 ring-inset ring-line')}>
      <Sun className={cx('absolute left-2 h-3.5 w-3.5', onBlue ? 'text-white/70' : 'text-ink-400')} aria-hidden />
      <Moon className={cx('absolute right-2 h-3.5 w-3.5', onBlue ? 'text-white/70' : 'text-ink-400')} aria-hidden />
      <span key={theme} className={cx('relative z-10 grid h-6 w-6 place-items-center rounded-full bg-white shadow-card transition-transform duration-300 animate-knob',
        dark ? 'translate-x-[26px]' : 'translate-x-0')}>
        {dark ? <Moon className="h-3.5 w-3.5 text-[#0A2A82]" aria-hidden /> : <Sun className="h-3.5 w-3.5 text-[#B0700E]" aria-hidden />}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- Progress ring */
export function ProgressRing({ value, max = 100, size = 64, stroke = 7, tone = 'brand', label, children, onBlue }: {
  value: number; max?: number; size?: number; stroke?: number; tone?: 'brand' | 'gold' | 'success' | 'danger'; label?: string; children?: ReactNode; onBlue?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const col = onBlue ? '#FFFFFF' : { brand: 'rgb(var(--brand-700))', gold: 'rgb(var(--gold-500))', success: 'rgb(var(--success))', danger: 'rgb(var(--danger))' }[tone];
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(pct * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={onBlue ? 'rgb(255 255 255 / 0.2)' : 'rgb(var(--sunken))'} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={col} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s ease-out' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">{children ?? <span className="text-sm font-extrabold tabular">{Math.round(pct * 100)}%</span>}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Stat tile */
export function StatTile({ label, value, of, tone = 'brand', icon: Icon, hint, onClick }: {
  label: string; value: number | string; of?: number; tone?: 'brand' | 'gold' | 'success' | 'warning' | 'danger'; icon?: LucideIcon; hint?: ReactNode; onClick?: () => void;
}) {
  const bar = { brand: 'bg-btn', gold: 'bg-gold-500', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  const pct = of && typeof value === 'number' ? Math.min(100, (value / of) * 100) : null;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('flex flex-col gap-2 rounded-2xl bg-surface p-4 text-left shadow-card', onClick && 'transition-shadow hover:shadow-raised focus-visible:shadow-halo')}>
      <span className="flex items-center gap-2 text-[13px] font-bold text-ink-500">{Icon && <Icon className="h-4 w-4" aria-hidden />}{label}</span>
      <span className="text-[1.6rem] font-extrabold leading-none tabular text-ink-900">{value}{of != null && <span className="text-base font-bold text-ink-400">/{of}</span>}</span>
      {pct != null && <span className="h-1.5 overflow-hidden rounded-full bg-sunken"><span className={cx('block h-full rounded-full', bar)} style={{ width: `${pct}%` }} /></span>}
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </Tag>
  );
}

/* ---------------------------------------------------------------- Quick actions */
export function QuickActions({ items }: { items: { label: string; icon: LucideIcon; onClick?: () => void; href?: string; badge?: number; tone?: 'brand' | 'red' | 'gold' }[] }) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {items.map((it) => {
        const bg = it.tone === 'red' ? 'from-[#E03A3A] to-[#C00000]' : it.tone === 'gold' ? 'from-[#D4952F] to-[#B0700E]' : 'from-[#3D7BF0] to-[#00257A]';
        const inner = (<>
          <span className={cx('relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br text-white shadow-[inset_0_2px_0_rgb(255_255_255/0.3),0_8px_16px_rgb(var(--shadow)/0.18)] transition-transform group-active:scale-95', bg)}>
            <span className="absolute left-3 top-2 h-2.5 w-4 rounded-full bg-white/35 blur-[1.5px]" aria-hidden />
            <it.icon className="h-6 w-6" aria-hidden />
            {!!it.badge && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-accent-500 px-1 text-center text-[11px] font-extrabold leading-5 text-white ring-2 ring-canvas">{it.badge}</span>}
          </span>
          <span className="text-center text-[12px] font-bold leading-tight text-ink-700">{it.label}</span>
        </>);
        const cls = 'group flex flex-col items-center gap-1.5 rounded-2xl py-1';
        return it.href
          ? <a key={it.label} href={it.href} onClick={(e) => { if (it.onClick) { e.preventDefault(); it.onClick(); } }} className={cls}>{inner}</a>
          : <button key={it.label} onClick={it.onClick} className={cls}>{inner}</button>;
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Pill, avatar, next step, checkbox */
export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'gold' | 'red'; className?: string }) {
  const t = { neutral: 'bg-sunken text-ink-700', brand: 'bg-brand-100 text-brand-700', gold: 'bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-200', red: 'bg-accent-50 text-accent-600' }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', t, className)}>{children}</span>;
}

export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#3D7BF0] to-[#0033A1] font-extrabold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]"
      style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>{initials}</span>
  );
}

/** "What to do next" box: every screen tells people the next step. */
export function NextStep({ children, action, tone = 'brand' }: { children: ReactNode; action?: ReactNode; tone?: 'brand' | 'gold' | 'danger' }) {
  const t = { brand: 'bg-brand-50 ring-brand-200 text-brand-700', gold: 'bg-gold-50 ring-gold-200 text-gold-700', danger: 'bg-danger-soft ring-danger/25 text-danger' }[tone];
  return (
    <div className={cx('flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset sm:flex-row sm:items-center', t)}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <ArrowRight className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0"><p className="eyebrow">Next step</p><div className="mt-0.5 font-semibold text-ink-900">{children}</div></div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, strike, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; strike?: boolean; disabled?: boolean }) {
  return (
    <label className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors peer-focus-visible:shadow-halo',
        checked ? 'bg-btn' : 'bg-surface ring-2 ring-inset ring-line-strong')} aria-hidden>
        {checked && <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-draw" /></svg>}
      </span>
      <span className={cx('text-[15px] transition-colors', checked && strike ? 'text-ink-400 line-through' : 'text-ink-900')}>{label}</span>
    </label>
  );
}

/**
 * Destructive actions confirm on the page, next to the button, instead of in a pop-up.
 * First tap arms it; a second tap on "Yes, …" runs it. "Keep" cancels.
 */
export function InlineConfirm({ label, confirmLabel, onConfirm, loading, icon, size = 'sm', question }: {
  label: string; confirmLabel: string; onConfirm: () => void; loading?: boolean; icon?: LucideIcon; size?: Size; question?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Button size={size} variant="secondary" icon={icon} onClick={() => setArmed(true)} className="!text-danger !ring-danger/30">{label}</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-full bg-danger-soft py-1 pl-3 pr-1 animate-fade-up">
      <span className="text-sm font-bold text-danger">{question ?? 'Are you sure?'}</span>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>Keep</Button>
      <Button size="sm" variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
    </span>
  );
}

/** Section heading with an optional "see all" link or action on the right. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-extrabold">{children}</h2>{action}</div>;
}
