import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  Gauge,
  Lightbulb,
  ListChecks,
  PiggyBank,
  Play,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";
import type { CostBreakdown, DemoPreset, LintDiagnostic, OptimizeResponse, SourceLanguage } from "@promptlint/shared";
import type { PlaygroundState } from "../App";
import { api, errorMessage } from "../lib/api";
import { lineDiff } from "../lib/diff";
import { compactNum, ms, num, pct, tokenChange, usd } from "../lib/format";
import { CodeEditor, CodeView, worstSeverityByLine } from "../components/code";
import {
  CostSourceBadge,
  GatewayError,
  OptimizerSourceBadge,
  ReplayBadge,
  RunModeBadge,
  SeverityBadge,
  severityStyles,
  sortDiagnostics
} from "../components/honesty";
import { Badge, Button, Card, EmptyState, ErrorBanner, Segmented, Stat, cx } from "../components/ui";

const VOL_MIN = 10_000;
const VOL_MAX = 1_000_000;
const SLIDER_STEPS = 1000;

/** Log-scale slider so 10k → 1M is usable end to end; values snap to 2 significant figures. */
function sliderToVolume(v: number): number {
  const raw = VOL_MIN * Math.pow(VOL_MAX / VOL_MIN, v / SLIDER_STEPS);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.min(VOL_MAX, Math.max(VOL_MIN, Math.round(raw / mag) * mag));
}
function volumeToSlider(vol: number): number {
  return Math.round((Math.log(vol / VOL_MIN) / Math.log(VOL_MAX / VOL_MIN)) * SLIDER_STEPS);
}

