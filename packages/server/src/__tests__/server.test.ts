import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Keep tests deterministic even when a real OTARI_API_KEY is in .env
process.env.PROMPTLINT_OFFLINE = "1";
import http from "node:http";
import { createPromptLintServer } from "../app";

describe("@promptlint/server REST API contract for Frontend", () => {
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    server = createPromptLintServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/v1/health returns service status and Otari configuration", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.status, "ok");
    assert.ok(body.otariBaseUrl.includes("otari"));
  });

  it("GET /api/v1/presets and GET /api/v1/stats return seeded data for the frontend dashboard", async () => {
    const presetsRes = await fetch(`${baseUrl}/api/v1/presets`);
    assert.equal(presetsRes.status, 200);
    const presets = (await presetsRes.json()) as any[];
    assert.ok(presets.length >= 3);

    const statsRes = await fetch(`${baseUrl}/api/v1/stats`);
    assert.equal(statsRes.status, 200);
    const stats = (await statsRes.json()) as any;
    assert.ok(stats.totalMonthlySavingsUsd > 0);
    assert.equal(stats.ruleDistribution.length, 8);
    assert.equal(stats.demoSeed, true);
  });

  it("POST /api/v1/lint and POST /api/v1/optimize process code and return savings & rewrites", async () => {
    const sampleCode = `
import OpenAI from "openai";
const client = new OpenAI();
export const run = (q: string) => client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: \`Query: \${q} Please could you kindly classify this as true or false. Thank you so much in advance for your help!\` }]
});
`;
    const lintRes = await fetch(`${baseUrl}/api/v1/lint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: sampleCode, filename: "demo.ts" })
    });
    assert.equal(lintRes.status, 200);
    const lintData = (await lintRes.json()) as any;
    assert.ok(lintData.diagnostics.length >= 5);

    const optRes = await fetch(`${baseUrl}/api/v1/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: sampleCode, filename: "demo.ts" })
    });
    assert.equal(optRes.status, 200);
    const optData = (await optRes.json()) as any;
    assert.ok(optData.optimizedCode.includes("Otari-Key"));
    assert.equal(optData.otariTelemetry.simulated, true);
    assert.equal(optData.otariTelemetry.routedViaOtari, false);
    assert.equal(optData.optimizerSource, "rules");
  });
});
