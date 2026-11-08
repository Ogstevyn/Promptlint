import fs from "fs";
import path from "path";
import {
  FileScanResult,
  LintDiagnostic,
  PRCostReport,
  RepoScanSummary,
  RuleCategory,
  RuleSeverity
} from "@promptlint/shared";
import { aggregateCostBreakdowns } from "./cost-calculator";
import { scanCodeString } from "./rules";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".promptlint-cache"
]);

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);

function looksLikeLLMFile(content: string): boolean {
  return /(?:chat\.completions\.create|messages\.create|responses\.create|generateText|OpenAI\(|Anthropic\(|SYSTEM_PROMPT|PROMPT)/i.test(
    content
  );
}

export function collectCandidateFiles(targetPath: string): string[] {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return [];
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return [resolved];
  }

  const results: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        results.push(fullPath);
      }
    }
  }

  walk(resolved);
  return results;
}

export function scanRepositoryPath(
  targetPath: string,
  options?: {
    monthlyCallVolume?: number;
    repositoryName?: string;
    branch?: string;
    commitSha?: string;
  }
): RepoScanSummary {
  const monthlyVolume = options?.monthlyCallVolume || 100_000;
  const candidateFiles = collectCandidateFiles(targetPath);
  const fileResults: FileScanResult[] = [];

  for (const filePath of candidateFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (candidateFiles.length === 1 || looksLikeLLMFile(content)) {
      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      const scan = scanCodeString(
        content,
        relPath || path.basename(filePath),
        undefined,
        monthlyVolume
      );
      if (scan.prompts.length > 0) {
        fileResults.push(scan);
      }
    }
  }

  const diagnosticsByCategory: Record<RuleCategory, number> = {
    security: 0,
    caching: 0,
    cost: 0,
    latency: 0,
    "otari-routing": 0
  };

  const diagnosticsBySeverity: Record<RuleSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0
  };

  let totalPromptsFound = 0;
  let totalDiagnostics = 0;

  for (const file of fileResults) {
    totalPromptsFound += file.prompts.length;
    totalDiagnostics += file.diagnostics.length;
    for (const d of file.diagnostics) {
      diagnosticsByCategory[d.category] =
        (diagnosticsByCategory[d.category] || 0) + 1;
      diagnosticsBySeverity[d.severity] =
        (diagnosticsBySeverity[d.severity] || 0) + 1;
    }
  }

  const aggregateCost = aggregateCostBreakdowns(
    fileResults.map((f) => f.costBreakdown),
    monthlyVolume
  );

  const avgScore =
    fileResults.length > 0
      ? Math.round(
          fileResults.reduce((acc, f) => acc + f.score, 0) / fileResults.length
        )
      : 100;

  return {
    scanId: `scan_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    repository: options?.repositoryName || "ogstevyn/Promptlint",
    branch: options?.branch || "main",
    commitSha: options?.commitSha || "HEAD",
    totalFilesScanned: candidateFiles.length,
    filesWithPrompts: fileResults.length,
    totalPromptsFound,
    totalDiagnostics,
    diagnosticsByCategory,
    diagnosticsBySeverity,
    overallHealthScore: avgScore,
    aggregateCost,
    files: fileResults
  };
}

export function generatePRMarkdownReport(summary: RepoScanSummary): string {
  const c = summary.aggregateCost;
  const allDiagnostics: LintDiagnostic[] = summary.files.flatMap(
    (f) => f.diagnostics
  );
  const statusBadge =
    summary.diagnosticsBySeverity.error > 0
      ? "Action Required (Security / Gateway Routing)"
      : summary.diagnosticsBySeverity.warning > 0
      ? "Optimization Recommended"
      : "Passed";

  const diagnosticRows = allDiagnostics
    .slice(0, 12)
    .map(
      (d) =>
        `| \`${d.ruleId}\` | **${d.severity.toUpperCase()}** | \`${d.filePath}:L${d.line}\` | ${d.message} | ${
          d.estimatedMonthlySavingsUsd
            ? `-$${d.estimatedMonthlySavingsUsd.toFixed(2)}/mo`
            : "Security / Governance"
        } |`
    )
    .join("\n");

  return `## PromptLint x Mozilla Otari — PR LLM Cost & Security Report

**Status:** ${statusBadge} | **Health Score:** \`${summary.overallHealthScore}/100\` | **Prompts Scanned:** \`${summary.totalPromptsFound}\`

### Monthly Projected LLM Spend (at ${(c.monthlyCallVolume / 1000).toFixed(0)}k calls/mo per endpoint)

| Metric | Current (Direct SDK) | Optimized (via Mozilla Otari Gateway) | Projected Savings |
| :--- | :--- | :--- | :--- |
| **Input Tokens / Call** | \`${c.currentInputTokensPerCall} toks\` | \`${c.optimizedInputTokensPerCall} toks\` | **-${
    c.currentInputTokensPerCall > 0
      ? Math.round(
          ((c.currentInputTokensPerCall - c.optimizedInputTokensPerCall) /
            c.currentInputTokensPerCall) *
            100
        )
      : 0
  }% tokens** |
| **Monthly Spend** | \`$${c.currentMonthlyCostUsd.toFixed(2)}/mo\` | \`$${c.optimizedMonthlyCostUsd.toFixed(2)}/mo\` | **-$${c.monthlySavingsUsd.toFixed(2)}/mo (-${c.savingsPercentage}%)** |
| **Annualized Spend** | \`$${(c.currentMonthlyCostUsd * 12).toFixed(2)}/yr\` | \`$${(c.optimizedMonthlyCostUsd * 12).toFixed(2)}/yr\` | **-$${c.annualSavingsUsd.toFixed(2)}/yr** |

#### Savings Breakdown via Mozilla Otari (\`/api/v1\`)
- **Smart Model Tier Routing (\`PL005\`):** \`-$${c.breakdownBySource.smartModelRoutingUsd.toFixed(2)}/mo\`
- **Ephemeral Prefix Caching (\`cache_control\`, \`PL003\`):** \`-$${c.breakdownBySource.otariPrefixCachingUsd.toFixed(2)}/mo\`
- **Otari Idempotent Replay Cache (\`Idempotency-Key\`, \`PL008\`):** \`-$${c.breakdownBySource.otariIdempotencyReplayUsd.toFixed(2)}/mo\`
- **Prompt Token Compression (\`PL004\`):** \`-$${c.breakdownBySource.promptCompressionUsd.toFixed(2)}/mo\`

---

### Lint Findings (${allDiagnostics.length} total: ${summary.diagnosticsBySeverity.error} errors, ${summary.diagnosticsBySeverity.warning} warnings, ${summary.diagnosticsBySeverity.info} info)

| Rule | Severity | Location | Finding | Est. Impact |
| :--- | :--- | :--- | :--- | :--- |
${diagnosticRows || "| - | - | - | No issues detected | $0.00 |"}

> Run \`npx promptlint optimize <file> --write\` to automatically wrap untrusted inputs in \`<user_input>\` tags, reorder static context for \`cache_control\`, and route requests through **Mozilla Otari Gateway**.
`;
}

