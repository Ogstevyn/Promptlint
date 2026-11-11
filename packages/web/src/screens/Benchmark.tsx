import { useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ChevronDown, Gauge, History, Play, RotateCw, Scale, Timer } from "lucide-react";
import type { BenchmarkExecutionMetrics, BenchmarkResponse, ModelPricing } from "@promptlint/shared";
import type { BenchmarkInputs, BenchmarkRun } from "../App";
import { api, errorMessage } from "../lib/api";
import { ms, num, pct, tokenChange, usd } from "../lib/format";
import { CostSourceBadge, GatewayError, GuardrailBadge, OtariBlockedNotice, ReplayBadge, RoutingBadge, RunModeBadge } from "../components/honesty";
import { Badge, Button, Card, EmptyState, ErrorBanner, Stat, cx } from "../components/ui";

export function Benchmark({
  inputs,
  setInputs,
  runs,
  setRuns,
  models,
  volume,
  hasOptimized,
  goToPlayground
}: {
  inputs: BenchmarkInputs;
  setInputs: Dispatch<SetStateAction<BenchmarkInputs>>;
  runs: BenchmarkRun[];
  setRuns: Dispatch<SetStateAction<BenchmarkRun[]>>;
  models: ModelPricing[];
  volume: number;
  hasOptimized: boolean;
  goToPlayground: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const canRun = inputs.originalPrompt.trim() && inputs.optimizedPrompt.trim();
  const latest = runs[runs.length - 1];
  const shown = runs.find((r) => r.n === selected) ?? latest;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.runBenchmark({
        originalPrompt: inputs.originalPrompt,
        optimizedPrompt: inputs.optimizedPrompt,
        testInput: inputs.testInput,
        originalModel: inputs.originalModel || undefined,
        optimizedModel: inputs.optimizedModel || undefined,
        monthlyVolume: volume
      });
      setRuns((rs) => [...rs, { n: (rs[rs.length - 1]?.n ?? 0) + 1, at: Date.now(), result }]);
      setSelected(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const update = (k: keyof BenchmarkInputs) => (v: string) => {
    setInputs((s) => ({ ...s, [k]: v }));
    // Different inputs mean a different request; earlier runs no longer describe it
    setRuns([]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Benchmark setup"
        icon={<Scale className="size-4" />}
        actions={
          <span className="text-xs text-ink-400">
            Projected at <span className="tabular text-ink-200">{num(volume)}</span> calls/mo · set in Playground
          </span>
        }
      >
        {!canRun && !hasOptimized && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-[13px] text-ink-300">
            Optimize a preset in the Playground first, or paste two prompts below.
            <Button onClick={goToPlayground} icon={<ArrowLeft className="size-3.5" />}>
              Go to Playground
            </Button>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <PromptField label="Original prompt" value={inputs.originalPrompt} onChange={update("originalPrompt")} />
          <PromptField label="Optimized prompt" value={inputs.optimizedPrompt} onChange={update("optimizedPrompt")} accent />
          <ModelSelect label="Original model" value={inputs.originalModel} onChange={update("originalModel")} models={models} />
          <ModelSelect label="Optimized model" value={inputs.optimizedModel} onChange={update("optimizedModel")} models={models} />
        </div>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Test input</span>
          <input
            value={inputs.testInput}
            onChange={(e) => update("testInput")(e.target.value)}
            placeholder="The user message both prompts receive"
            className="h-9 rounded-lg border border-ink-600 bg-ink-950 px-3 font-mono text-[12.5px] text-ink-100 outline-none focus:border-brand"
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {runs.length === 0 ? (
            <Button variant="primary" onClick={run} loading={running} disabled={!canRun} icon={<Play className="size-4" />} className="h-9">
              Run benchmark
            </Button>
          ) : (
            <Button variant="primary" onClick={run} loading={running} disabled={!canRun} icon={<RotateCw className="size-4" />} className="h-9">
              Run again (same request)
            </Button>
          )}
          <span className="text-xs text-ink-500">
            {runs.length === 0
              ? "Calls both prompts through the Otari gateway."
              : "Same Idempotency-Key, so Otari can replay the cached response."}
          </span>
        </div>
      </Card>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!shown ? (
        <Card>
          <EmptyState icon={<Gauge className="size-6" />} title={running ? "Calling both models via Otari…" : "No benchmark runs yet"}>
            {running
              ? "Live calls usually take a few seconds."
              : "Results show latency, tokens, cost and output for the original and optimized prompt side by side."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <ComparisonStrip result={shown.result} runNo={shown.n} />
          <div className={cx("grid gap-4 lg:grid-cols-2", running && "opacity-60 transition-opacity")}>
            <RunCard label="Original" m={shown.result.original} />
            <RunCard label="Optimized" m={shown.result.optimized} accent />
          </div>
          {runs.length > 1 && <RunHistory runs={runs} selected={shown.n} onSelect={setSelected} />}
        </>
      )}
    </div>
  );
}

function PromptField({ label, value, onChange, accent }: { label: string; value: string; onChange: (v: string) => void; accent?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className={cx("text-[11px] font-medium uppercase tracking-wide", accent ? "text-emerald-300" : "text-ink-400")}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        className="resize-y rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12.5px] leading-5 text-ink-100 outline-none focus:border-brand"
      />
    </label>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  models
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  models: ModelPricing[];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full appearance-none rounded-lg border border-ink-600 bg-ink-850 pl-3 pr-9 font-mono text-[12.5px] text-ink-100 outline-none focus:border-brand"
        >
          <option value="">Server default</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.tier})
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      </div>
    </label>
  );
}

function ComparisonStrip({ result, runNo }: { result: BenchmarkResponse; runNo: number }) {
  const c = result.comparison;
  const faster = c.latencyReductionMs >= 0;
  const tc = tokenChange(c.tokenReductionPercentage);
  const anySimulated = result.original.simulated || result.optimized.simulated;
  return (
    <Card
      title={`Run #${runNo}`}
      icon={<Timer className="size-4" />}
      actions={
        <>
          {anySimulated && <RunModeBadge simulated />}
          <span className="font-mono text-[11px] text-ink-500">{result.benchmarkId}</span>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Monthly savings"
          value={usd(c.monthlySavingsUsd)}
          tone={c.monthlySavingsUsd >= 0 ? "green" : "red"}
          sub={`${pct(c.costReductionPercentage)} cheaper`}
        />
        <Stat
          label="Latency"
          value={faster ? `−${ms(c.latencyReductionMs)}` : `+${ms(Math.abs(c.latencyReductionMs))}`}
          tone={faster ? "green" : "amber"}
          sub={faster ? `${pct(c.latencyReductionPercentage)} faster` : `${pct(Math.abs(c.latencyReductionPercentage))} slower`}
        />
        <Stat label="Prompt tokens" value={tc.value} tone={tc.tone} sub={tc.sub} />
        <Stat label="Cost reduction" value={pct(c.costReductionPercentage)} tone={c.costReductionPercentage >= 0 ? "green" : "red"} sub="per call" />
        <AgreementScore score={c.semanticEquivalenceScore} />
      </div>
    </Card>
  );
}

function AgreementScore({ score }: { score: number | null }) {
  if (score === null) {
    return <Stat label="Output agreement" value={<span className="text-ink-400">n/a (simulated)</span>} sub="needs two live outputs" />;
  }
  const tone = score >= 75 ? "green" : score >= 50 ? "amber" : "red";
  const bar = score >= 75 ? "bg-emerald-400" : score >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div>
      <Stat label="Output agreement" value={`${Math.round(score)}/100`} tone={tone} />
      <div className="mt-1.5 h-1 w-full max-w-32 overflow-hidden rounded-full bg-ink-800">
        <div className={cx("h-full rounded-full", bar)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

function RunCard({ label, m, accent }: { label: string; m: BenchmarkExecutionMetrics; accent?: boolean }) {
  return (
    <Card
      className={cx(accent && "border-emerald-500/25", m.idempotentReplayed && "ring-1 ring-cyan-500/30")}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className={cx(accent && "text-emerald-300")}>{label}</span>
          <span className="truncate font-mono text-xs font-normal text-ink-300">{m.model}</span>
        </span>
      }
      actions={
        <>
          <ReplayBadge replayed={m.idempotentReplayed} />
          <RunModeBadge simulated={m.simulated} />
          <CostSourceBadge source={m.costSource} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <GatewayError error={m.gatewayError} />
        <OtariBlockedNotice blocked={m.blocked} />
        {(m.routing || m.guardrails) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <RoutingBadge routing={m.routing} requested={m.model} />
            <GuardrailBadge results={m.guardrails} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Latency" value={ms(m.latencyMs)} sub={m.idempotentReplayed ? "replayed by Otari" : undefined} />
          <Stat label="Cost / 1k calls" value={usd(m.costPer1kCallsUsd)} />
          <Stat label="Monthly" value={usd(m.monthlyProjectedCostUsd)} tone={accent ? "green" : "neutral"} />
        </div>
        <div className="grid grid-cols-3 gap-4 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5">
          <Stat label="Input tokens" value={num(m.inputTokens)} />
          <Stat label="Cached" value={num(m.cachedTokens)} tone={m.cachedTokens > 0 ? "green" : "neutral"} />
          <Stat label="Output tokens" value={num(m.outputTokens)} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-500">
          <span>
            Otari-Request-ID <span className="text-ink-300">{m.otariRequestId}</span>
          </span>
          {m.gatewayCostUsd !== undefined && (
            <span>
              gateway cost/call <span className="text-ink-300">{usd(m.gatewayCostUsd, { precise: true })}</span>
            </span>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">Output</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-[12px] leading-5 text-ink-200">
            {m.outputText || <span className="text-ink-500">(empty)</span>}
          </pre>
        </div>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-ink-200">
            <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
            Prompt sent
          </summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-[12px] leading-5 text-ink-300">
            {m.promptUsed}
          </pre>
        </details>
      </div>
    </Card>
  );
}

function RunHistory({ runs, selected, onSelect }: { runs: BenchmarkRun[]; selected: number; onSelect: (n: number) => void }) {
  return (
    <Card title="Runs of this request" icon={<History className="size-4" />} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wide text-ink-400">
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Original</th>
              <th className="px-4 py-2 font-medium">Optimized</th>
              <th className="px-4 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.n}
                onClick={() => onSelect(r.n)}
                className={cx(
                  "cursor-pointer border-b border-ink-800 last:border-0 hover:bg-ink-850",
                  r.n === selected && "bg-ink-850"
                )}
              >
                <td className="px-4 py-2 font-mono text-ink-200">#{r.n}</td>
                <td className="px-4 py-2">
                  <RunCell m={r.result.original} />
                </td>
                <td className="px-4 py-2">
                  <RunCell m={r.result.optimized} />
                </td>
                <td className="px-4 py-2 text-ink-500">{new Date(r.at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RunCell({ m }: { m: BenchmarkExecutionMetrics }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tabular text-ink-100">{ms(m.latencyMs)}</span>
      <span className="tabular text-ink-400">{usd(m.monthlyProjectedCostUsd)}/mo</span>
      <ReplayBadge replayed={m.idempotentReplayed} />
      {m.simulated && <Badge tone="orange">simulated</Badge>}
    </span>
  );
}
