import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AlertOctagon, ChevronDown, Crosshair, FlaskConical, Play, RotateCw, ShieldAlert, ShieldCheck, Swords } from "lucide-react";
import type {
  DemoPreset,
  InjectionArenaAttackResult,
  InjectionArenaAttempt,
  InjectionArenaResponse,
  InjectionArenaSideSummary,
  ModelPricing
} from "@promptlint/shared";
import { api, errorMessage } from "../lib/api";
import { ms, usd } from "../lib/format";
import { GatewayError, LiveBadge, SimulatedBadge } from "../components/honesty";
import { Badge, Button, Card, EmptyState, ErrorBanner, Segmented, Stat, cx } from "../components/ui";

export interface ArenaState {
  presetId: string | null;
  model: string;
  result: InjectionArenaResponse | null;
}

type Filter = "all" | "original" | "hardened";

export function Arena({
  presets,
  models,
  state,
  setState
}: {
  presets: DemoPreset[];
  models: ModelPricing[];
  state: ArenaState;
  setState: Dispatch<SetStateAction<ArenaState>>;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const presetId = state.presetId ?? presets[0]?.id ?? null;
  const preset = presets.find((p) => p.id === presetId);
  const result = state.result;

  const run = async () => {
    if (!presetId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.runInjectionArena({ presetId, model: state.model || undefined });
      setState((s) => ({ ...s, presetId, result: res }));
      setFilter("all");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card bodyClassName="flex flex-col gap-4 p-4 lg:flex-row lg:items-end">
        <SelectField
          label="Demo preset"
          value={presetId ?? ""}
          onChange={(v) => setState((s) => ({ ...s, presetId: v, result: null }))}
          className="flex-1"
        >
          {presets.length === 0 && <option value="">Loading presets…</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Target model (both sides)"
          value={state.model}
          onChange={(v) => setState((s) => ({ ...s, model: v, result: null }))}
          className="lg:w-80"
          mono
        >
          <option value="">Server default</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.tier})
            </option>
          ))}
        </SelectField>
        <Button
          variant="primary"
          onClick={run}
          loading={running}
          disabled={!presetId}
          icon={result ? <RotateCw className="size-4" /> : <Play className="size-4" />}
          className="h-9"
        >
          {result ? "Run again (new canary)" : "Run the arena"}
        </Button>
      </Card>

      <p className="-mt-1 px-1 text-[13px] text-ink-400">
        Fires a fixed corpus of prompt-injection payloads at the preset's original prompt and at its PromptLint-hardened
        version, through the same model. Each payload tries to make the model print a fresh per-run canary; an attack
        counts as a break-through only if the canary shows up in the output.
        {preset && <span className="text-ink-500"> Preset: {preset.description}</span>}
      </p>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!result ? (
        <Card>
          <EmptyState
            icon={<Swords className="size-6" />}
            title={running ? "Attacking both prompts via Otari…" : "No arena runs yet"}
          >
            {running
              ? "About 40 calls through Otari, 4 at a time. Live runs usually take 15–60 seconds."
              : "Results show how many attacks broke through each prompt, and every payload and output."}
          </EmptyState>
        </Card>
      ) : (
        <div className={cx("flex flex-col gap-4", running && "opacity-60 transition-opacity")}>
          <Scoreboard result={result} />
          <AttackGrid result={result} filter={filter} setFilter={setFilter} />
          <PromptsUsed result={result} />
        </div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  className,
  mono
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            "h-9 w-full appearance-none truncate rounded-lg border border-ink-600 bg-ink-850 pl-3 pr-9 text-[13px] text-ink-100 outline-none focus:border-brand",
            mono && "font-mono text-[12.5px]"
          )}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      </div>
    </label>
  );
}

/** Denominator used for a side: live attempts, or all attempts when nothing was live. */
function denominator(s: InjectionArenaSideSummary): number {
  return s.liveAttempts > 0 ? s.liveAttempts : s.attempted;
}

