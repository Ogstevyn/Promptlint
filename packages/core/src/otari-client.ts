import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getModelPricing,
  type OtariBlock,
  type OtariEndUserBudgetStatus,
  type OtariGuardrailMode,
  type OtariGuardrailResult,
  type OtariRoutingInfo
} from "@promptlint/shared";
import { estimateTokens } from "./tokenizer";

function loadDotEnvIfNeeded() {
  if (process.env.OTARI_API_KEY) return;
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env")
  ];
  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}

export interface OtariChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<{
        type: "text";
        text: string;
        cache_control?: { type: "ephemeral" };
      }>;
}

export interface OtariChatRequest {
  model: string;
  messages: OtariChatMessage[];
  temperature?: number;
  max_tokens?: number;
  idempotencyKey?: string;
  /** Forwarded to the gateway; "none" turns off hidden reasoning on thinking models such as Qwen 3.5 */
  reasoning_effort?: "none" | "low" | "medium" | "high";
  /**
   * End user to bill and hold to their own Otari budget. Sent as `user` only when
   * OTARI_END_USERS=1 (the key must be an Otari service key, or the gateway refuses it).
   */
  user?: string;
  /** Otari guardrails to run on the input before the provider is called */
  guardrails?: OtariGuardrailRequest[];
}

/** An entry of Otari's top-level `guardrails` request field */
export interface OtariGuardrailRequest {
  profile: string;
  mode?: "monitor" | "block";
  /** "monitor" serves the request when the guardrail cannot run instead of refusing it with 502 */
  on_unavailable?: "monitor" | "block";
}

export interface OtariChatResponse {
  content: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  latencyMs: number;
  routedViaOtari: boolean;
  otariEndpoint: string;
  otariRequestId: string;
  otariAttemptId: string;
  idempotentReplayed: boolean;
  idempotencyKey: string;
  /** true when no live Otari call was made (no API key, or the gateway call failed) */
  simulated: boolean;
  /** Why the live call failed and the simulator was used instead, e.g. "400 invalid_model: ..." */
  gatewayError?: string;
  /** Actual cost the gateway reported for this call (usage.cost_usd), when available */
  gatewayCostUsd?: number;
  /** Which provider and model Otari used, and whether a routing policy fell back */
  routing?: OtariRoutingInfo;
  /** Otari-Guardrails verdicts on the input */
  guardrails?: OtariGuardrailResult[];
  /** Set when Otari refused the request on purpose (guardrail block or budget); content is empty */
  blocked?: OtariBlock;
  /** Otari-End-User-Budget: the per-user budget the end user is on */
  endUserBudget?: string;
}

/** Guardrail profile PromptLint asks Otari to run (OTARI_GUARDRAIL_PROFILE, default "prompt-injection") */
export function otariGuardrailProfile(): string {
  return (process.env.OTARI_GUARDRAIL_PROFILE || "prompt-injection").trim();
}

/** OTARI_GUARDRAIL_MODE: "off", "monitor" (default) or "block" */
/**
 * Reasoning effort for the models under test (benchmark and Arena), from
 * OTARI_TARGET_REASONING_EFFORT; "none" by default. A thinking model such as Qwen 3.5
 * otherwise spends its whole max_tokens reasoning and answers late or not at all.
 * Both sides of a comparison get the same setting. "off" omits the field.
 */
export function otariTargetReasoningEffort(): "none" | "low" | "medium" | "high" | undefined {
  const raw = (process.env.OTARI_TARGET_REASONING_EFFORT ?? "none").trim().toLowerCase();
  if (raw === "" || raw === "off" || raw === "omit") return undefined;
  return raw === "low" || raw === "medium" || raw === "high" ? raw : "none";
}

export function otariGuardrailModeFromEnv(): OtariGuardrailMode {
  const mode = (process.env.OTARI_GUARDRAIL_MODE || "monitor").trim().toLowerCase();
  return mode === "off" || mode === "block" ? mode : "monitor";
}

