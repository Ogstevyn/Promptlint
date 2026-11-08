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
  };
  explanation: string[];
}

export interface BenchmarkRequest {
  originalPrompt: string;
  optimizedPrompt: string;
  testInput: string;
  originalModel?: string;
  optimizedModel?: string;
  monthlyVolume?: number;
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
    semanticEquivalenceScore: number; // 0-100
  };
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
}
