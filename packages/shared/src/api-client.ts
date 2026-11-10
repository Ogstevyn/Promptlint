import {
  BenchmarkRequest,
  BenchmarkResponse,
  CreatePRReportRequest,
  DashboardStats,
  DemoPreset,
  FileScanResult,
  LintRuleMetadata,
  ModelPricing,
  OptimizeRequest,
  OptimizeResponse,
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

  constructor(baseUrl = "http://localhost:4000") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {})
      },
      ...init
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`PromptLint API error (${response.status}): ${errorBody || response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async health(): Promise<{ status: string; otariConfigured: boolean; otariBaseUrl: string; version: string }> {
    return this.request("/api/v1/health");
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