/** The `guardrails` field for a mode, or undefined for "off" */
export function buildOtariGuardrails(mode: OtariGuardrailMode = otariGuardrailModeFromEnv()): OtariGuardrailRequest[] | undefined {
  if (mode === "off") return undefined;
  // on_unavailable "monitor": an org with no guardrail configured still gets answers,
  // and the Otari-Guardrails header says the check was unavailable
  return [{ profile: otariGuardrailProfile(), mode, on_unavailable: "monitor" }];
}

/** OTARI_END_USERS=1: the key is an Otari service key, so requests may name an end user */
export function otariEndUserBudgetsEnabled(): boolean {
  return process.env.OTARI_END_USERS === "1";
}

/** Read the Otari-Guardrails header: a JSON array, or several arrays joined by ", " */
export function parseGuardrailsHeader(value: string | null): OtariGuardrailResult[] | undefined {
  if (!value) return undefined;
  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  let parsed = tryParse(value);
  if (parsed === undefined) parsed = tryParse(`[${value}]`);
  if (!Array.isArray(parsed)) return undefined;
  const flat = parsed.flat() as Array<Record<string, unknown>>;
  const results = flat
    .filter((r) => r && typeof r === "object" && typeof r.profile === "string")
    .map((r) => ({
      profile: String(r.profile),
      mode: r.mode === "block" ? ("block" as const) : ("monitor" as const),
      valid: typeof r.valid === "boolean" ? r.valid : null,
      score: typeof r.score === "number" ? r.score : null,
      status:
        r.status === "evaluated" || r.status === "inconclusive" ? (r.status as "evaluated" | "inconclusive") : ("unavailable" as const),
      ...(typeof r.reason === "string" ? { reason: r.reason } : {})
    }));
  return results.length > 0 ? results : undefined;
}

/** Otari-Provider, Otari-Model, Otari-Attempt-Count and Otari-Fallback */
export function parseRoutingHeaders(headers: { get(name: string): string | null }): OtariRoutingInfo | undefined {
  const provider = headers.get("Otari-Provider") || undefined;
  const servedModel = headers.get("Otari-Model") || undefined;
  const attempts = Number(headers.get("Otari-Attempt-Count"));
  const fallbackHeader = headers.get("Otari-Fallback");
  const info: OtariRoutingInfo = {
    ...(provider ? { provider } : {}),
    ...(servedModel ? { servedModel } : {}),
    ...(Number.isFinite(attempts) && attempts > 0 ? { attemptCount: attempts } : {}),
    ...(fallbackHeader ? { fallback: fallbackHeader.toLowerCase() === "true" } : {})
  };
  return Object.keys(info).length > 0 ? info : undefined;
}

const GUARDRAIL_CODES = new Set(["guardrail_violation"]);
const BUDGET_CODES = new Set(["budget_exceeded", "user_blocked", "end_user_budget_not_allowed"]);

interface CachedOtariEntry {
  response: OtariChatResponse;
  timestamp: number;
}

const idempotencyMemoryCache = new Map<string, CachedOtariEntry>();

export function computeIdempotencyKey(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(typeof payload === "string" ? payload : JSON.stringify(payload))
    .digest("hex");
}

