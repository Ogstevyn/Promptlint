import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, GitBranch, GitCommitHorizontal, GitPullRequest, Plus, RefreshCw } from "lucide-react";
import type { PRCostReport } from "@promptlint/shared";
import { api, errorMessage } from "../lib/api";
import { relativeTime, usd } from "../lib/format";
import { DemoDataBadge, severityStyles } from "../components/honesty";
import { Badge, Button, Card, EmptyState, ErrorBanner, Spinner, Stat, cx } from "../components/ui";

const statusStyle: Record<PRCostReport["status"], { tone: "green" | "amber" | "red"; label: string; icon: string }> = {
  pass: { tone: "green", label: "Pass", icon: "text-emerald-400" },
  warning: { tone: "amber", label: "Warning", icon: "text-amber-400" },
  blocked: { tone: "red", label: "Blocked", icon: "text-red-400" }
};

export function Reports() {
  const [reports, setReports] = useState<PRCostReport[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PRCostReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selectId?: string) => {
    setError(null);
    try {
      const list = await api.getPRReports();
      setReports(list);
      setSelectedId((cur) => selectId ?? cur ?? list[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err));
      setReports((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    api
      .getPRReportById(selectedId)
      .then((r) => !cancelled && setDetail(r))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const simulateScan = async () => {
    setCreating(true);
    setError(null);
    try {
      const report = await api.createPRReport();
      await load(report.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-100">PR cost reports</h1>
          <p className="text-[13px] text-ink-400">The comment the PromptLint GitHub Action posts on each pull request.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => load()} icon={<RefreshCw className="size-3.5" />}>
            Refresh
          </Button>
          <Button variant="primary" onClick={simulateScan} loading={creating} icon={<Plus className="size-4" />}>
            Simulate new CI scan
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card bodyClassName="p-1.5" className="self-start">
          {reports === null ? (
            <div className="p-3">
              <Spinner label="Loading reports…" />
            </div>
          ) : reports.length === 0 ? (
            <EmptyState icon={<GitPullRequest className="size-6" />} title="No reports yet" />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={cx(
                      "flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                      selectedId === r.id ? "bg-ink-800" : "hover:bg-ink-850"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GitPullRequest className={cx("mt-0.5 size-4 shrink-0", statusStyle[r.status].icon)} />
                      <span className="line-clamp-2 text-[13px] font-medium leading-5 text-ink-100">{r.prTitle}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-ink-400">
                      <span className="font-mono">#{r.prNumber}</span>
                      <span>·</span>
                      <span>{relativeTime(r.createdAt)}</span>
                      <span>·</span>
                      <span className="tabular text-emerald-300">−{usd(r.costSummary.monthlySavingsUsd)}/mo</span>
                      {r.demoSeed && <DemoDataBadge />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0">
          {!detail ? (
            <Card>{detailLoading ? <Spinner label="Loading report…" /> : <EmptyState icon={<GitPullRequest className="size-6" />} title="Select a report" />}</Card>
          ) : (
            <ReportDetail report={detail} loading={detailLoading} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReportDetail({ report: r, loading }: { report: PRCostReport; loading: boolean }) {
  const st = statusStyle[r.status];
  return (
    <div className={cx("flex flex-col gap-4 transition-opacity", loading && "opacity-60")}>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-6 text-ink-100">
                {r.prTitle} <span className="font-normal text-ink-400">#{r.prNumber}</span>
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                <span className="font-mono">{r.repository}</span>
                <span className="flex items-center gap-1 font-mono">
                  <GitBranch className="size-3.5" />
                  {r.headBranch} → {r.baseBranch}
                </span>
                <span className="flex items-center gap-1 font-mono">
                  <GitCommitHorizontal className="size-3.5" />
                  {r.commitSha.slice(0, 7)}
                </span>
                <span>by {r.author}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.demoSeed && <DemoDataBadge />}
              <Badge tone={st.tone} className="font-semibold">
                {st.label}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-ink-700 pt-4 sm:grid-cols-4">
            <Stat label="Health score" value={`${r.healthScore}/100`} tone={r.healthScore >= 80 ? "green" : r.healthScore >= 50 ? "amber" : "red"} />
            <Stat label="Prompts analyzed" value={r.promptsAnalyzed} />
            <Stat
              label="Issues"
              value={
                <span className="flex items-center gap-2.5 text-base">
                  <span className={severityStyles.error.text}>{r.issuesFound.errors}</span>
                  <span className={severityStyles.warning.text}>{r.issuesFound.warnings}</span>
                  <span className={severityStyles.info.text}>{r.issuesFound.info}</span>
                </span>
              }
              sub="errors · warnings · info"
            />
            <Stat label="Savings / month" value={usd(r.costSummary.monthlySavingsUsd)} tone="green" sub="catalog estimate" />
          </div>
        </div>
      </Card>

      <section className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <header className="flex flex-wrap items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2.5 text-[13px]">
          <span className="grid size-6 place-items-center rounded-full bg-brand/20 text-brand-soft">
            <Bot className="size-3.5" />
          </span>
          <span className="font-semibold text-ink-100">promptlint</span>
          <Badge>bot</Badge>
          <span className="text-ink-400">commented {relativeTime(r.createdAt)}</span>
          {r.demoSeed && <span className="ml-auto text-xs text-ink-500">Seeded example comment</span>}
        </header>
        <div className="markdown px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.markdownComment}</ReactMarkdown>
        </div>
      </section>
    </div>
  );
}
