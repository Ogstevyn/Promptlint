# PromptLint

**Static & Semantic Linter, Prompt Optimizer, and CI Cost Reporter built on Mozilla's Otari LLM Gateway.**

PromptLint scans TypeScript, JavaScript, and Python repositories for LLM SDK calls, flags **cost, latency, caching, and prompt injection smells (`PL001`–`PL008`)**, automatically rewrites code to route through the **Mozilla Otari LLM Gateway (`/api/v1`)**, and posts a **Per-PR Monthly Cost & Savings Report** in GitHub Actions.

---

## Why PromptLint + Mozilla Otari?

Engineering teams write LLM prompts ad-hoc across application code. Before those prompts reach production, they introduce four costly issues:
1. **Direct Vendor Lock-In (`PL007`):** Hardcoding upstream SDK endpoints instead of routing through Mozilla's **Otari LLM Gateway** (`/api/v1/chat/completions`, `/api/v1/messages`) for unified governance, budgets, and provider failover.
2. **Broken Prompt & Idempotency Caching (`PL003`, `PL008`):** Placing dynamic variables before static system instructions invalidates provider prefix caching (`cache_control: {"type": "ephemeral"}`), and omitting `Idempotency-Key` headers misses Otari's zero-cost idempotent replay cache (`Otari-Idempotent-Replayed: true`).
3. **Overprovisioned Models & Token Bloat (`PL004`, `PL005`, `PL006`):** Invoking frontier models (`gpt-4o`, `claude-3-5-sonnet`) with verbose filler prompts and unbounded `max_tokens` for simple classification or extraction tasks.
4. **Prompt Injection Vulnerabilities (`PL001`, `PL002`):** Interpolating untrusted user input directly into prompt templates without `<user_input>` XML delimiters or instruction hierarchy boundaries.

---

## Built-in Lint Rules (`PL001`–`PL008`)

| Rule ID | Category | Severity | Description | Auto-Fix / Remediation |
| :--- | :--- | :--- | :--- | :--- |
| `PL001` | `security` | `error` | Unsanitized variable interpolated directly into prompt string (`${input}` / `f"{input}"`). | Wraps variables in `<user_input>` XML tags and separates system vs. user roles. |
| `PL002` | `security` | `warning` | Missing instruction hierarchy boundary when handling untrusted input. | Adds explicit system directive to ignore instructions inside `<user_input>`. |
| `PL003` | `caching` | `warning` | Dynamic variables placed before static prefix or missing `cache_control: { type: "ephemeral" }`. | Moves static context to the top message block with `cache_control: { type: "ephemeral" }`. |
| `PL004` | `cost` | `info` | Verbose conversational filler inflating input token count on every request. | Compresses prompt phrasing while preserving exact output schema. |
| `PL005` | `cost` | `warning` | Frontier model (`gpt-4o`, `claude-3-5-sonnet`, `mistral-large`) used for low-complexity classification/extraction. | Routes via Mozilla Otari to the model's cheaper tier (`gpt-4o-mini`, `claude-3-5-haiku`, `ministral-8b`). |
| `PL006` | `latency` | `warning` | Missing `max_tokens` / `max_completion_tokens` ceiling. | Adds an explicit `max_tokens` bound. |
| `PL007` | `otari-routing` | `error` | Direct vendor SDK initialization bypassing Mozilla Otari Gateway. | Configures `baseURL: process.env.OTARI_BASE_URL` and `Otari-Key` header. |
| `PL008` | `caching` | `info` | Missing deterministic `Idempotency-Key` request header. | Injects SHA-256 `Idempotency-Key` header to leverage `Otari-Idempotent-Replayed: true`. |

---

## Repository Structure

```text
promptlint/
├── action.yml                    # Composite GitHub Action for Per-PR Cost & Security Reports
├── .github/workflows/            # CI pipeline running tests & posting PR Cost Reports
├── packages/
│   ├── shared/                   # Shared TypeScript interfaces, pricing catalog & API client SDK
│   ├── core/                     # Multi-language scanner, 8 lint rules, cost engine & Otari client
│   ├── cli/                      # `promptlint` CLI (`scan`, `optimize`, `ci-report`)
│   ├── server/                   # REST API Server (`http://localhost:4000`) for Web Playground
│   └── web/                      # Frontend Web Playground & Telemetry Dashboard
├── examples/
│   └── vulnerable-app/           # Demo TypeScript & Python LLM files with intentional smells
└── HANDOFF.md                    # Frontend specification & API guide
```

---

## Quick Start

### 1. Install & Build
```bash
npm install
npm run build
```

### 2. Scan a Repository or Directory via CLI
```bash
npm run scan -- ./examples/vulnerable-app
```

### 3. Optimize a File & Rewrite for Mozilla Otari Gateway
```bash
node packages/cli/dist/cli.js optimize ./examples/vulnerable-app/support-triage.ts
# Pass --write to update the file in place
```

### 4. Generate a GitHub Pull Request Cost Report
```bash
npm run ci-report -- ./examples/vulnerable-app
```

### 5. Start the Backend API Server
```bash
cp .env.example .env
# Add your OTARI_API_KEY in .env (optional for local dev; deterministic fallback included)
npm run dev:server
```

### 6. Live vs. Simulated

With `OTARI_API_KEY` set in `.env`, optimize and benchmark calls go live to `https://eu.api.otari.ai/api/v1`:

- **Optimizer:** `alibaba/qwen-3.5-35b-a3b` (override with `OTARI_OPTIMIZER_MODEL`) compresses the hardened prompt. Its rewrite is used only if it keeps every `<user_input>` guard, puts inputs last and is shorter; otherwise the rule-based rewrite is used, and `optimizerSource` says which.
- **Benchmark:** compares `mistralai/mistral-large-latest` with `mistralai/ministral-8b-latest` by default (override with `OTARI_BENCHMARK_ORIGINAL_MODEL` / `OTARI_BENCHMARK_OPTIMIZED_MODEL`). Cost comes from Otari's reported `usage.cost_usd` when available (`costSource: "gateway"`), otherwise from the pricing catalog. Output agreement is computed from the two responses.
- **Idempotent replay:** re-running an identical request sends the same `Idempotency-Key`. Otari returns `Otari-Idempotent-Replayed: true` with the real latency.

Without a key (or with `PROMPTLINT_OFFLINE=1`, which the tests use), a deterministic simulator answers instead, and every result is flagged `simulated: true`. A failed live call also falls back to the simulator and reports `gatewayError`. Token counts use the `o200k_base` BPE tokenizer.

### 7. Start the Web UI
```bash
npm run dev:web
```
Opens the Playground, Benchmark, PR Reports and Dashboard at `http://localhost:5173`. It talks to the API at `VITE_API_URL` (default `http://localhost:4000`). Results that came from the offline simulator rather than a live Otari call are badged **SIMULATED**.

---

## GitHub Action Usage

Add PromptLint to any repository in `.github/workflows/promptlint.yml`:

```yaml
name: PromptLint CI
on: [pull_request]

jobs:
  promptlint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: Ogstevyn/Promptlint@main
        with:
          target-path: "./src"
          monthly-volume: "100000"
          otari-api-key: ${{ secrets.OTARI_API_KEY }}
```

---

## License
Apache-2.0