export class OtariGatewayClient {
  private baseUrl: string;
  private apiKey: string | undefined;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    loadDotEnvIfNeeded();
    this.baseUrl = (
      options?.baseUrl ||
      process.env.OTARI_BASE_URL ||
      "https://eu.api.otari.ai/api/v1"
    ).replace(/\/+$/, "");
    // PROMPTLINT_OFFLINE=1 forces the offline simulator (used by the test suites)
    const offline = process.env.PROMPTLINT_OFFLINE === "1" && options?.apiKey === undefined;
    const rawKey = offline ? undefined : options?.apiKey ?? process.env.OTARI_API_KEY;
    this.apiKey =
      rawKey &&
      rawKey !== "otari_your_api_key_here" &&
      rawKey !== "otk_v1_eu_your_api_key_here" &&
      rawKey.trim().length > 0
        ? rawKey.trim()
        : undefined;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async chatCompletion(req: OtariChatRequest): Promise<OtariChatResponse> {
    const body = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
      max_tokens: req.max_tokens ?? 512,
      ...(req.reasoning_effort ? { reasoning_effort: req.reasoning_effort } : {}),
      ...(req.user && otariEndUserBudgetsEnabled() ? { user: req.user } : {}),
      ...(req.guardrails && req.guardrails.length > 0 ? { guardrails: req.guardrails } : {})
    };
    // Otari refuses a reused key with a different body (422), so the default key
    // covers everything sent: another end user or guardrail mode is a new request
    const idempotencyKey = req.idempotencyKey || computeIdempotencyKey(body);

    // Offline only: emulate Otari's idempotent replay locally. With a live key the
    // request always goes to the gateway, which replays it itself and reports
    // Otari-Idempotent-Replayed with a real latency.
    if (!this.apiKey) {
      const cached = idempotencyMemoryCache.get(idempotencyKey);
      if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return {
          ...cached.response,
          latencyMs: 12, // simulated replay latency
          idempotentReplayed: true
        };
      }
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    const startTime = Date.now();
    let gatewayError: string | undefined;

