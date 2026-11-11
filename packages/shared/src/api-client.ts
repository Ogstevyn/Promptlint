import {
  BenchmarkRequest,
  BenchmarkResponse,
  CreatePRReportRequest,
  DashboardStats,
  DemoPreset,
  FileScanResult,
  InjectionArenaRequest,
  InjectionArenaResponse,
  InjectionAttackInfo,
  LintRuleMetadata,
  ModelPricing,
  OptimizeRequest,
  OptimizeResponse,
  OtariEndUserBudgetStatus,
  OtariFeatureConfig,
  PRCostReport,
  SourceLanguage
} from "./types";

export interface LintCodeRequest {
  code: string;
  filename?: string;
  language?: SourceLanguage;
  monthlyVolume?: number;
}

export class PromptLintApiClient {
  private baseUrl: string;
  private extraHeaders?: () => Record<string, string>;

  /** extraHeaders runs per request, e.g. to send the demo user as X-PromptLint-User */
  constructor(baseUrl = "http://localhost:4000", options?: { extraHeaders?: () => Record<string, string> }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.extraHeaders = options?.extraHeaders;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.extraHeaders?.() ?? {}),
        ...((init?.headers as Record<string, string> | undefined) || {})
      }
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`PromptLint API error (${response.status}): ${errorBody || response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async health(): Promise<{
    status: string;
    otariConfigured: boolean;
    otariBaseUrl: string;
    version: string;
    otariFeatures?: OtariFeatureConfig;
  }> {
    return this.request("/api/v1/health");
  }

  /** The end user's Otari per-user budget (needs a service key and OTARI_END_USERS=1 on the server) */
  async getOtariBudget(user: string): Promise<OtariEndUserBudgetStatus> {
    return this.request<OtariEndUserBudgetStatus>(`/api/v1/otari/budget?user=${encodeURIComponent(user)}`);
  }

  async getPresets(): Promise<DemoPreset[]> {
    return this.request<DemoPreset[]>("/api/v1/presets");
  }

  async lintCode(payload: LintCodeRequest): Promise<FileScanResult> {
    return this.request<FileScanResult>("/api/v1/lint", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async optimizeCode(payload: OptimizeRequest): Promise<OptimizeResponse> {
    return this.request<OptimizeResponse>("/api/v1/optimize", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async runBenchmark(payload: BenchmarkRequest): Promise<BenchmarkResponse> {
    return this.request<BenchmarkResponse>("/api/v1/benchmark", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async runInjectionArena(payload: InjectionArenaRequest): Promise<InjectionArenaResponse> {
    return this.request<InjectionArenaResponse>("/api/v1/injection-arena", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getInjectionAttacks(): Promise<InjectionAttackInfo[]> {
    return this.request<InjectionAttackInfo[]>("/api/v1/injection-arena/attacks");
  }

  async getDashboardStats(): Promise<DashboardStats> {
    return this.request<DashboardStats>("/api/v1/stats");
  }

  async getPRReports(): Promise<PRCostReport[]> {
    return this.request<PRCostReport[]>("/api/v1/reports");
  }

  async getPRReportById(id: string): Promise<PRCostReport> {
    return this.request<PRCostReport>(`/api/v1/reports/${encodeURIComponent(id)}`);
  }

  async createPRReport(payload: CreatePRReportRequest = {}): Promise<PRCostReport> {
    return this.request<PRCostReport>("/api/v1/reports", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getModelsAndRules(): Promise<{ models: ModelPricing[]; rules: LintRuleMetadata[] }> {
    return this.request<{ models: ModelPricing[]; rules: LintRuleMetadata[] }>("/api/v1/models");
  }
}
