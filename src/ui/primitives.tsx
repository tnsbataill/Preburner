import { X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from 'react';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="label">{children}</h2>
      {action}
    </div>
  );
}

export function Chip({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', className)}
      style={color ? { color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';
export function Button({ variant = 'outline', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'ember-bg text-white shadow-glow hover:brightness-110',
    outline: 'border border-line bg-surface hover:bg-raised text-ink',
    ghost: 'text-muted hover:text-ink hover:bg-raised',
    danger: 'border border-bad/40 text-bad hover:bg-bad/10',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A button that asks for confirmation in place. Native confirm() dialogs are
 * silently suppressed in some embedded browsers and installed web apps
 * (they return false without showing), which made actions do nothing.
 */
export function ConfirmButton({
  message,
  confirmLabel,
  onConfirm,
  variant = 'danger',
  children,
  disabled,
  className,
}: {
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: Variant;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <Button variant={variant} disabled={disabled} className={className} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirm">
      <span className="text-sm text-muted">{message}</span>
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        autoFocus
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-raised/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[10px] font-medium transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Ring({ value, max, color, size = 64, stroke = 7, children }: { value: number; max: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Bar({ value, max, color, className, marker }: { value: number; max: number; color: string; className?: string; marker?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cx('relative h-1.5 w-full overflow-hidden rounded-full bg-line/70', className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: color }} />
      {marker !== undefined && max > 0 && <div className="absolute top-0 h-full w-0.5 bg-ink/70" style={{ left: `${Math.min(1, marker / max) * 100}%` }} />}
    </div>
  );
}

export function Stat({ label, value, unit, sub, className }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="label mb-1">{label}</div>
      <div className="num text-xl font-semibold tracking-tight">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl animate-fade-up sm:max-w-lg sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-line bg-raised/50 px-3 py-2 text-sm outline-none transition placeholder:text-faint focus:border-ember/60 focus:ring-2 focus:ring-ember/20';

export function NumberInput({ value, onChange, step = 1, min, max, suffix, ...rest }: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; suffix?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        className={cx(inputCls, 'num', suffix && 'pr-12')}
        value={value ?? ''}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
}

export function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="w-full" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num w-20 shrink-0 text-right text-sm font-medium">{format ? format(value) : value}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-1 text-left">
      <span className="text-sm">{label}</span>
      <span className={cx('relative h-6 w-10 shrink-0 rounded-full transition', checked ? 'ember-bg' : 'bg-line')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}