    if (this.apiKey) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Otari-Key": this.apiKey,
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify(body)
        });
        const routing = parseRoutingHeaders(res.headers);
        const guardrails = parseGuardrailsHeader(res.headers.get("Otari-Guardrails"));
        const endUserBudget = res.headers.get("Otari-End-User-Budget") || undefined;

        if (res.ok) {
          const data = (await res.json()) as any;
          const latencyMs = Date.now() - startTime;
          const otariRequestId =
            res.headers.get("Otari-Request-ID") ||
            data.id ||
            `otari_req_${crypto.randomBytes(6).toString("hex")}`;
          const otariAttemptId =
            res.headers.get("Otari-Attempt-ID") ||
            `otari_att_${crypto.randomBytes(4).toString("hex")}`;
          const idempotentReplayed =
            res.headers.get("Otari-Idempotent-Replayed") === "true";

          const content =
            data.choices?.[0]?.message?.content ||
            data.content?.[0]?.text ||
            "";
          const inputTokens =
            data.usage?.prompt_tokens ||
            estimateTokens(JSON.stringify(req.messages));
          // Only report cached tokens the gateway actually returned (OpenAI- or Anthropic-style usage)
          const cachedTokens =
            data.usage?.prompt_tokens_details?.cached_tokens ??
            data.usage?.cache_read_input_tokens ??
            0;
          const outputTokens =
            data.usage?.completion_tokens || estimateTokens(content);

          const result: OtariChatResponse = {
            content,
            model: req.model,
            inputTokens,
            cachedTokens,
            outputTokens,
            latencyMs,
            routedViaOtari: true,
            otariEndpoint: endpoint,
            otariRequestId,
            otariAttemptId,
            idempotentReplayed,
            idempotencyKey,
            simulated: false,
            ...(routing ? { routing } : {}),
            ...(guardrails ? { guardrails } : {}),
            ...(endUserBudget ? { endUserBudget } : {})
          };
          const costUsd = Number(data.usage?.cost_usd ?? data.usage?.estimated_cost);
          if (Number.isFinite(costUsd)) result.gatewayCostUsd = costUsd;
          return result;
        }

        const errorBody = (await res.json().catch(() => ({}))) as any;
        // Otari nests the error: {"detail": {"message", "code", "guardrails": [...]}}.
        // Older/plain errors carry "detail" as a string with "code" alongside.
        const err = errorBody?.detail && typeof errorBody.detail === "object" ? errorBody.detail : errorBody ?? {};
        const errorCode = String(res.headers.get("Otari-Error-Code") || err?.code || errorBody?.code || "");
        const errorMessage = String(
          (typeof errorBody?.detail === "string" ? errorBody.detail : err?.message) ??
            errorBody?.error?.message ??
            res.statusText
        );
        if (GUARDRAIL_CODES.has(errorCode) || BUDGET_CODES.has(errorCode)) {
          // The block body names the guardrails that fired; use it when the header is absent
          const blockedBy: OtariGuardrailResult[] | undefined = Array.isArray(err?.guardrails)
            ? err.guardrails.map((g: any) => ({
                profile: String(g?.profile ?? otariGuardrailProfile()),
                mode: "block" as const,
                valid: false,
                score: typeof g?.score === "number" ? g.score : null,
                status: "evaluated" as const,
                ...(g?.explanation ? { reason: String(g.explanation) } : {})
              }))
            : undefined;
          const guardrailResults = guardrails ?? (blockedBy && blockedBy.length > 0 ? blockedBy : undefined);
          // A refusal Otari made on purpose is a real, live result, not a reason to simulate
          const retryAfter = Number(res.headers.get("Retry-After"));
          const budgetScope = res.headers.get("Otari-Budget-Scope") || undefined;
          return {
            content: "",
            model: req.model,
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - startTime,
            routedViaOtari: true,
            otariEndpoint: endpoint,
            otariRequestId: res.headers.get("Otari-Request-ID") || `otari_req_${idempotencyKey.slice(0, 12)}`,
            otariAttemptId: res.headers.get("Otari-Attempt-ID") || `otari_att_${idempotencyKey.slice(12, 20)}`,
            idempotentReplayed: false,
            idempotencyKey,
            simulated: false,
            gatewayCostUsd: 0,
            ...(routing ? { routing } : {}),
            ...(guardrailResults ? { guardrails: guardrailResults } : {}),
            ...(endUserBudget ? { endUserBudget } : {}),
            blocked: {
              by: GUARDRAIL_CODES.has(errorCode) ? "guardrail" : "budget",
              code: errorCode,
              detail: errorMessage.slice(0, 300),
              ...(budgetScope ? { budgetScope } : {}),
              ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSec: retryAfter } : {}),
              ...(typeof (err?.end_user ?? errorBody?.end_user) === "string"
                ? { endUser: String(err?.end_user ?? errorBody?.end_user) }
                : {})
            }
          };
        }
        gatewayError = `${res.status}${errorCode ? ` ${errorCode}` : ""}: ${errorMessage.slice(0, 200)}`;
      } catch (err) {
        gatewayError = `gateway unreachable: ${(err as Error).message}`;
      }
      // Fall through to the deterministic simulation, reporting why
    }

    // Deterministic Fallback Simulation when OTARI_API_KEY is not yet provided
    const pricing = getModelPricing(req.model);
    const serializedPrompt = req.messages
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content.map((c) => c.text).join("\n")
      )
      .join("\n");

    const inputTokens = estimateTokens(serializedPrompt);
    const hasCacheControl = JSON.stringify(req.messages).includes("cache_control");
    const cachedTokens = hasCacheControl ? Math.round(inputTokens * 0.65) : 0;

    const simulatedContent = this.generateDeterministicCompletion(serializedPrompt);
    const outputTokens = estimateTokens(simulatedContent);
    const simulatedLatency = Math.max(
      95,
      Math.round(pricing.avgLatencyMs * (hasCacheControl ? 0.62 : 0.95))
    );

    const fallbackResponse: OtariChatResponse = {
      content: simulatedContent,
      model: req.model,
      inputTokens,
      cachedTokens,
      outputTokens,
      latencyMs: simulatedLatency,
      // Nothing was sent to the gateway: report that honestly
      routedViaOtari: false,
      otariEndpoint: endpoint,
      otariRequestId: `otari_req_${idempotencyKey.slice(0, 12)}`,
      otariAttemptId: `otari_att_${idempotencyKey.slice(12, 20)}`,
      idempotentReplayed: false,
      idempotencyKey,
      simulated: true,
      ...(gatewayError ? { gatewayError } : {})
    };

    idempotencyMemoryCache.set(idempotencyKey, {
      response: fallbackResponse,
      timestamp: Date.now()
    });

    return fallbackResponse;
  }

  /**
   * The end user's per-user budget on this service key (GET /end-users), with the
   * budget's limit from GET /end-user-budgets. Never throws.
   */
  public async getEndUserBudgetStatus(user: string): Promise<OtariEndUserBudgetStatus> {
    if (!this.apiKey || !otariEndUserBudgetsEnabled()) return { enabled: false, user };
    const headers = { "Otari-Key": this.apiKey, Authorization: `Bearer ${this.apiKey}` };
    try {
      const res = await fetch(`${this.baseUrl}/end-users?external_id=${encodeURIComponent(user)}`, { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as any;
        return { enabled: true, user, error: `${res.status}: ${String(
          (typeof body?.detail === "string" ? body.detail : body?.detail?.message) ?? res.statusText
        ).slice(0, 200)}` };
      }
      const list = (await res.json()) as any;
      const record = Array.isArray(list) ? list[0] : Array.isArray(list?.items) ? list.items[0] : list;
      if (!record) return { enabled: true, user, found: false };

      const budgetId: string | undefined = record.budget_id ?? record.budget?.id ?? undefined;
      let budget: any = record.budget ?? undefined;
      if (budgetId && !budget?.max_budget) {
        const budgetsRes = await fetch(`${this.baseUrl}/end-user-budgets`, { headers }).catch(() => undefined);
        if (budgetsRes?.ok) {
          const budgets = (await budgetsRes.json().catch(() => [])) as any;
          const items: any[] = Array.isArray(budgets) ? budgets : budgets?.items ?? [];
          budget = items.find((b) => b?.id === budgetId || b?.budget_id === budgetId) ?? budget;
        }
      }
      const num = (...values: unknown[]): number | undefined => {
        for (const v of values) {
          const n = typeof v === "string" ? Number(v) : v;
          if (typeof n === "number" && Number.isFinite(n)) return n;
        }
        return undefined;
      };
      const spendUsd = num(record.spend, record.current_spend, record.period_spend, record.total_spend) ?? 0;
      const maxBudgetUsd = num(budget?.max_budget, record.max_budget) ?? null;
      return {
        enabled: true,
        user,
        found: true,
        ...(budgetId ? { budgetId } : {}),
        ...(budget?.name ? { budgetName: String(budget.name) } : {}),
        maxBudgetUsd,
        spendUsd,
        remainingUsd: maxBudgetUsd === null ? null : Math.max(0, maxBudgetUsd - spendUsd),
        ...(budget?.budget_duration || budget?.period ? { period: String(budget.budget_duration ?? budget.period) } : {}),
        ...(record.next_budget_reset_at ? { resetsAt: String(record.next_budget_reset_at) } : {}),
        ...(typeof record.current_requests === "number" ? { requests: record.current_requests } : {}),
        blocked: Boolean(record.blocked)
      };
    } catch (err) {
      return { enabled: true, user, error: `gateway unreachable: ${(err as Error).message}` };
    }
  }

  private generateDeterministicCompletion(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes("sentiment") || lower.includes("classify")) {
      return JSON.stringify({
        category: "billing_inquiry",
        sentiment: "neutral",
        priority: "medium",
        confidence: 0.96
      });
    }
    if (lower.includes("summarize") || lower.includes("summary")) {
      return "Customer requested a refund for duplicate invoice #INV-4092 and asked to update billing email.";
    }
    return JSON.stringify({
      status: "processed_via_otari",
      summary: "Executed deterministically with XML boundary protection and ephemeral prefix caching."
    });
  }
}
