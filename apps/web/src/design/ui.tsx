import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react';
import {
  AlertTriangle, Check, CheckCircle2, CircleDot, Clock, Inbox, Loader2, Lock, RefreshCw, Search, X, type LucideIcon,
} from 'lucide-react';
import type { Tone } from '@/lib/types';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* ---------------------------------------------------------------- Button */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type Size = 'md' | 'lg' | 'sm';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-cta disabled:bg-ink-300 disabled:shadow-none',
  accent: 'bg-accent-500 text-ink-900 hover:bg-accent-600 active:bg-accent-700 disabled:bg-ink-300',
  secondary: 'bg-surface text-brand-800 ring-1 ring-inset ring-line hover:bg-brand-50 active:bg-brand-100 disabled:text-ink-400',
  ghost: 'text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:text-ink-400',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80 disabled:bg-ink-300',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-xl gap-2',
  lg: 'h-14 px-6 text-[17px] rounded-2xl gap-2.5 w-full',
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
      className={cx('inline-flex items-center justify-center font-semibold transition-[background,box-shadow,transform] duration-150',
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
  return <As className={cx('rounded-2xl bg-surface shadow-card ring-1 ring-line/70', className)} {...rest}>{children}</As>;
}

/* ---------------------------------------------------------------- Fields */
export function Field({ label, hint, error, children, htmlFor, optional }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-semibold text-ink-900">
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

const inputBase = 'w-full rounded-xl bg-surface px-4 text-ink-900 ring-1 ring-inset ring-line placeholder:text-ink-400 transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-canvas';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-12', invalid && 'ring-2 ring-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'min-h-[140px] py-3 leading-relaxed', invalid && 'ring-2 ring-danger', className)} aria-invalid={invalid || undefined} {...rest} />;
});
export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputBase, 'h-11 pr-8 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat', className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23686358' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
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
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold', toneClass[tone],
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
  return <div className={cx('animate-pulse rounded-xl bg-line/60', className)} aria-hidden />;
}
export function EmptyState({ icon: Icon = Inbox, title, body, action, art }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-up">
      {art ?? (
        <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-b from-brand-50 to-brand-100 shadow-[inset_0_-6px_12px_rgb(15_94_91/0.12),0_10px_20px_rgb(15_94_91/0.10)]">
          <Icon className="h-9 w-9 text-brand-700" aria-hidden />
        </div>
      )}
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
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
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
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
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cx('max-h-[92vh] w-full overflow-auto rounded-t-3xl bg-surface shadow-raised animate-fade-up sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button data-close onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-ink-500 hover:bg-canvas" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-4 sm:flex-row sm:justify-end safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, loading, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {body && <div className="text-ink-700">{body}</div>}
      {children}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Toasts */
type ToastItem = { id: number; tone: Tone; text: string };
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-3 font-medium shadow-raised animate-fade-up',
            t.tone === 'danger' || t.tone === 'warning' ? 'bg-ink-900 text-white' : 'bg-ink-900 text-white')}>
            {t.tone === 'success' ? <Check className="h-5 w-5 text-accent-500" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-accent-500" aria-hidden />}
            {t.text}
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
            <div className={cx('h-1.5 rounded-full transition-colors duration-300', i < current ? 'bg-brand-600' : i === current ? 'bg-accent-500' : 'bg-line')} />
            <span className="sr-only">{`Step ${i + 1}: ${s}${i < current ? ' (done)' : ''}`}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm font-medium text-ink-500">Step {current + 1} of {steps.length} · <span className="text-ink-900">{steps[current]}</span></p>
    </nav>
  );
}

/* ---------------------------------------------------------------- Tabs */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1 scrollbar-none">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx('flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors',
            value === it.value ? 'bg-surface text-brand-800 shadow-card' : 'text-ink-500 hover:text-ink-900')}>
          {it.label}{it.count != null && <span className="rounded-full bg-line px-1.5 text-xs tabular">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Misc */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-canvas px-2 py-0.5 font-mono text-[15px] font-semibold tracking-wide text-ink-900 ring-1 ring-line">{children}</span>;
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx('inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset transition-colors',
        active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-surface text-ink-700 ring-line hover:bg-brand-50')}>
      {children}
    </button>
  );
}
