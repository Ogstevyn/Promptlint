import http from "http";
import path from "path";
import {
  LINT_RULES_CATALOG,
  MODEL_PRICING_CATALOG
} from "@promptlint/shared";
import {
  OtariGatewayClient,
  benchmarkPromptsViaOtari,
  listInjectionAttacks,
  optimizePromptAndCode,
  otariFeatureConfig,
  runInjectionArena,
  scanCodeString
} from "@promptlint/core";
import { DEMO_PRESETS, telemetryStore } from "./store";

// Resolve from the repo root (dist/app.js -> packages/server/dist), not the process cwd,
// which is packages/server under `npm run dev:server`.
const DEFAULT_SCAN_TARGET = path.resolve(__dirname, "../../../examples/vulnerable-app");

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Otari-Key, Idempotency-Key, X-PromptLint-User"
  );
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** The end user a request acts for: body.user or the X-PromptLint-User header (sanitised) */
function resolveUser(req: http.IncomingMessage, body?: any): string | undefined {
  const raw = (typeof body?.user === "string" ? body.user : undefined) ?? req.headers["x-promptlint-user"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_.:@-]+$/.test(cleaned) ? cleaned : undefined;
}

function guardrailModeOf(value: unknown): "off" | "monitor" | "block" | undefined {
  return value === "off" || value === "monitor" || value === "block" ? value : undefined;
}

