import { AlertOctagon, Bot, Calculator, FlaskConical, Radio, Receipt, Repeat, Wand2 } from "lucide-react";
import type { LintDiagnostic, RuleSeverity } from "@promptlint/shared";
import { Badge } from "./ui";

/** Shown whenever numbers come from the offline simulator instead of a live Otari call. */
export function SimulatedBadge() {
  return (
    <Badge
      tone="orange"
      icon={<FlaskConical className="size-3" />}
      className="font-bold tracking-wider"
      title="No live Otari call was made: these numbers come from PromptLint's offline simulator."
    >
      SIMULATED
    </Badge>
  );
}

export function LiveBadge({ label = "Live via Otari" }: { label?: string }) {
  return (
    <Badge tone="green" icon={<Radio className="size-3" />} title="Measured from a live call through the Otari gateway.">
      {label}
    </Badge>
  );
}

export function RunModeBadge({ simulated }: { simulated: boolean }) {
  return simulated ? <SimulatedBadge /> : <LiveBadge />;
}

export function GatewayError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
      <AlertOctagon className="mt-px size-3.5 shrink-0 text-orange-400" />
      <div className="min-w-0">
        <span className="font-semibold">Gateway error, fell back to simulator: </span>
        <span className="break-words font-mono">{error}</span>
      </div>
    </div>
  );
}

export function OptimizerSourceBadge({ source }: { source: "llm" | "rules" }) {
  return source === "llm" ? (
    <Badge tone="violet" icon={<Bot className="size-3" />} title="The Otari optimizer model's rewrite passed validation.">
      LLM rewrite
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<Wand2 className="size-3" />} title="Deterministic rule-based rewrite (LLM rewrite unavailable or rejected).">
      rule-based
    </Badge>
  );
}

export function CostSourceBadge({ source }: { source: "gateway" | "catalog" }) {
  return source === "gateway" ? (
    <Badge tone="green" icon={<Receipt className="size-3" />} title="Cost reported by the Otari gateway for this call.">
      gateway-billed
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<Calculator className="size-3" />} title="Estimated from PromptLint's model price table.">
      catalog estimate
    </Badge>
  );
}

export function DemoDataBadge({ title }: { title?: string }) {
  return (
    <Badge
      tone="blue"
      icon={<FlaskConical className="size-3" />}
      title={title ?? "Illustrative data pre-seeded into the demo server, not from a real repository."}
    >
      demo data
    </Badge>
  );
}

export function ReplayBadge({ replayed }: { replayed: boolean }) {
  if (!replayed) return null;
  return (
    <Badge
      tone="cyan"
      icon={<Repeat className="size-3" />}
      className="font-semibold"
      title="Otari returned the cached response for this Idempotency-Key instead of calling the model again."
    >
      Otari replay
    </Badge>
  );
}

export const severityStyles: Record<RuleSeverity, { tone: "red" | "amber" | "cyan"; label: string; bar: string; text: string; dot: string }> = {
  error: { tone: "red", label: "ERROR", bar: "bg-red-500", text: "text-red-400", dot: "bg-red-400" },
  warning: { tone: "amber", label: "WARN", bar: "bg-amber-500", text: "text-amber-400", dot: "bg-amber-400" },
  info: { tone: "cyan", label: "INFO", bar: "bg-cyan-500", text: "text-cyan-400", dot: "bg-cyan-400" }
};

export function SeverityBadge({ severity }: { severity: RuleSeverity }) {
  const s = severityStyles[severity];
  return (
    <Badge tone={s.tone} className="font-bold tracking-wider" mono>
      {s.label}
    </Badge>
  );
}

export const severityRank: Record<RuleSeverity, number> = { error: 0, warning: 1, info: 2 };

export function sortDiagnostics(d: LintDiagnostic[]): LintDiagnostic[] {
  return [...d].sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.ruleId.localeCompare(b.ruleId));
}
