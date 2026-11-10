export function usd(value: number, opts: { compact?: boolean; precise?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (opts.compact && abs >= 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1
    }).format(value);
  }
  const digits = opts.precise ? (abs < 0.01 ? 6 : abs < 1 ? 4 : 2) : abs < 1 && abs > 0 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits
  }).format(value);
}

export function num(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function compactNum(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Token change as shown to users. A negative reduction means the optimized prompt
 * is longer, which happens when injection guards are added to a short prompt.
 */
export function tokenChange(reductionPct: number): {
  label: string;
  /** Short form for stat tiles */
  value: string;
  sub: string;
  grew: boolean;
  tone: "green" | "amber" | "neutral";
} {
  const abs = Math.abs(reductionPct).toFixed(1);
  if (reductionPct < 0) {
    return { label: `+${abs}% tokens (security guards added)`, value: `+${abs}%`, sub: "security guards added", grew: true, tone: "amber" };
  }
  if (reductionPct === 0) {
    return { label: "no token change", value: "0%", sub: "no change", grew: false, tone: "neutral" };
  }
  return { label: `−${abs}% tokens`, value: `−${abs}%`, sub: "fewer tokens", grew: false, tone: "green" };
}