export function Playground({
  presets,
  state,
  setState,
  onBenchmark
}: {
  presets: DemoPreset[];
  state: PlaygroundState;
  setState: Dispatch<SetStateAction<PlaygroundState>>;
  onBenchmark: () => void;
}) {
  const [linting, setLinting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = presets.find((p) => p.id === state.presetId);

  const runLint = useCallback(
    async (code: string, volume: number) => {
      if (!code.trim()) return;
      setLinting(true);
      setError(null);
      try {
        const lint = await api.lintCode({
          code,
          filename: state.filename,
          language: state.language,
          monthlyVolume: volume
        });
        setState((s) => ({ ...s, lint, lintedCode: code }));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLinting(false);
      }
    },
    [state.filename, state.language, setState]
  );

  const runOptimize = useCallback(async () => {
    if (!state.code.trim()) return;
    setOptimizing(true);
    setError(null);
    // Lint alongside so diagnostics and savings match the code being optimized
    const lintPromise = state.lintedCode === state.code ? null : runLint(state.code, state.volume);
    try {
      const optimize = await api.optimizeCode({
        code: state.code,
        filename: state.filename,
        language: state.language,
        monthlyVolume: state.volume
      });
      setState((s) => ({ ...s, optimize }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      await lintPromise;
      setOptimizing(false);
    }
  }, [state.code, state.filename, state.language, state.volume, state.lintedCode, runLint, setState]);

  // Savings scale with volume: re-lint (deterministic and local, no LLM call) when the slider settles
  const lastVolume = useRef(state.volume);
  useEffect(() => {
    if (state.volume === lastVolume.current || !state.lint) return;
    const t = setTimeout(() => {
      lastVolume.current = state.volume;
      runLint(state.lintedCode || state.code, state.volume);
    }, 250);
    return () => clearTimeout(t);
  }, [state.volume, state.lint, state.lintedCode, state.code, runLint]);

  const selectPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setState((s) => ({
      ...s,
      presetId: p.id,
      code: p.code,
      filename: p.filename,
      language: p.language,
      lint: null,
      lintedCode: "",
      optimize: null
    }));
  };

  const stale = !!state.lint && state.lintedCode !== state.code;
  const diagnostics = useMemo(() => sortDiagnostics(state.lint?.diagnostics ?? []), [state.lint]);
  const markers = useMemo(
    () => (state.lint && !stale ? worstSeverityByLine(state.lint.diagnostics) : undefined),
    [state.lint, stale]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <Card bodyClassName="flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Demo preset</span>
          <div className="relative">
            <select
              value={state.presetId ?? ""}
              onChange={(e) => selectPreset(e.target.value)}
              className="h-9 w-full appearance-none truncate rounded-lg border border-ink-600 bg-ink-850 pl-3 pr-9 text-[13px] text-ink-100 outline-none focus:border-brand"
            >
              {presets.length === 0 && <option value="">Loading presets…</option>}
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          </div>
        </label>

        <label className="flex w-full flex-col gap-1.5 lg:w-80">
          <span className="flex items-baseline justify-between text-[11px] font-medium uppercase tracking-wide text-ink-400">
            Monthly volume
            <span className="tabular font-mono text-[13px] normal-case tracking-normal text-ink-100">
              {num(state.volume)} <span className="text-ink-400">calls/mo</span>
            </span>
          </span>
          <input
            type="range"
            className="volume my-2.5 w-full"
            min={0}
            max={SLIDER_STEPS}
            value={volumeToSlider(state.volume)}
            style={{ ["--fill" as string]: `${(volumeToSlider(state.volume) / SLIDER_STEPS) * 100}%` }}
            onChange={(e) => setState((s) => ({ ...s, volume: sliderToVolume(Number(e.target.value)) }))}
            aria-label="Monthly call volume"
          />
          <span className="-mt-1 flex justify-between font-mono text-[10px] text-ink-500">
            <span>10k</span>
            <span>100k</span>
            <span>1M</span>
          </span>
        </label>

        <div className="flex gap-2">
          <Button
            onClick={() => runLint(state.code, state.volume)}
            loading={linting && !optimizing}
            disabled={!state.code.trim() || optimizing}
            icon={<ListChecks className="size-4" />}
            className="h-9"
          >
            Lint
          </Button>
          <Button
            variant="primary"
            onClick={runOptimize}
            loading={optimizing}
            disabled={!state.code.trim()}
            icon={<Sparkles className="size-4" />}
            className="h-9"
          >
            Optimize &amp; route via Otari
          </Button>
        </div>
      </Card>

      {preset && <p className="-mt-1 px-1 text-[13px] text-ink-400">{preset.description}</p>}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Left: editor + diagnostics */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[12.5px] font-medium">{state.filename}</span>
                <select
                  value={state.language ?? ""}
                  onChange={(e) =>
                    setState((s) => ({ ...s, language: (e.target.value || undefined) as SourceLanguage | undefined, lintedCode: "" }))
                  }
                  aria-label="Language"
                  className="h-6 rounded-md border border-ink-600 bg-ink-800 px-1.5 text-[11px] font-medium text-ink-300 outline-none focus:border-brand"
                >
                  <option value="">auto-detect</option>
                  <option value="typescript">typescript</option>
                  <option value="javascript">javascript</option>
                  <option value="python">python</option>
                  <option value="raw-prompt">raw prompt</option>
                </select>
              </span>
            }
            icon={<FileCode2 className="size-4" />}
            actions={
              state.lint && (
                <span className="flex items-center gap-2">
                  {stale && <Badge tone="amber">edited · re-run lint</Badge>}
                  <HealthScore score={state.lint.score} />
                </span>
              )
            }
            bodyClassName="p-3"
          >
            <CodeEditor
              value={state.code}
              onChange={(code) => setState((s) => ({ ...s, code }))}
              markers={markers}
              className="h-[420px]"
              placeholder="Paste TypeScript, JavaScript or Python that calls an LLM, or a raw prompt…"
            />
          </Card>

          <Card
            title="Diagnostics"
            icon={<ShieldCheck className="size-4" />}
            actions={state.lint && <SeverityCounts diagnostics={state.lint.diagnostics} />}
            bodyClassName="p-3"
          >
            {!state.lint ? (
              <EmptyState icon={<ListChecks className="size-6" />} title="No lint results yet">
                Click <b className="text-ink-200">Lint</b> to run rules PL001–PL008 against this code.
              </EmptyState>
            ) : diagnostics.length === 0 ? (
              <EmptyState icon={<Check className="size-6 text-emerald-400" />} title="No issues found" />
            ) : (
              <ul className="flex flex-col gap-2">
                {diagnostics.map((d, i) => (
                  <DiagnosticCard key={`${d.ruleId}-${d.line}-${i}`} d={d} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: savings + optimizer result */}
        <div className="flex min-w-0 flex-col gap-4">
          <SavingsCard cost={state.lint?.costBreakdown} refreshing={linting} />
          <OptimizeSummary result={state.optimize} running={optimizing} onBenchmark={onBenchmark} />
        </div>
      </div>

      <CompareCard result={state.optimize} />
    </div>
  );
}

function HealthScore({ score }: { score: number }) {
  const tone = score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-300";
  const stroke = score >= 80 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
  const c = 2 * Math.PI * 9;
  return (
    <span className="flex items-center gap-1.5" title="Health score (0–100)">
      <svg viewBox="0 0 24 24" className="size-5 -rotate-90">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-ink-700)" strokeWidth="3" />
        <circle cx="12" cy="12" r="9" fill="none" stroke={stroke} strokeWidth="3" strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap="round" />
      </svg>
      <span className={cx("tabular text-[13px] font-semibold", tone)}>{score}</span>
      <span className="text-xs text-ink-500">/100</span>
    </span>
  );
}

function SeverityCounts({ diagnostics }: { diagnostics: LintDiagnostic[] }) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return (
    <span className="flex items-center gap-3 text-xs">
      {(["error", "warning", "info"] as const).map((s) => (
        <span key={s} className={cx("flex items-center gap-1.5", counts[s] ? severityStyles[s].text : "text-ink-500")}>
          <span className={cx("size-1.5 rounded-full", counts[s] ? severityStyles[s].dot : "bg-ink-600")} />
          <span className="tabular font-semibold">{counts[s]}</span>
          {s === "error" ? "errors" : s === "warning" ? "warnings" : "info"}
        </span>
      ))}
    </span>
  );
}

function DiagnosticCard({ d }: { d: LintDiagnostic }) {
  const [open, setOpen] = useState(false);
  const s = severityStyles[d.severity];
  return (
    <li className="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-850">
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", s.bar)} />
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={d.severity} />
            <span className="font-mono text-xs font-semibold text-ink-100">{d.ruleId}</span>
            <span className="font-mono text-xs text-ink-400">{d.ruleName}</span>
            <span className="font-mono text-[11px] text-ink-500">L{d.line}</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-5 text-ink-200">{d.message}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {d.estimatedMonthlySavingsUsd ? (
            <span className="tabular text-[13px] font-semibold text-emerald-300">−{usd(d.estimatedMonthlySavingsUsd)}/mo</span>
          ) : (
            <span className="text-[11px] uppercase tracking-wide text-ink-500">{d.category}</span>
          )}
          <ChevronDown className={cx("size-4 text-ink-500 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-ink-700 px-3.5 py-2.5">
          {d.snippet && (
            <pre className="overflow-x-auto rounded-md bg-ink-950 px-3 py-2 font-mono text-xs text-ink-300">{d.snippet}</pre>
          )}
          {d.suggestedFix && (
            <p className="flex gap-2 text-[13px] text-ink-300">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              {d.suggestedFix}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

const SAVINGS_SOURCES: Array<{ key: keyof CostBreakdown["breakdownBySource"]; label: string; rule: string; color: string }> = [
  { key: "smartModelRoutingUsd", label: "Smart model tier routing", rule: "PL005", color: "bg-emerald-400" },
  { key: "otariPrefixCachingUsd", label: "Otari prefix caching", rule: "PL003", color: "bg-sky-400" },
  { key: "otariIdempotencyReplayUsd", label: "Otari idempotent replay", rule: "PL008", color: "bg-cyan-400" },
  { key: "promptCompressionUsd", label: "Prompt token compression", rule: "PL004", color: "bg-violet-400" }
];

function SavingsCard({ cost, refreshing }: { cost?: CostBreakdown; refreshing: boolean }) {
  return (
    <Card
      title="Projected savings"
      icon={<PiggyBank className="size-4" />}
      actions={cost && <CostSourceBadge source="catalog" />}
      className={cx("transition-opacity", refreshing && cost && "opacity-70")}
    >
      {!cost ? (
        <EmptyState icon={<PiggyBank className="size-6" />} title="Lint to project monthly spend">
          Cost is estimated from the model price table at the volume you pick.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Savings per month</div>
              <div className="tabular text-4xl font-semibold tracking-tight text-emerald-300">{usd(cost.monthlySavingsUsd)}</div>
              <div className="mt-1 text-[13px] text-ink-400">
                <span className="tabular text-ink-200">{usd(cost.annualSavingsUsd, { compact: true })}</span>/yr ·{" "}
                <span className="tabular text-ink-200">{pct(cost.savingsPercentage)}</span> less at {compactNum(cost.monthlyCallVolume)} calls/mo
              </div>
            </div>
            <div className="flex gap-6">
              <Stat label="Current" value={`${usd(cost.currentMonthlyCostUsd)}`} sub={<span className="font-mono">{cost.currentModel}</span>} />
              <Stat
                label="Optimized"
                value={`${usd(cost.optimizedMonthlyCostUsd)}`}
                tone="green"
                sub={<span className="font-mono">{cost.recommendedModel}</span>}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {SAVINGS_SOURCES.map((src) => {
              const value = cost.breakdownBySource[src.key];
              const share = cost.monthlySavingsUsd > 0 ? (value / cost.monthlySavingsUsd) * 100 : 0;
              return (
                <div key={src.key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-ink-200">
                      {src.label} <span className="font-mono text-[11px] text-ink-500">{src.rule}</span>
                    </span>
                    <span className="tabular shrink-0 font-medium text-ink-100">
                      {usd(value)}
                      <span className="ml-1.5 text-xs font-normal text-ink-500">{share.toFixed(share < 1 && share > 0 ? 1 : 0)}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className={cx("h-full rounded-full transition-[width] duration-500 ease-out", src.color)}
                      style={{ width: `${value > 0 ? Math.max(share, 1) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function OptimizeSummary({
  result,
  running,
  onBenchmark
}: {
  result: OptimizeResponse | null;
  running: boolean;
  onBenchmark: () => void;
}) {
  if (!result) {
    return (
      <Card title="Optimizer" icon={<Sparkles className="size-4" />}>
        <EmptyState icon={<Workflow className="size-6" />} title={running ? "Optimizing via Otari…" : "Not optimized yet"}>
          {running
            ? "The optimizer model rewrites the prompt through the Otari gateway. This can take a few seconds."
            : "Optimize rewrites the call to go through Otari with injection guards, prefix caching and an Idempotency-Key."}
        </EmptyState>
      </Card>
    );
  }
  const t = result.otariTelemetry;
  const change = tokenChange(result.tokenReductionPercentage);
  return (
    <Card
      title="Optimizer"
      icon={<Sparkles className="size-4" />}
      className={cx(running && "opacity-70")}
      actions={
        <>
          <OptimizerSourceBadge source={result.optimizerSource} />
          <RunModeBadge simulated={t.simulated} />
          <ReplayBadge replayed={t.idempotentReplayed} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <GatewayError error={t.gatewayError} />
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Prompt tokens" value={`${result.originalTokens} → ${result.optimizedTokens}`} />
          <Stat label="Change" value={change.value} tone={change.tone} sub={change.sub} />
          <Stat label="Optimizer latency" value={ms(t.latencyMs)} sub={t.simulated ? "simulated" : "via Otari"} />
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">Rules fixed</div>
          <div className="flex flex-wrap gap-1.5">
            {result.diagnosticsFixed.length === 0 && <span className="text-xs text-ink-500">none</span>}
            {result.diagnosticsFixed.map((r) => (
              <Badge key={r} tone="green" mono icon={<Check className="size-3" />}>
                {r}
              </Badge>
            ))}
          </div>
        </div>

        <dl className="grid gap-x-4 gap-y-1.5 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-[11.5px] sm:grid-cols-[auto_minmax(0,1fr)]">
          <TelemetryRow k="endpoint" v={t.otariEndpoint} />
          <TelemetryRow k="Otari-Request-ID" v={t.otariRequestId} />
          <TelemetryRow k="Idempotency-Key" v={t.idempotencyKey} />
          <TelemetryRow k="cache_control" v={t.cacheControlApplied ? "ephemeral" : "not applied"} />
        </dl>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-300 hover:text-ink-100">
            <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
            What changed ({result.explanation.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 pl-1">
            {result.explanation.map((e, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-5 text-ink-300">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-500" />
                {e}
              </li>
            ))}
          </ul>
        </details>

        <Button variant="primary" onClick={onBenchmark} icon={<Gauge className="size-4" />} className="h-9 self-start">
          Benchmark these prompts <ArrowRight className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function TelemetryRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-500">{k}</dt>
      <dd className="truncate text-ink-200" title={v}>
        {v}
      </dd>
    </>
  );
}

function CompareCard({ result }: { result: OptimizeResponse | null }) {
  const [view, setView] = useState<"code" | "prompt">("code");
  const [copied, setCopied] = useState(false);
  const original = result ? (view === "code" ? result.originalCode : result.originalPrompt) : "";
  const optimized = result ? (view === "code" ? result.optimizedCode : result.optimizedPrompt) : "";
  const marks = useMemo(() => lineDiff(original, optimized), [original, optimized]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(optimized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Card
      title="Original vs optimized"
      icon={<Play className="size-4" />}
      actions={
        result && (
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "code", label: "Code" },
                { value: "prompt", label: "Prompt" }
              ]}
            />
            <Button variant="ghost" onClick={copy} icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>
              {copied ? "Copied" : "Copy optimized"}
            </Button>
          </>
        )
      }
      bodyClassName="p-3"
    >
      {!result ? (
        <EmptyState icon={<FileCode2 className="size-6" />} title="Run Optimize to see the rewrite side by side" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between px-1 text-xs text-ink-400">
              <span>Original</span>
              {view === "prompt" && <span className="tabular">{num(result.originalTokens)} tokens</span>}
            </div>
            <CodeView code={original} marks={marks.left} side="removed" wrap={view === "prompt"} className={view === "code" ? "max-h-[560px]" : "max-h-[360px]"} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between px-1 text-xs text-ink-400">
              <span className="text-emerald-300">Optimized · routed via Otari</span>
              {view === "prompt" && (
                <span className={cx("tabular", tokenChange(result.tokenReductionPercentage).grew && "text-amber-300")}>
                  {num(result.optimizedTokens)} tokens · {tokenChange(result.tokenReductionPercentage).label}
                </span>
              )}
            </div>
            <CodeView code={optimized} marks={marks.right} side="added" wrap={view === "prompt"} className={view === "code" ? "max-h-[560px]" : "max-h-[360px]"} />
          </div>
        </div>
      )}
    </Card>
  );
}
