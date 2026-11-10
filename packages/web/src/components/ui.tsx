import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  title,
  icon,
  actions,
  bodyClassName
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-ink-700 bg-ink-900", className)}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink-100">
            {icon && <span className="text-ink-400">{icon}</span>}
            {title}
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "red" | "amber" | "cyan" | "green" | "violet" | "orange" | "blue";

const toneClasses: Record<Tone, string> = {
  neutral: "border-ink-600 bg-ink-800 text-ink-300",
  red: "border-red-500/30 bg-red-500/10 text-red-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  orange: "border-orange-500/40 bg-orange-500/15 text-orange-300",
  blue: "border-sky-500/30 bg-sky-500/10 text-sky-300"
};

export function Badge({
  children,
  tone = "neutral",
  icon,
  title,
  className,
  mono
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  title?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        mono && "font-mono",
        toneClasses[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "secondary",
  loading,
  icon,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  icon?: ReactNode;
}) {
  const styles = {
    primary:
      "bg-brand text-ink-950 hover:bg-brand-soft border-transparent font-semibold shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_6px_20px_-8px_rgba(16,185,129,0.6)]",
    secondary: "bg-ink-800 text-ink-100 border-ink-600 hover:bg-ink-700 hover:border-ink-500",
    ghost: "bg-transparent text-ink-300 border-transparent hover:bg-ink-800 hover:text-ink-100"
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        styles,
        className
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-400">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-300/70 hover:text-red-200" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-ink-500">{icon}</div>
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {children && <div className="max-w-sm text-[13px] text-ink-400">{children}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  className
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "red" | "amber" | "neutral";
  className?: string;
}) {
  const valueTone = {
    green: "text-emerald-300",
    red: "text-red-300",
    amber: "text-amber-300",
    neutral: "text-ink-100"
  }[tone ?? "neutral"];
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className={cx("tabular mt-0.5 truncate text-lg font-semibold", valueTone)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
