#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  buildPRCostReport,
  generatePRMarkdownReport,
  optimizePromptAndCode,
  scanRepositoryPath
} from "@promptlint/core";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

function printBanner() {
  console.log(
    `${COLORS.cyan}${COLORS.bold}=========================================================================${COLORS.reset}`
  );
  console.log(
    `${COLORS.cyan}${COLORS.bold}  PromptLint v1.0.0${COLORS.reset} — LLM Linter, Optimizer & Mozilla Otari Gateway Router`
  );
  console.log(
    `${COLORS.cyan}${COLORS.bold}=========================================================================${COLORS.reset}\n`
  );
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function postGitHubPRComment(markdown: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.GITHUB_PR_NUMBER || process.env.PR_NUMBER;

  if (!token || !repo || !prNumber) {
    return false;
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: markdown })
  });

  return res.ok;
}

async function runScanCommand(args: string[]) {
  const target = args.find((a) => !a.startsWith("--")) || "./examples/vulnerable-app";
  const volumeStr = getFlagValue(args, "--volume");
  const monthlyVolume = volumeStr ? parseInt(volumeStr, 10) : 100_000;
  const isJson = args.includes("--json");

  const summary = scanRepositoryPath(target, {
    monthlyCallVolume: monthlyVolume
  });

  if (isJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printBanner();
  console.log(
    `Scanning target: ${COLORS.bold}${path.resolve(target)}${COLORS.reset}`
  );
  console.log(
    `Files scanned: ${summary.totalFilesScanned} | Files with LLM prompts: ${summary.filesWithPrompts} | Total prompts: ${summary.totalPromptsFound}\n`
  );

  for (const file of summary.files) {
    const scoreColor =
      file.score >= 80
        ? COLORS.green
        : file.score >= 50
        ? COLORS.yellow
        : COLORS.red;
    console.log(
      `${COLORS.bold}${file.filePath}${COLORS.reset} (${file.language}) — Health Score: ${scoreColor}${COLORS.bold}${file.score}/100${COLORS.reset}`
    );

    for (const d of file.diagnostics) {
      const badge =
        d.severity === "error"
          ? `${COLORS.red}${COLORS.bold}[ERROR]${COLORS.reset}`
          : d.severity === "warning"
          ? `${COLORS.yellow}${COLORS.bold}[WARN] ${COLORS.reset}`
          : `${COLORS.cyan}${COLORS.bold}[INFO] ${COLORS.reset}`;
      console.log(
        `  ${badge} ${COLORS.bold}${d.ruleId}${COLORS.reset} (${d.ruleName}) at line ${d.line}`
      );
      console.log(`         ${d.message}`);
      if (d.suggestedFix) {
        console.log(
          `         ${COLORS.green}Fix:${COLORS.reset} ${d.suggestedFix}`
        );
      }
      if (d.estimatedMonthlySavingsUsd && d.estimatedMonthlySavingsUsd > 0) {
        console.log(
          `         ${COLORS.magenta}Est. Savings:${COLORS.reset} -$${d.estimatedMonthlySavingsUsd.toFixed(
            2
          )}/mo`
        );
      }
    }
    console.log("");
  }

  const c = summary.aggregateCost;
  console.log(
    `${COLORS.cyan}${COLORS.bold}--- Mozilla Otari Gateway Cost & Caching Projection (${(
      c.monthlyCallVolume / 1000
    ).toFixed(0)}k calls/mo) ---${COLORS.reset}`
  );
  console.log(
    `  Current Monthly Spend (Direct SDK):     ${COLORS.red}$${c.currentMonthlyCostUsd.toFixed(
      2
    )}/mo${COLORS.reset}`
  );
  console.log(
    `  Optimized Spend (via Mozilla Otari):    ${COLORS.green}$${c.optimizedMonthlyCostUsd.toFixed(
      2
    )}/mo${COLORS.reset}`
  );
  console.log(
    `  Projected Monthly Savings:              ${COLORS.green}${COLORS.bold}-$${c.monthlySavingsUsd.toFixed(
      2
    )}/mo (-${c.savingsPercentage}%)${COLORS.reset}`
  );
  console.log(
    `  Projected Annual Savings:               ${COLORS.green}${COLORS.bold}-$${c.annualSavingsUsd.toFixed(
      2
    )}/yr${COLORS.reset}`
  );
  console.log(
    `    ├─ Smart Model Tier Routing (PL005):  -$${c.breakdownBySource.smartModelRoutingUsd.toFixed(
      2
    )}/mo`
  );
  console.log(
    `    ├─ Otari Prefix Caching (PL003):      -$${c.breakdownBySource.otariPrefixCachingUsd.toFixed(
      2
    )}/mo`
  );
  console.log(
    `    ├─ Otari Idempotency Replay (PL008):  -$${c.breakdownBySource.otariIdempotencyReplayUsd.toFixed(
      2
    )}/mo`
  );
  console.log(
    `    └─ Prompt Token Compression (PL004):  -$${c.breakdownBySource.promptCompressionUsd.toFixed(
      2
    )}/mo\n`
  );
}

async function runOptimizeCommand(args: string[]) {
  const targetFile = args.find((a) => !a.startsWith("--"));
  if (!targetFile) {
    console.error("Usage: promptlint optimize <filePath> [--write] [--model <model>]");
    process.exit(1);
  }

  const resolved = path.resolve(targetFile);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const writeInPlace = args.includes("--write") || args.includes("--fix");
  const targetModel = getFlagValue(args, "--model");
  const code = fs.readFileSync(resolved, "utf-8");

  printBanner();
  console.log(`Optimizing ${COLORS.bold}${targetFile}${COLORS.reset} via Mozilla Otari Gateway...\n`);

  const result = await optimizePromptAndCode({
    code,
    filename: targetFile,
    targetModel
  });

  const t = result.otariTelemetry;
  const tokenDelta = result.tokenReductionPercentage;
  console.log(`${COLORS.bold}Mozilla Otari Telemetry:${COLORS.reset}`);
  console.log(
    `  Mode:                ${
      t.simulated
        ? `${COLORS.yellow}SIMULATED${COLORS.reset} (${
            t.gatewayError ? `gateway call failed: ${t.gatewayError}` : "set OTARI_API_KEY for live gateway calls"
          })`
        : `${COLORS.green}LIVE${COLORS.reset} via Otari`
    }`
  );
  console.log(`  Optimizer:           ${result.optimizerSource === "llm" ? "LLM rewrite (validated)" : "rule-based rewrite"}`);
  console.log(`  Endpoint:            ${result.otariTelemetry.otariEndpoint}`);
  console.log(`  Otari-Request-ID:    ${result.otariTelemetry.otariRequestId}`);
  console.log(`  Idempotency-Key:     ${result.otariTelemetry.idempotencyKey.slice(0, 24)}...`);
  console.log(`  Idempotent Replayed: ${result.otariTelemetry.idempotentReplayed}`);
  console.log(`  Cache Control:       ephemeral (enabled)`);
  console.log(
    `  Prompt Tokens:       ${result.originalTokens} -> ${result.optimizedTokens} (${
      tokenDelta >= 0 ? `-${tokenDelta}%` : `+${Math.abs(tokenDelta)}%, security guards added`
    })`
  );
  console.log(`  Monthly Savings:     -$${result.costBreakdown.monthlySavingsUsd.toFixed(2)}/mo (-${result.costBreakdown.savingsPercentage}%)\n`);

  console.log(`${COLORS.bold}Optimizations Applied:${COLORS.reset}`);
  for (const exp of result.explanation) {
    console.log(`  ${COLORS.green}✓${COLORS.reset} ${exp}`);
  }

  console.log(`\n${COLORS.bold}--- Optimized Code (Routed via Mozilla Otari) ---${COLORS.reset}`);
  console.log(result.optimizedCode);

  if (writeInPlace) {
    fs.writeFileSync(resolved, result.optimizedCode, "utf-8");
    console.log(
      `\n${COLORS.green}${COLORS.bold}Updated ${targetFile} in place.${COLORS.reset}`
    );
  }
}

async function runCiReportCommand(args: string[]) {
  const target = args.find((a) => !a.startsWith("--")) || "./examples/vulnerable-app";
  const outputFile = getFlagValue(args, "--output");
  const isJson = args.includes("--json");
  const volumeStr = getFlagValue(args, "--volume");
  const monthlyVolume = volumeStr ? parseInt(volumeStr, 10) : 100_000;

  const summary = scanRepositoryPath(target, { monthlyCallVolume: monthlyVolume });
  const prReport = buildPRCostReport(summary);
  const markdown = generatePRMarkdownReport(summary);

  if (outputFile) {
    fs.writeFileSync(path.resolve(outputFile), markdown, "utf-8");
  }

  if (isJson) {
    console.log(JSON.stringify(prReport, null, 2));
  } else {
    console.log(markdown);
  }

  // Post only when explicitly asked, so the Action's post-pr-comment: false is respected
  if (args.includes("--post-pr")) {
    const posted = await postGitHubPRComment(markdown);
    if (posted) {
      console.error("Posted PromptLint x Mozilla Otari cost report to GitHub PR.");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "scan";
  const subArgs = args.slice(1);

  switch (command) {
    case "scan":
    case "lint":
      await runScanCommand(subArgs);
      break;
    case "optimize":
    case "fix":
      await runOptimizeCommand(subArgs);
      break;
    case "ci-report":
    case "report":
      await runCiReportCommand(subArgs);
      break;
    default:
      printBanner();
      console.log("Commands:");
      console.log("  promptlint scan [dir|file] [--volume 100000] [--json]");
      console.log("  promptlint optimize <file> [--write] [--model gpt-4o-mini]");
      console.log("  promptlint ci-report [dir|file] [--output report.md] [--volume 100000] [--post-pr]");
      break;
  }
}

main().catch((err) => {
  console.error("PromptLint CLI Error:", err);
  process.exit(1);
});