export function createPromptLintServer(): http.Server {
  return http.createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = urlObj.pathname.replace(/\/+$/, "") || "/";

    try {
      // 1. Health & Otari Gateway Status
      if (req.method === "GET" && (pathname === "/" || pathname === "/api/v1/health")) {
        const client = new OtariGatewayClient();
        return sendJson(res, 200, {
          status: "ok",
          service: "@promptlint/server",
          version: "1.0.0",
          otariConfigured: client.isConfigured(),
          otariBaseUrl: client.getBaseUrl(),
          otariFeatures: otariFeatureConfig(),
          endpoints: [
            "GET  /api/v1/health",
            "GET  /api/v1/presets",
            "GET  /api/v1/models",
            "GET  /api/v1/stats",
            "GET  /api/v1/reports",
            "GET  /api/v1/reports/:id",
            "POST /api/v1/reports",
            "POST /api/v1/lint",
            "POST /api/v1/optimize",
            "POST /api/v1/benchmark",
            "GET  /api/v1/injection-arena/attacks",
            "POST /api/v1/injection-arena",
            "GET  /api/v1/otari/budget?user=..."
          ]
        });
      }

      // Otari per-user budget of an end user (service key + OTARI_END_USERS=1)
      if (req.method === "GET" && pathname === "/api/v1/otari/budget") {
        const user = resolveUser(req, { user: urlObj.searchParams.get("user") ?? undefined });
        const client = new OtariGatewayClient();
        if (!user) {
          return sendJson(res, 400, { error: "Query `user` is required ([A-Za-z0-9_.:@-], up to 64 characters)" });
        }
        return sendJson(res, 200, await client.getEndUserBudgetStatus(user));
      }

      // 2. Demo Presets for Frontend Playground
      if (req.method === "GET" && pathname === "/api/v1/presets") {
        return sendJson(res, 200, DEMO_PRESETS);
      }

      // 3. Models Pricing & Lint Rules Catalog
      if (req.method === "GET" && pathname === "/api/v1/models") {
        return sendJson(res, 200, {
          models: Object.values(MODEL_PRICING_CATALOG),
          rules: Object.values(LINT_RULES_CATALOG)
        });
      }

      // 4. Dashboard Aggregated Telemetry & Stats
      if (req.method === "GET" && pathname === "/api/v1/stats") {
        return sendJson(res, 200, telemetryStore.getDashboardStats());
      }

      // 5. List PR Cost Reports
      if (req.method === "GET" && pathname === "/api/v1/reports") {
        return sendJson(res, 200, telemetryStore.getPRReports());
      }

      // 6. Get Single PR Cost Report by ID or PR number
      if (req.method === "GET" && pathname.startsWith("/api/v1/reports/")) {
        const reportId = decodeURIComponent(pathname.replace("/api/v1/reports/", ""));
        const report = telemetryStore.getPRReportById(reportId);
        if (!report) {
          return sendJson(res, 404, { error: `PR report '${reportId}' not found` });
        }
        return sendJson(res, 200, report);
      }

      // 7. Create/Trigger a PR Cost Report
      if (req.method === "POST" && pathname === "/api/v1/reports") {
        const body = await readJsonBody(req);
        const targetPath = body.targetPath || DEFAULT_SCAN_TARGET;
        const report = telemetryStore.createPRReportFromPath(targetPath, {
          prNumber: body.prNumber,
          prTitle: body.prTitle,
          author: body.author,
          baseBranch: body.baseBranch,
          headBranch: body.headBranch
        });
        return sendJson(res, 201, report);
      }

      // 8. Lint Code or Raw Prompt
      if (req.method === "POST" && pathname === "/api/v1/lint") {
        const body = await readJsonBody(req);
        if (!body.code || typeof body.code !== "string") {
          return sendJson(res, 400, { error: "Field `code` (string) is required" });
        }
        const result = scanCodeString(
          body.code,
          body.filename || "playground.ts",
          body.language,
          body.monthlyVolume ? Number(body.monthlyVolume) : 100_000
        );
        telemetryStore.recordScan(result.diagnostics);
        return sendJson(res, 200, result);
      }

      // 9. Optimize Prompt & Rewrite SDK Code for Mozilla Otari
      if (req.method === "POST" && pathname === "/api/v1/optimize") {
        const body = await readJsonBody(req);
        if (!body.code || typeof body.code !== "string") {
          return sendJson(res, 400, { error: "Field `code` (string) is required" });
        }
        const optimized = await optimizePromptAndCode({
          code: body.code,
          filename: body.filename || "playground.ts",
          language: body.language,
          targetModel: body.targetModel,
          monthlyVolume: body.monthlyVolume ? Number(body.monthlyVolume) : 100_000,
          user: resolveUser(req, body)
        });
        telemetryStore.recordOptimization(optimized.tokenReductionPercentage);
        return sendJson(res, 200, optimized);
      }

      // 10. Side-by-Side Live Benchmark via Mozilla Otari Gateway
      if (req.method === "POST" && pathname === "/api/v1/benchmark") {
        const body = await readJsonBody(req);
        if (!body.originalPrompt || !body.optimizedPrompt) {
          return sendJson(res, 400, {
            error: "Fields `originalPrompt` and `optimizedPrompt` are required"
          });
        }
        const benchmark = await benchmarkPromptsViaOtari({
          originalPrompt: body.originalPrompt,
          optimizedPrompt: body.optimizedPrompt,
          testInput:
            body.testInput ||
            "Please help me resolve duplicate invoice #INV-4092 on my enterprise account.",
          // Omitted models fall back to the core defaults (Otari-catalog Mistral pair)
          originalModel: body.originalModel || undefined,
          optimizedModel: body.optimizedModel || undefined,
          monthlyVolume: body.monthlyVolume ? Number(body.monthlyVolume) : 100_000,
          user: resolveUser(req, body),
          guardrailMode: guardrailModeOf(body.guardrailMode)
        });
        for (const run of [benchmark.original, benchmark.optimized]) {
          if (!run.simulated && !run.idempotentReplayed) {
            telemetryStore.recordGatewayUsage(run.inputTokens, run.cachedTokens);
          }
        }
        return sendJson(res, 200, benchmark);
      }

      // 11. Injection Arena: attack corpus
      if (req.method === "GET" && pathname === "/api/v1/injection-arena/attacks") {
        return sendJson(res, 200, listInjectionAttacks());
      }

      // 12. Injection Arena: red-team the original vs the hardened prompt via Otari
      if (req.method === "POST" && pathname === "/api/v1/injection-arena") {
        const body = await readJsonBody(req);
        let originalPrompt: string | undefined =
          typeof body.originalPrompt === "string" && body.originalPrompt.trim() ? body.originalPrompt : undefined;
        let hardenedPrompt: string | undefined =
          typeof body.hardenedPrompt === "string" && body.hardenedPrompt.trim() ? body.hardenedPrompt : undefined;
        if (!originalPrompt && body.presetId) {
          const preset = DEMO_PRESETS.find((p) => p.id === body.presetId);
          if (!preset) {
            return sendJson(res, 404, { error: `Preset '${body.presetId}' not found` });
          }
          const extracted = scanCodeString(preset.code, preset.filename, preset.language).prompts[0];
          if (!extracted) {
            return sendJson(res, 422, { error: `No LLM prompt found in preset '${body.presetId}'` });
          }
          // The hardened side is built by the core from the same template (hardenedSource "rules")
          originalPrompt = extracted.userPromptTemplate;
        }
        if (!originalPrompt) {
          return sendJson(res, 400, { error: "Field `originalPrompt` (string) or a known `presetId` is required" });
        }
        let arena;
        try {
          arena = await runInjectionArena({
            originalPrompt,
            hardenedPrompt,
            model: body.model || undefined,
            attacks: Array.isArray(body.attacks) ? body.attacks : undefined,
            targetVariable: body.targetVariable || undefined,
            variableValues:
              body.variableValues && typeof body.variableValues === "object" ? body.variableValues : undefined,
            concurrency: body.concurrency ? Number(body.concurrency) : undefined,
            escapeInput: body.escapeInput === false ? false : undefined,
            delivery: body.delivery === "single-message" ? "single-message" : undefined,
            guardrailMode: guardrailModeOf(body.guardrailMode),
            user: resolveUser(req, body)
          });
        } catch (err: any) {
          // Bad attack id, unknown target variable and the like are caller errors
          return sendJson(res, 400, { error: err?.message || "Invalid injection arena request" });
        }
        return sendJson(res, 200, arena);
      }

      return sendJson(res, 404, { error: `Route ${req.method} ${pathname} not found` });
    } catch (err: any) {
      return sendJson(res, 500, {
        error: err?.message || "Internal server error"
      });
    }
  });
}