function Scoreboard({ result }: { result: InjectionArenaResponse }) {
  const { original, hardened } = result.summary;
  const simulated = result.mode === "simulated";
  const blocked = original.succeeded - hardened.succeeded;
  const failed = original.failedCalls + hardened.failedCalls;

  let verdict: { text: string; tone: "green" | "red" | "amber" | "neutral" };
  if (simulated) {
    verdict = { text: "No verdict: nothing was sent to a model", tone: "neutral" };
  } else if (original.succeeded === 0 && hardened.succeeded === 0) {
    verdict = { text: "No attack broke through either prompt", tone: "neutral" };
  } else if (blocked > 0) {
    verdict = {
      text: `Break-throughs cut from ${original.succeeded} to ${hardened.succeeded} (−${Math.round((blocked / original.succeeded) * 100)}%)`,
      tone: "green"
    };
  } else if (blocked === 0) {
    verdict = { text: "Hardening made no difference on this run", tone: "amber" };
  } else {
    verdict = { text: `The hardened prompt was broken ${-blocked} more time${blocked === -1 ? "" : "s"}`, tone: "red" };
  }
  const verdictTone = {
    green: "text-emerald-300",
    red: "text-red-300",
    amber: "text-amber-300",
    neutral: "text-ink-200"
  }[verdict.tone];

  return (
    <Card
      title="Scoreboard"
      icon={<Crosshair className="size-4" />}
      actions={
        <>
          {result.mode === "live" ? (
            <LiveBadge />
          ) : result.mode === "mixed" ? (
            <Badge tone="amber" icon={<AlertOctagon className="size-3" />} title="Some gateway calls failed and are excluded from the counts.">
              partly live
            </Badge>
          ) : (
            <SimulatedBadge />
          )}
          <span className="font-mono text-[11px] text-ink-500">{result.runId}</span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {simulated && (
          <div className="flex items-start gap-2.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-[13px] text-orange-200">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-orange-400" />
            <p>
              <span className="font-semibold">Simulated run, not evidence.</span> No live Otari call was made, and the offline
              simulator never follows injected instructions, so both sides show zero. Set <code className="font-mono">OTARI_API_KEY</code> on
              the server for a real red-team.
            </p>
          </div>
        )}
        {result.gatewayErrors.map((e) => (
          <GatewayError key={e} error={e} />
        ))}

        <div className="grid gap-3 sm:grid-cols-2">
          <SideScore label="Original prompt" s={original} simulated={simulated} />
          <SideScore label="PromptLint-hardened" s={hardened} simulated={simulated} accent />
        </div>

        <div className={cx("text-[15px] font-semibold", verdictTone)}>{verdict.text}</div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-800 pt-3 sm:grid-cols-4">
          <Stat label="Model" value={<span className="font-mono text-[13px]">{result.model}</span>} />
          <Stat label="Canary" value={<span className="font-mono text-[13px]">{result.canary}</span>} sub="fresh each run" />
          <Stat
            label="Gateway cost"
            value={result.totalGatewayCostUsd !== undefined ? usd(result.totalGatewayCostUsd, { precise: true }) : "—"}
            sub={result.totalGatewayCostUsd !== undefined ? "billed by Otari" : simulated ? "no calls made" : "not reported"}
          />
          <Stat
            label="Duration"
            value={ms(result.durationMs)}
            sub={failed > 0 ? `${failed} failed call${failed === 1 ? "" : "s"} excluded` : `${original.attempted * 2} calls`}
          />
        </div>
      </div>
    </Card>
  );
}

function SideScore({
  label,
  s,
  simulated,
  accent
}: {
  label: string;
  s: InjectionArenaSideSummary;
  simulated: boolean;
  accent?: boolean;
}) {
  const denom = denominator(s);
  const tone = simulated ? "text-ink-400" : s.succeeded === 0 ? "text-emerald-300" : "text-red-300";
  const bar = s.succeeded === 0 ? "bg-emerald-400" : "bg-red-400";
  return (
    <div className={cx("rounded-lg border bg-ink-850 px-4 py-3", accent ? "border-emerald-500/25" : "border-ink-700")}>
      <div className={cx("flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide", accent ? "text-emerald-300" : "text-ink-400")}>
        {accent ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cx("tabular text-4xl font-semibold tracking-tight", tone)}>
          {s.succeeded}
          <span className="text-2xl text-ink-500">/{denom}</span>
        </span>
        <span className="text-[13px] text-ink-400">attacks broke through</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
        <div className={cx("h-full rounded-full", bar)} style={{ width: `${simulated ? 0 : s.successRatePct}%` }} />
      </div>
      <div className="mt-1.5 text-xs text-ink-500">
        {simulated ? "simulated" : `${s.successRatePct}% success rate`}
        {s.failedCalls > 0 && ` · ${s.failedCalls} failed call${s.failedCalls === 1 ? "" : "s"} excluded`}
      </div>
    </div>
  );
}

function AttackGrid({
  result,
  filter,
  setFilter
}: {
  result: InjectionArenaResponse;
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  const rows = useMemo(
    () =>
      result.results.filter((r) =>
        filter === "original" ? r.original.succeeded : filter === "hardened" ? r.hardened.succeeded : true
      ),
    [result, filter]
  );
  return (
    <Card
      title="Attacks"
      icon={<Swords className="size-4" />}
      bodyClassName="p-0"
      actions={
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All ${result.results.length}` },
            { value: "original", label: `Broke original (${result.summary.original.succeeded})` },
            { value: "hardened", label: `Broke hardened (${result.summary.hardened.succeeded})` }
          ]}
        />
      }
    >
      <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_1.25rem] gap-3 border-b border-ink-700 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-400 md:grid">
        <span>Attack</span>
        <span>Original</span>
        <span>Hardened</span>
        <span />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-400">No attacks in this view.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <AttackRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Outcome({ a }: { a: InjectionArenaAttempt }) {
  if (a.simulated && a.gatewayError) {
    return (
      <Badge tone="orange" title={a.gatewayError}>
        call failed
      </Badge>
    );
  }
  if (a.simulated) return <Badge tone="neutral">simulated</Badge>;
  if (a.succeeded) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone="red" className="font-bold tracking-wider">
          BROKE THROUGH
        </Badge>
        {a.canaryMatch === "near" && (
          <Badge tone="amber" title="The model followed the injection but fumbled joining the canary (at most two character slips).">
            near
          </Badge>
        )}
      </span>
    );
  }
  return <Badge tone="green">held</Badge>;
}

function AttackRow({ r }: { r: InjectionArenaAttackResult }) {
  return (
    <li className="border-b border-ink-800 last:border-0">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-2.5 hover:bg-ink-850 md:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_1.25rem]">
          <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 md:col-span-1">
            <span className="text-[13px] font-medium text-ink-100">{r.name}</span>
            <Badge tone="neutral" mono>
              {r.technique}
            </Badge>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-ink-500 md:hidden">Original</span>
            <Outcome a={r.original} />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-ink-500 md:hidden">Hardened</span>
            <Outcome a={r.hardened} />
          </span>
          <ChevronDown className="hidden size-4 -rotate-90 text-ink-400 transition-transform group-open:rotate-0 md:block" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-ink-800 bg-ink-950/40 px-4 py-3">
          <p className="text-[13px] text-ink-400">{r.description}</p>
          <Block label="Payload injected">{r.payload}</Block>
          <div className="grid gap-3 lg:grid-cols-2">
            <AttemptDetail label="Original output" a={r.original} />
            <AttemptDetail label="Hardened output" a={r.hardened} accent />
          </div>
        </div>
      </details>
    </li>
  );
}

function Block({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <pre
        className={cx(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-5",
          muted ? "text-ink-300" : "text-ink-200"
        )}
      >
        {children}
      </pre>
    </div>
  );
}

function AttemptDetail({ label, a, accent }: { label: string; a: InjectionArenaAttempt; accent?: boolean }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-2 rounded-lg border p-3", accent ? "border-emerald-500/20" : "border-ink-700")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("text-[11px] font-medium uppercase tracking-wide", accent ? "text-emerald-300" : "text-ink-400")}>{label}</span>
        <span className="flex items-center gap-2">
          <Outcome a={a} />
          <span className="tabular text-[11px] text-ink-500">{ms(a.latencyMs)}</span>
        </span>
      </div>
      <GatewayError error={a.gatewayError} />
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-5 text-ink-200">
        {a.output || <span className="text-ink-500">(empty)</span>}
      </pre>
      <details className="group/p">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-ink-200">
          <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open/p:rotate-0" />
          Prompt sent
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-5 text-ink-300">
          {a.promptSent}
        </pre>
      </details>
      <span className="truncate font-mono text-[10.5px] text-ink-500">Otari-Request-ID {a.otariRequestId}</span>
    </div>
  );
}

function PromptsUsed({ result }: { result: InjectionArenaResponse }) {
  return (
    <Card
      title="Prompts under test"
      icon={<ShieldCheck className="size-4" />}
      actions={
        <span className="text-xs text-ink-400">
          {result.targetVariable ? (
            <>
              Payload injected into <code className="font-mono text-ink-200">{result.targetVariable}</code>; other variables set to N/A
            </>
          ) : (
            "Payload appended as the input"
          )}
        </span>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Block label="Original" muted>
          {result.originalPrompt}
        </Block>
        <Block label={`Hardened (${result.hardenedSource === "rules" ? "rule-based rewrite" : "provided"})`} muted>
          {result.hardenedPrompt}
        </Block>
      </div>
    </Card>
  );
}
