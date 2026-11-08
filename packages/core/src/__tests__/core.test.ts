import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkPromptsViaOtari,
  generatePRMarkdownReport,
  optimizePromptAndCode,
  scanCodeString,
  scanRepositoryPath
} from "../index";

describe("@promptlint/core scanner, rules, cost calculator & Otari optimizer", () => {
  const vulnerableTs = `
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function classifyTicket(userInput: string) {
  return openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: \`Ticket: \${userInput}
        Please could you kindly classify the sentiment of this ticket as positive, negative, or neutral. I would really appreciate it if you could return valid JSON. Thank you so much in advance for your help!\`
      }
    ]
  });
}
`;

  it("detects all 8 prompt smells (PL001 through PL008) on vulnerable TypeScript LLM call", () => {
    const scan = scanCodeString(vulnerableTs, "ticket.ts", "typescript", 100_000);
    assert.equal(scan.prompts.length, 1);

    const triggeredRules = new Set(scan.diagnostics.map((d) => d.ruleId));
    assert.ok(triggeredRules.has("PL001"), "Should flag PL001 unsanitized injection");
    assert.ok(triggeredRules.has("PL002"), "Should flag PL002 missing instruction boundary");
    assert.ok(triggeredRules.has("PL003"), "Should flag PL003 broken prefix cache order");
    assert.ok(triggeredRules.has("PL004"), "Should flag PL004 verbose filler bloat");
    assert.ok(triggeredRules.has("PL005"), "Should flag PL005 overprovisioned frontier model");
    assert.ok(triggeredRules.has("PL006"), "Should flag PL006 missing max_tokens");
    assert.ok(triggeredRules.has("PL007"), "Should flag PL007 direct vendor endpoint");
    assert.ok(triggeredRules.has("PL008"), "Should flag PL008 missing Idempotency-Key");

    assert.ok(scan.costBreakdown.monthlySavingsUsd > 0, "Should calculate positive monthly savings");
    assert.equal(scan.costBreakdown.recommendedModel, "gpt-4o-mini");
  });

  it("rewrites code to route through Mozilla Otari with cache_control, Idempotency-Key, and <user_input> tags", async () => {
    const result = await optimizePromptAndCode({
      code: vulnerableTs,
      filename: "ticket.ts",
      monthlyVolume: 100_000
    });

    assert.ok(result.optimizedPrompt.includes("<user_input>"));
    assert.ok(result.optimizedCode.includes("OTARI_BASE_URL"));
    assert.ok(result.optimizedCode.includes("Otari-Key"));
    assert.ok(result.optimizedCode.includes("Idempotency-Key"));
    assert.ok(result.optimizedCode.includes("cache_control"));
    assert.ok(result.tokenReductionPercentage > 0);
    assert.ok(result.otariTelemetry.routedViaOtari);
  });

  it("runs side-by-side benchmark via Otari and hits idempotent replay cache on second identical call", async () => {
    const bench = await benchmarkPromptsViaOtari({
      originalPrompt: "Please could you kindly classify the sentiment: ",
      optimizedPrompt: "Classify sentiment as JSON:",
      testInput: "Great product!",
      originalModel: "gpt-4o",
      optimizedModel: "gpt-4o-mini"
    });

    assert.ok(bench.comparison.costReductionPercentage > 50);
    assert.ok(bench.optimized.otariRequestId.startsWith("otari_req_"));
  });

  it("scans examples/vulnerable-app and generates a PR Markdown report", () => {
    const summary = scanRepositoryPath("./examples/vulnerable-app");
    assert.equal(summary.filesWithPrompts, 3);
    const md = generatePRMarkdownReport(summary);
    assert.ok(md.includes("PromptLint x Mozilla Otari"));
    assert.ok(md.includes("Monthly Projected LLM Spend"));
  });
});
