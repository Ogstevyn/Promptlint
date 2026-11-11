export type RuleId =
  | "PL001" // Security: Unsanitized prompt injection interpolation
  | "PL002" // Security: Missing system instruction boundary guard
  | "PL003" // Caching: Dynamic variable before static prefix breaks Otari/provider cache_control
  | "PL004" // Cost: Verbose/redundant prompt filler inflating token count
  | "PL005" // Cost: Frontier model used for simple classification/extraction task
  | "PL006" // Latency/Cost: Missing max_tokens / max_completion_tokens cap
  | "PL007" // Otari Routing: Direct vendor SDK endpoint instead of Mozilla Otari Gateway
  | "PL008"; // Otari Caching: Missing Idempotency-Key header on deterministic LLM call

export type RuleSeverity = "error" | "warning" | "info";

export type RuleCategory =
  | "security"
  | "caching"
  | "cost"
  | "latency"
  | "otari-routing";

export type SourceLanguage = "typescript" | "javascript" | "python" | "raw-prompt";

export interface LintRuleMetadata {
  id: RuleId;
  name: string;
  category: RuleCategory;
  defaultSeverity: RuleSeverity;
  description: string;
  remediation: string;
}

export interface LintDiagnostic {
  ruleId: RuleId;
  ruleName: string;
  category: RuleCategory;
  severity: RuleSeverity;
  message: string;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  snippet: string;
  suggestedFix?: string;
  estimatedTokenSavings?: number;
  estimatedMonthlySavingsUsd?: number;
}

