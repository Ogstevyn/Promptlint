import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, CircleDollarSign, Database, Minus, RefreshCw, ShieldAlert, Shrink, Tags } from "lucide-react";
import type { DashboardStats, LintRuleMetadata, ModelPricing, RuleCategory } from "@promptlint/shared";
import { api, errorMessage } from "../lib/api";
import { num, pct, usd } from "../lib/format";
import { DemoDataBadge, SeverityBadge } from "../components/honesty";
import { Badge, Button, Card, ErrorBanner, Spinner, cx } from "../components/ui";

const categoryStyle: Record<RuleCategory, { label: string; bar: string; dot: string }> = {
  security: { label: "Security", bar: "bg-red-400", dot: "bg-red-400" },
  caching: { label: "Caching", bar: "bg-sky-400", dot: "bg-sky-400" },
  cost: { label: "Cost", bar: "bg-emerald-400", dot: "bg-emerald-400" },
  latency: { label: "Latency", bar: "bg-amber-400", dot: "bg-amber-400" },
  "otari-routing": { label: "Otari routing", bar: "bg-violet-400", dot: "bg-violet-400" }
};

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [models, setModels] = useState<ModelPricing[]>([]);
  const [rules, setRules] = useState<LintRuleMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, m] = await Promise.all([api.getDashboardStats(), api.getModelsAndRules()]);
      setStats(s);
      setModels(m.models);
      setRules(m.rules);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-ink-100">
            Cost &amp; governance
            {stats?.demoSeed && (
              <DemoDataBadge title="Scan and rule counters start from illustrative seed values. Token reduction and cache hit rate switch to measured values once this server has run live optimizations and benchmarks." />
            )}
          </h1>
          <p className="text-[13px] text-ink-400">
            Aggregated across PR reports and Playground runs on this server
            {stats && (
              <>
                {" "}
                · <span className="tabular text-ink-300">{num(stats.totalScansRun)}</span> scans ·{" "}
                <span className="tabular text-ink-300">{num(stats.totalPromptsOptimized)}</span> prompts optimized
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" onClick={load} loading={loading} icon={<RefreshCw className="size-3.5" />}>
          Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!stats ? (
        !error && <Spinner label="Loading stats…" />
      ) : (
        <>
          {stats.demoSeed && (
            <p className="-mt-1 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-200/80">
              Includes demo data: the headline figures start from seeded example reports and counters, and change as you use the Playground, Benchmark and CI scan.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<CircleDollarSign className="size-4" />}
              label="Projected annual savings"
              value={usd(stats.totalAnnualSavingsUsd, { compact: true })}
              sub={`${usd(stats.totalMonthlySavingsUsd)}/mo across PR reports`}
              accent="text-emerald-300"
            />
            <Kpi
              icon={<Shrink className="size-4" />}
              label="Avg token reduction"
              value={pct(stats.averageTokenReductionPct)}
              sub="per optimized prompt"
            />
            <Kpi
              icon={<Database className="size-4" />}
              label="Otari cache hit rate"
              value={pct(stats.averageOtariCacheHitRatePct)}
              sub="cached / input tokens on live calls"
            />
            <Kpi
              icon={<ShieldAlert className="size-4" />}
              label="Prompt injections flagged"
              value={num(stats.securityInjectionsBlocked)}
              sub="PL001 + PL002 findings"
              accent="text-red-300"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <RuleDistribution stats={stats} />
            <RulesCatalog rules={rules} />
          </div>
          <ModelTable models={models} />
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-ink-400">
        <span className="text-ink-500">{icon}</span>
        {label}
      </div>
      <div className={cx("tabular mt-2 text-3xl font-semibold tracking-tight", accent ?? "text-ink-100")}>{value}</div>
      <div className="mt-1 text-xs text-ink-500">{sub}</div>
    </div>
  );
}

function RuleDistribution({ stats }: { stats: DashboardStats }) {
  const max = Math.max(1, ...stats.ruleDistribution.map((r) => r.count));
  const total = stats.ruleDistribution.reduce((s, r) => s + r.count, 0);
  const categories = Array.from(new Set(stats.ruleDistribution.map((r) => r.category)));
  return (
    <Card
      title="Findings by rule"
      icon={<Tags className="size-4" />}
      actions={<span className="tabular text-xs text-ink-400">{num(total)} total</span>}
    >
      <ul className="flex flex-col gap-2.5">
        {stats.ruleDistribution.map((r) => (
          <li key={r.ruleId} className="grid grid-cols-[52px_minmax(0,1fr)_40px] items-center gap-3">
            <span className="font-mono text-xs font-semibold text-ink-200">{r.ruleId}</span>
            <div className="min-w-0">
              <div className="mb-1 truncate font-mono text-[11px] text-ink-400">{r.ruleName}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div className={cx("h-full rounded-full", categoryStyle[r.category].bar)} style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
            <span className="tabular text-right text-[13px] font-medium text-ink-100">{r.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink-700 pt-3">
        {categories.map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-xs text-ink-400">
            <span className={cx("size-2 rounded-sm", categoryStyle[c].dot)} />
            {categoryStyle[c].label}
          </span>
        ))}
      </div>
    </Card>
  );
}

function RulesCatalog({ rules }: { rules: LintRuleMetadata[] }) {
  return (
    <Card title="Rule catalog" icon={<BookOpen className="size-4" />} bodyClassName="p-0">
      <ul className="divide-y divide-ink-800">
        {rules.map((r) => (
          <li key={r.id} className="flex gap-3 px-4 py-2.5">
            <div className="flex w-14 shrink-0 flex-col items-start gap-1">
              <span className="font-mono text-xs font-semibold text-ink-100">{r.id}</span>
              <SeverityBadge severity={r.defaultSeverity} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-200">{r.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-ink-500">
                  <span className={cx("size-1.5 rounded-full", categoryStyle[r.category].dot)} />
                  {categoryStyle[r.category].label}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-ink-400">{r.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const tierTone = { frontier: "violet", balanced: "blue", fast: "green" } as const;

function ModelTable({ models }: { models: ModelPricing[] }) {
  return (
    <Card
      title="Model price table"
      icon={<CircleDollarSign className="size-4" />}
      actions={<span className="text-xs text-ink-400">USD per 1M tokens · used for catalog estimates</span>}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Tier</th>
              <th className="px-4 py-2 text-right font-medium">Input</th>
              <th className="px-4 py-2 text-right font-medium">Cached input</th>
              <th className="px-4 py-2 text-right font-medium">Output</th>
              <th className="px-4 py-2 text-right font-medium">Avg latency</th>
              <th className="px-4 py-2 text-center font-medium">Prompt caching</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model} className="border-b border-ink-800 last:border-0 hover:bg-ink-850">
                <td className="px-4 py-2 font-mono text-[12.5px] text-ink-100">{m.model}</td>
                <td className="px-4 py-2 text-ink-300">{m.provider}</td>
                <td className="px-4 py-2">
                  <Badge tone={tierTone[m.tier]}>{m.tier}</Badge>
                </td>
                <td className="tabular px-4 py-2 text-right text-ink-200">{usd(m.inputPerMillionUsd)}</td>
                <td className="tabular px-4 py-2 text-right text-ink-200">{usd(m.cachedInputPerMillionUsd)}</td>
                <td className="tabular px-4 py-2 text-right text-ink-200">{usd(m.outputPerMillionUsd)}</td>
                <td className="tabular px-4 py-2 text-right text-ink-400">{num(m.avgLatencyMs)} ms</td>
                <td className="px-4 py-2 text-center">
                  {m.supportsPromptCaching ? (
                    <Check className="mx-auto size-4 text-emerald-400" aria-label="yes" />
                  ) : (
                    <Minus className="mx-auto size-4 text-ink-500" aria-label="no" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
