import { PromptLintApiClient } from "@promptlint/shared";

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const api = new PromptLintApiClient(API_BASE_URL);

/** Turn the client's "PromptLint API error (500): {...}" into a readable message. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message === "Failed to fetch" || err.name === "TypeError") {
    return `Can't reach the PromptLint API at ${API_BASE_URL}. Is \`npm run dev:server\` running?`;
  }
  const match = err.message.match(/^PromptLint API error \((\d+)\): (.*)$/s);
  if (match) {
    try {
      const body = JSON.parse(match[2]);
      if (body?.error) return `${body.error} (HTTP ${match[1]})`;
    } catch {
      /* body was not JSON */
    }
  }
  return err.message;
}