export interface ExtractedPrompt {
  id: string;
  filePath: string;
  language: SourceLanguage;
  line: number;
  endLine: number;
  provider: "openai" | "anthropic" | "otari" | "generic";
  detectedModel: string;
  recommendedModel: string;
  rawCode: string;
  systemPrompt?: string;
  userPromptTemplate: string;
  interpolatedVariables: string[];
  hasUnsanitizedInterpolation: boolean;
  dynamicPrefixBeforeStatic: boolean;
  usesOtariGateway: boolean;
  hasIdempotencyKey: boolean;
  hasCacheControl: boolean;
  hasMaxTokens: boolean;
  temperature?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface ModelPricing {
  model: string;
  provider: string;
  tier: "frontier" | "balanced" | "fast";
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
  avgLatencyMs: number;
  supportsPromptCaching: boolean;
  recommendedFallback?: string;
}

export interface CostBreakdown {
  monthlyCallVolume: number;
  currentModel: string;
  recommendedModel: string;
  currentInputTokensPerCall: number;
  optimizedInputTokensPerCall: number;
  estimatedOutputTokensPerCall: number;
  currentCostPerCallUsd: number;
  optimizedCostPerCallUsd: number;
  currentMonthlyCostUsd: number;
  optimizedMonthlyCostUsd: number;
  monthlySavingsUsd: number;
  annualSavingsUsd: number;
  savingsPercentage: number;
  breakdownBySource: {
    promptCompressionUsd: number;
    otariPrefixCachingUsd: number;
    otariIdempotencyReplayUsd: number;
    smartModelRoutingUsd: number;
  };
}

export interface FileScanResult {
  filePath: string;
  language: SourceLanguage;
  prompts: ExtractedPrompt[];
  diagnostics: LintDiagnostic[];
  costBreakdown: CostBreakdown;
  score: number; // 0-100 health score
}

export interface RepoScanSummary {
  scanId: string;
  timestamp: string;
  repository: string;
  branch?: string;
  commitSha?: string;
  totalFilesScanned: number;
  filesWithPrompts: number;
  totalPromptsFound: number;
  totalDiagnostics: number;
  diagnosticsByCategory: Record<RuleCategory, number>;
  diagnosticsBySeverity: Record<RuleSeverity, number>;
  overallHealthScore: number;
  aggregateCost: CostBreakdown;
  files: FileScanResult[];
}

export interface OptimizeRequest {
  code: string;
  filename?: string;
  language?: SourceLanguage;
  targetModel?: string;
  monthlyVolume?: number;
  useOtariLLM?: boolean;
  /** End user to bill and budget (sent as Otari's `user` when per-user budgets are on) */
  user?: string;
}

export interface OptimizeResponse {
  originalCode: string;
  optimizedCode: string;
  originalPrompt: string;
  optimizedPrompt: string;
  originalTokens: number;
  optimizedTokens: number;
  tokenReductionPercentage: number;
  diagnosticsFixed: RuleId[];
  costBreakdown: CostBreakdown;
  otariTelemetry: {
    routedViaOtari: boolean;
    otariEndpoint: string;
    otariRequestId: string;
    otariAttemptId: string;
    idempotentReplayed: boolean;
    idempotencyKey: string;
    cacheControlApplied: boolean;
    latencyMs: number;
    /** true when no live Otari call was made and the numbers come from the offline simulator */
    simulated: boolean;
    /** Why the live call failed, when it fell back to the simulator */
    gatewayError?: string;
    /** Which provider and model served the optimizer call, and whether its routing policy fell back */
    routing?: OtariRoutingInfo;
    /** Set when Otari refused the optimizer call (budget or guardrail) */
    blocked?: OtariBlock;
  };
  /** "llm" when the Otari optimizer model's rewrite passed validation, "rules" for the deterministic fallback */
  optimizerSource: "llm" | "rules";
  explanation: string[];
}

export interface BenchmarkRequest {
  originalPrompt: string;
  optimizedPrompt: string;
  testInput: string;
  originalModel?: string;
  optimizedModel?: string;
  monthlyVolume?: number;
  /** End user to bill and budget (sent as Otari's `user` when per-user budgets are on) */
  user?: string;
  /** Otari guardrail on both calls; defaults to OTARI_GUARDRAIL_MODE */
  guardrailMode?: OtariGuardrailMode;
}

export interface BenchmarkExecutionMetrics {
  model: string;
  promptUsed: string;
  outputText: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  latencyMs: number;
  costPer1kCallsUsd: number;
  monthlyProjectedCostUsd: number;
  otariRequestId: string;
  idempotentReplayed: boolean;
  /** true when this run came from the offline simulator rather than a live Otari call */
  simulated: boolean;
  /** Why the live call failed, when it fell back to the simulator */
  gatewayError?: string;
  /** Actual per-call cost reported by the gateway, when available */
  gatewayCostUsd?: number;
  /** "gateway" when cost figures use the gateway-reported cost, "catalog" when estimated from the price table */
  costSource: "gateway" | "catalog";
  /** Which provider and model Otari actually used, and whether a routing policy fell back */
  routing?: OtariRoutingInfo;
  /** Otari guardrail verdicts on this call's input */
  guardrails?: OtariGuardrailResult[];
  /** Set when Otari refused the call (guardrail block or budget); no model output then */
  blocked?: OtariBlock;
}

export interface BenchmarkResponse {
  benchmarkId: string;
  timestamp: string;
  testInput: string;
  original: BenchmarkExecutionMetrics;
  optimized: BenchmarkExecutionMetrics;
  comparison: {
    latencyReductionMs: number;
    latencyReductionPercentage: number;
    tokenReductionPercentage: number;
    costReductionPercentage: number;
    monthlySavingsUsd: number;
    /** 0-100 agreement between the two outputs; null when either side was simulated */
    semanticEquivalenceScore: number | null;
  };
  /** Agreement re-checked by Python a model wrote and ran in Otari's code-execution sandbox */
  codeCheck?: OtariCodeCheck;
}

export interface PRCostReport {
  id: string;
  prNumber: number;
  prTitle: string;
  repository: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  commitSha: string;
  createdAt: string;
  status: "pass" | "warning" | "blocked";
  healthScore: number;
  promptsAnalyzed: number;
  issuesFound: {
    errors: number;
    warnings: number;
    info: number;
  };
  costSummary: CostBreakdown;
  markdownComment: string;
  diagnostics: LintDiagnostic[];
  /** true for illustrative reports pre-seeded into the demo server */
  demoSeed?: boolean;
}

export interface DashboardStats {
  totalScansRun: number;
  totalPromptsOptimized: number;
  totalMonthlySavingsUsd: number;
  totalAnnualSavingsUsd: number;
  averageTokenReductionPct: number;
  averageOtariCacheHitRatePct: number;
  securityInjectionsBlocked: number;
  ruleDistribution: Array<{
    ruleId: RuleId;
    ruleName: string;
    category: RuleCategory;
    count: number;
  }>;
  recentPRReports: PRCostReport[];
  /** true when headline KPIs include illustrative pre-seeded demo figures */
  demoSeed?: boolean;
}

/** Curated vulnerable code sample served by GET /api/v1/presets */
export interface DemoPreset {
  id: string;
  title: string;
  description: string;
  language: "typescript" | "python" | "raw-prompt";
  filename: string;
  code: string;
  sampleTestInput: string;
}

/** Body for POST /api/v1/reports (scans a path on the server and records a PR report) */
export interface CreatePRReportRequest {
  targetPath?: string;
  prNumber?: number;
  prTitle?: string;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
}

/** Family of prompt-injection technique an Injection Arena attack uses */
export type InjectionTechnique =
  | "instruction-override"
  | "authority-claim"
  | "fake-system-tag"
  | "tag-escape"
  | "delimiter"
  | "role-play"
  | "encoding"
  | "translation"
  | "payload-splitting"
  | "output-hijack"
  | "completion-priming"
  | "indirect";

/** Static description of one attack in the Injection Arena corpus */
export interface InjectionAttackInfo {
  id: string;
  name: string;
  technique: InjectionTechnique;
  description: string;
}

/** Body for POST /api/v1/injection-arena */
export interface InjectionArenaRequest {
  /** Prompt template under test, e.g. "Customer message: ${msg} ..." */
  originalPrompt?: string;
  /** PromptLint-hardened version; built with the rule-based optimizer when omitted */
  hardenedPrompt?: string;
  /** Server only: take the prompt from a demo preset when originalPrompt is omitted */
  presetId?: string;
  /** Model attacked on both sides (defaults to the benchmark's original model) */
  model?: string;
  /** Attack ids to run; the full corpus when omitted */
  attacks?: string[];
  /** Template variable the payload is injected into; the first one found when omitted */
  targetVariable?: string;
  /** Benign values for the other template variables */
  variableValues?: Record<string, string>;
  /** Parallel gateway calls (1-8, default 4) */
  concurrency?: number;
  /** XML-escape the payload on the hardened side, as the generated code does (default true) */
  escapeInput?: boolean;
  /**
   * How the hardened side is sent: "system-split" (default) mirrors the generated code,
   * instructions in the system message and the input in the user message;
   * "single-message" sends the filled prompt as one user message, like the original.
   */
  delivery?: "system-split" | "single-message";
  /** Otari guardrail on every call; "block" lets Otari refuse flagged payloads. Defaults to OTARI_GUARDRAIL_MODE */
  guardrailMode?: OtariGuardrailMode;
  /** End user to bill and budget (sent as Otari's `user` when per-user budgets are on) */
  user?: string;
}

/** One model call in the arena (an attack against one side) */
export interface InjectionArenaAttempt {
  /** Full prompt sent as the user message */
  promptSent: string;
  /** System message sent before it, when the hardened side used system-split delivery */
  systemSent?: string;
  output: string;
  /** The canary appeared in the output: the injection took control */
  succeeded: boolean;
  /** "exact" canary, "near" (at most two character slips joining it) or "none" */
  canaryMatch: "exact" | "near" | "none";
  /** true when this result came from the offline simulator, not a live Otari call */
  simulated: boolean;
  /** Why the live call failed, when it fell back to the simulator */
  gatewayError?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  otariRequestId: string;
  idempotentReplayed: boolean;
  gatewayCostUsd?: number;
  routing?: OtariRoutingInfo;
  /** Otari guardrail verdicts on this payload */
  guardrails?: OtariGuardrailResult[];
  /** Set when Otari refused the call; a guardrail block means the model never saw the attack */
  blocked?: OtariBlock;
}

export interface InjectionArenaAttackResult extends InjectionAttackInfo {
  /** The payload as injected (with this run's canary) */
  payload: string;
  original: InjectionArenaAttempt;
  hardened: InjectionArenaAttempt;
}

export interface InjectionArenaSideSummary {
  /** Attacks run against this side */
  attempted: number;
  /** Attempts answered by a live gateway call (the denominator when the run is live or mixed) */
  liveAttempts: number;
  /** Attempts that fell back to the simulator because the gateway call failed */
  failedCalls: number;
  /** Attacks whose canary appeared in the output (counted over live attempts unless fully simulated) */
  succeeded: number;
  /** succeeded / denominator, 0-100 */
  successRatePct: number;
  /** Payloads the Otari guardrail evaluated (status "evaluated") */
  guardrailEvaluated: number;
  /** Payloads the Otari guardrail flagged (valid false), whether or not it blocked them */
  guardrailFlagged: number;
  /** Calls Otari refused with guardrail_violation (block mode); the model never saw them */
  guardrailBlocked: number;
  /** Calls refused by an Otari budget */
  budgetBlocked: number;
}

export interface InjectionArenaResponse {
  runId: string;
  timestamp: string;
  model: string;
  /** Per-run marker each attack asks the model to print, e.g. PWNED-1a2b3c4d */
  canary: string;
  /** "live": every call went through Otari; "simulated": none did; "mixed": some calls failed */
  mode: "live" | "simulated" | "mixed";
  /** true unless every call was live; simulated results are not evidence */
  simulated: boolean;
  /** Distinct gateway errors seen during the run */
  gatewayErrors: string[];
  originalPrompt: string;
  hardenedPrompt: string;
  /** "provided" when the caller passed the hardened prompt, "rules" when built by the rule-based optimizer */
  hardenedSource: "provided" | "rules";
  /** true when the payload was XML-escaped on the hardened side, as PromptLint's generated code does */
  hardenedInputEscaped: boolean;
  /** How the hardened side was sent (the original is always one user message) */
  hardenedDelivery: "system-split" | "single-message";
  /** Template variable the payload was injected into (undefined when the prompt had none and the payload was appended) */
  targetVariable?: string;
  /** Otari guardrail requested on every call, and the profile */
  guardrailMode: OtariGuardrailMode;
  guardrailProfile?: string;
  /** Otari's verdict on whether the guardrail ran: "unavailable" when the org has none configured */
  guardrailStatus?: "evaluated" | "unavailable" | "mixed" | "off";
  summary: {
    original: InjectionArenaSideSummary;
    hardened: InjectionArenaSideSummary;
  };
  /** Sum of gateway-reported cost over all live calls, when the gateway reported it */
  totalGatewayCostUsd?: number;
  durationMs: number;
  results: InjectionArenaAttackResult[];
}

// ---------------------------------------------------------------------------
// Otari gateway features: routing policies, guardrails and budgets
// ---------------------------------------------------------------------------

/** How Otari served a request, from the Otari-Provider / -Model / -Attempt-Count / -Fallback headers */
export interface OtariRoutingInfo {
  /** Provider instance that answered, e.g. "mistral" */
  provider?: string;
  /** Model the provider was sent, e.g. "ministral-8b-latest" (a policy name keeps its own name in the body) */
  servedModel?: string;
  /** Candidates the request was sent to, including the one that served */
  attemptCount?: number;
  /** true when a candidate other than the plan's first served the request */
  fallback?: boolean;
}

/** One entry of the Otari-Guardrails response header */
export interface OtariGuardrailResult {
  profile: string;
  mode: "monitor" | "block";
  /** false: the input was flagged; true: it passed; null: no verdict */
  valid: boolean | null;
  score: number | null;
  status: "evaluated" | "inconclusive" | "unavailable";
  /** Why an unavailable check could not run, e.g. "not_configured" */
  reason?: string;
}

/** A live request Otari refused on purpose: a guardrail in block mode, or a budget */
export interface OtariBlock {
  by: "guardrail" | "budget";
  /** Otari error code, e.g. "guardrail_violation" or "budget_exceeded" */
  code: string;
  detail: string;
  /** Otari-Budget-Scope: "user" or the ceiling's scope */
  budgetScope?: string;
  /** Seconds until the refusing budget resets */
  retryAfterSec?: number;
  /** End user the refusal names, on a service key */
  endUser?: string;
}

/** Guardrail requested on each call: mode "off" sends none */
export type OtariGuardrailMode = "off" | "monitor" | "block";

/** An end user's per-user budget on an Otari service key (GET /api/v1/end-users) */
export interface OtariEndUserBudgetStatus {
  /** false when per-user budgets are not set up (no service key, or OTARI_END_USERS unset) */
  enabled: boolean;
  user?: string;
  /** Present when the end user exists on the gateway */
  found?: boolean;
  budgetId?: string;
  budgetName?: string;
  maxBudgetUsd?: number | null;
  spendUsd?: number;
  remainingUsd?: number | null;
  period?: string;
  blocked?: boolean;
  /** Why the status could not be read */
  error?: string;
  /** Raw gateway record, for fields this client does not map */
  /** When the budget period resets (ISO time) */
  resetsAt?: string;
  /** Requests this end user made in the current period */
  requests?: number;
}

/** What the app does with Otari's features, for the health check and the UI */
/** One tool call Otari ran itself, from the response's top-level `otari_tool_calls` */
export interface OtariToolCall {
  id?: string;
  /** e.g. "code_execution" */
  type: string;
  status?: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/** Output agreement computed by code that ran in Otari's sandbox (otari_code_execution) */
export interface OtariCodeCheck {
  /**
   * verified: the sandbox ran the check and printed a verdict
   * no_execution: the model answered without running code (its answer is not trusted)
   * failed: code ran but produced no verdict
   * unavailable: the call was refused or failed (e.g. code execution not enabled)
   * skipped: nothing to compare (a side was simulated, blocked or empty)
   */
  status: "verified" | "no_execution" | "failed" | "unavailable" | "skipped";
  reason?: string;
  /** Model asked to write and run the check */
  model: string;
  servedModel?: string;
  /** json: both outputs are JSON objects, compared key by key; text: word-set F1 */
  mode?: "json" | "text";
  validA?: boolean;
  validB?: boolean;
  sameKeys?: boolean;
  matchingValues?: number;
  totalKeys?: number;
  agreementPct?: number;
  /** The code the sandbox ran, and what it printed */
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  executions: number;
  costUsd?: number;
  latencyMs: number;
  otariRequestId?: string;
  idempotentReplayed?: boolean;
}

export interface OtariFeatureConfig {
  /** Guardrail profile sent with requests, e.g. "prompt-injection" */
  guardrailProfile: string;
  guardrailMode: OtariGuardrailMode;
  /** Per-user budgets: requests name an end user (the key must be a service key) */
  endUserBudgets: boolean;
  optimizerModel: string;
  benchmarkOriginalModel: string;
  benchmarkOptimizedModel: string;
  arenaModel: string;
  /** Benchmark agreement re-checked in Otari's code-execution sandbox */
  codeExecution: boolean;
  verifierModel: string;
}
