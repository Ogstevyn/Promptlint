import { useCallback, useEffect, useState } from "react";
import { Gauge, GitPullRequest, LayoutDashboard, SquareTerminal, Swords } from "lucide-react";
import type { BenchmarkResponse, DemoPreset, FileScanResult, ModelPricing, OptimizeResponse, SourceLanguage } from "@promptlint/shared";
import { api, API_BASE_URL } from "./lib/api";
import { cx } from "./components/ui";
import { Playground } from "./screens/Playground";
import { Benchmark } from "./screens/Benchmark";
import { Reports } from "./screens/Reports";
import { Dashboard } from "./screens/Dashboard";
import { Arena, type ArenaState } from "./screens/Arena";

export type TabId = "playground" | "benchmark" | "arena" | "reports" | "dashboard";

const TABS: Array<{ id: TabId; label: string; icon: typeof Gauge }> = [
  { id: "playground", label: "Playground", icon: SquareTerminal },
  { id: "benchmark", label: "Benchmark", icon: Gauge },
  { id: "arena", label: "Injection Arena", icon: Swords },
  { id: "reports", label: "PR Reports", icon: GitPullRequest },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard }
];

export interface PlaygroundState {
  presetId: string | null;
  code: string;
  filename: string;
  language: SourceLanguage | undefined;
  volume: number;
  lint: FileScanResult | null;
  /** The code the current lint result was computed from, to flag stale results */
  lintedCode: string;
  optimize: OptimizeResponse | null;
}

export interface BenchmarkInputs {
  originalPrompt: string;
  optimizedPrompt: string;
  testInput: string;
  originalModel: string;
  optimizedModel: string;
}

export interface BenchmarkRun {
  n: number;
  at: number;
  result: BenchmarkResponse;
}

type Health = Awaited<ReturnType<typeof api.health>>;

function tabFromHash(): TabId {
  const h = window.location.hash.replace("#", "");
  return (TABS.some((t) => t.id === h) ? h : "playground") as TabId;
}

export default function App() {
  const [tab, setTabState] = useState<TabId>(tabFromHash);
  const [health, setHealth] = useState<Health | null | "down">(null);
  const [presets, setPresets] = useState<DemoPreset[]>([]);
  const [models, setModels] = useState<ModelPricing[]>([]);

  const [pg, setPg] = useState<PlaygroundState>({
    presetId: null,
    code: "",
    filename: "playground.ts",
    language: undefined,
    volume: 100_000,
    lint: null,
    lintedCode: "",
    optimize: null
  });

  const [benchInputs, setBenchInputs] = useState<BenchmarkInputs>({
    originalPrompt: "",
    optimizedPrompt: "",
    testInput: "",
    originalModel: "",
    optimizedModel: ""
  });
  const [benchRuns, setBenchRuns] = useState<BenchmarkRun[]>([]);
  const [arena, setArena] = useState<ArenaState>({ presetId: null, model: "", result: null });

  const setTab = useCallback((t: TabId) => {
    setTabState(t);
    if (window.location.hash !== `#${t}`) window.history.replaceState(null, "", `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth("down"));
    api.getModelsAndRules().then((r) => setModels(r.models)).catch(() => undefined);
    api
      .getPresets()
      .then((list) => {
        setPresets(list);
        const first = list[0];
        if (first) {
          setPg((s) =>
            s.code
              ? s
              : { ...s, presetId: first.id, code: first.code, filename: first.filename, language: first.language }
          );
          setBenchInputs((b) => (b.testInput ? b : { ...b, testInput: first.sampleTestInput }));
        }
      })
      .catch(() => undefined);
  }, []);

  const sendToBenchmark = useCallback(() => {
    const opt = pg.optimize;
    if (!opt) return;
    const preset = presets.find((p) => p.id === pg.presetId);
    setBenchInputs((b) => ({
      ...b,
      originalPrompt: opt.originalPrompt,
      optimizedPrompt: opt.optimizedPrompt,
      testInput: preset?.sampleTestInput || b.testInput
    }));
    setBenchRuns([]);
    setTab("benchmark");
  }, [pg.optimize, pg.presetId, presets, setTab]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <a href="#playground" onClick={() => setTab("playground")} className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-brand text-ink-950">
              <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
                <path d="M10 8v15h10" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink-100">PromptLint</span>
            <span className="hidden text-xs text-ink-500 md:inline">× Mozilla Otari</span>
          </a>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                  tab === id ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:bg-ink-900 hover:text-ink-200"
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto">
            <GatewayStatus health={health} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
        {tab === "playground" && (
          <Playground presets={presets} state={pg} setState={setPg} onBenchmark={sendToBenchmark} />
        )}
        {tab === "benchmark" && (
          <Benchmark
            inputs={benchInputs}
            setInputs={setBenchInputs}
            runs={benchRuns}
            setRuns={setBenchRuns}
            models={models}
            volume={pg.volume}
            hasOptimized={!!pg.optimize}
            goToPlayground={() => setTab("playground")}
          />
        )}
        {tab === "arena" && <Arena presets={presets} models={models} state={arena} setState={setArena} />}
        {tab === "reports" && <Reports />}
        {tab === "dashboard" && <Dashboard />}
      </main>
    </div>
  );
}

function GatewayStatus({ health }: { health: Health | null | "down" }) {
  if (health === null) {
    return <span className="text-xs text-ink-500">Connecting…</span>;
  }
  if (health === "down") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-300">
        <span className="size-1.5 rounded-full bg-red-400" />
        API offline · {API_BASE_URL}
      </span>
    );
  }
  const host = (() => {
    try {
      return new URL(health.otariBaseUrl).host;
    } catch {
      return health.otariBaseUrl;
    }
  })();
  return health.otariConfigured ? (
    <span
      className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300"
      title={`OTARI_API_KEY is set; calls go to ${health.otariBaseUrl}`}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="size-1.5 rounded-full bg-emerald-400" />
      </span>
      Otari key set · <span className="font-mono">{host}</span>
    </span>
  ) : (
    <span
      className="flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 text-xs text-orange-300"
      title="No OTARI_API_KEY on the server: optimize and benchmark results will be simulated."
    >
      <span className="size-1.5 rounded-full bg-orange-400" />
      No Otari key · simulator only
    </span>
  );
}