export function buildPRCostReport(
  summary: RepoScanSummary,
  meta?: {
    prNumber?: number;
    prTitle?: string;
    author?: string;
    baseBranch?: string;
    headBranch?: string;
  }
): PRCostReport {
  const allDiagnostics = summary.files.flatMap((f) => f.diagnostics);
  return {
    id: `pr_${meta?.prNumber || 42}_${Date.now().toString(36)}`,
    prNumber: meta?.prNumber || 42,
    prTitle:
      meta?.prTitle ||
      "feat(ai): add customer support triage & PR review prompts",
    repository: summary.repository,
    author: meta?.author || "ogstevyn",
    baseBranch: meta?.baseBranch || "main",
    headBranch: meta?.headBranch || "feat/llm-triage-agent",
    commitSha: summary.commitSha || "a81f92c",
    createdAt: summary.timestamp,
    status:
      summary.diagnosticsBySeverity.error > 0
        ? "blocked"
        : summary.diagnosticsBySeverity.warning > 0
        ? "warning"
        : "pass",
    healthScore: summary.overallHealthScore,
    promptsAnalyzed: summary.totalPromptsFound,
    issuesFound: {
      errors: summary.diagnosticsBySeverity.error,
      warnings: summary.diagnosticsBySeverity.warning,
      info: summary.diagnosticsBySeverity.info
    },
    costSummary: summary.aggregateCost,
    markdownComment: generatePRMarkdownReport(summary),
    diagnostics: allDiagnostics
  };
}
