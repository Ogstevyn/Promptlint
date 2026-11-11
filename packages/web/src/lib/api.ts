import { PromptLintApiClient } from "@promptlint/shared";

export const API_BASE_URL: string = import.meta.env.VITE_API_URL || "http://localhost:4000";

/** Demo end user: the server passes it to Otari as `user`, so each one has its own per-user budget */
export const DEMO_USERS = ["alice", "bob", "carol"] as const;
const USER_KEY = "promptlint.demoUser";

export function getDemoUser(): string {
  try {
    return window.localStorage.getItem(USER_KEY) || DEMO_USERS[0];
  } catch {
    return DEMO_USERS[0];
  }
}

let currentUser = getDemoUser();

export function setDemoUser(user: string): void {
  try {
    window.localStorage.setItem(USER_KEY, user);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  currentUser = user;
}

export const api = new PromptLintApiClient(API_BASE_URL, {
  extraHeaders: () => ({ "X-PromptLint-User": currentUser })
});

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
