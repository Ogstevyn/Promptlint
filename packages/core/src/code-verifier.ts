import type { OtariCodeCheck, OtariToolCall } from "@promptlint/shared";
import { OtariGatewayClient, computeIdempotencyKey, type OtariChatResponse } from "./otari-client";

/**
 * Otari code execution: instead of trusting a model to *say* whether two outputs
 * agree, the verifier model is given PromptLint's comparison script and Otari's
 * code-execution tool (`tools: [{ type: "otari_code_execution" }]`); Otari runs the
 * script in its sandbox. The verdict is the sandbox's stdout from that exact script,
 * so a model answer without an execution, or from rewritten code, is not accepted.
 */

export const DEFAULT_VERIFIER_MODEL = "mistralai/mistral-large-latest";

export function otariCodeExecutionEnabled(): boolean {
  return (process.env.OTARI_CODE_EXECUTION ?? "1").trim() !== "0";
}

export function otariVerifierModel(): string {
  return process.env.OTARI_VERIFIER_MODEL || DEFAULT_VERIFIER_MODEL;
}

/** Marks PromptLint's script, so a verdict from code the model rewrote is not accepted */
const SCRIPT_MARKER = "# promptlint-agreement-check v1";

/**
 * The comparison, as Python for Otari's sandbox. Fixed code rather than code the
 * model writes: model-written checks proved unreliable (e.g. mis-stripping code
 * fences), and a verdict should not depend on the model's coding. The outputs go
 * in base64, so no output text can break out of the string literal.
 */
export function buildAgreementScript(a: string, b: string): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  return `${SCRIPT_MARKER}
import base64, json, re
A = "${b64(a)}"
B = "${b64(b)}"

def clean(b64):
    t = base64.b64decode(b64).decode("utf-8").strip()
    fence = chr(96) * 3
    lines = t.splitlines()
    if len(lines) >= 2 and lines[0].strip().startswith(fence) and lines[-1].strip() == fence:
        t = chr(10).join(lines[1:-1]).strip()
    return t

def as_obj(t):
    try:
        v = json.loads(t)
    except Exception:
        return None
    return v if isinstance(v, dict) else None

def norm(v):
    return v.strip().lower() if isinstance(v, str) else v

ta, tb = clean(A), clean(B)
oa, ob = as_obj(ta), as_obj(tb)
if oa is not None and ob is not None:
    keys = set(oa) | set(ob)
    match = sum(1 for k in keys if k in oa and k in ob and norm(oa[k]) == norm(ob[k]))
    out = {"mode": "json", "validA": True, "validB": True, "sameKeys": set(oa) == set(ob),
           "matchingValues": match, "totalKeys": len(keys),
           "agreementPct": round(100 * match / len(keys), 1) if keys else 100.0}
else:
    wa = set(re.findall(r"[a-z0-9]+", ta.lower()))
    wb = set(re.findall(r"[a-z0-9]+", tb.lower()))
    f1 = 1.0 if not wa and not wb else 2 * len(wa & wb) / (len(wa) + len(wb))
    out = {"mode": "text", "validA": oa is not None, "validB": ob is not None, "sameKeys": False,
           "matchingValues": 0, "totalKeys": 0, "agreementPct": round(100 * f1, 1)}
print(json.dumps(out))
`;
}

function parseVerdict(text: string | undefined): Partial<OtariCodeCheck> | undefined {
  if (!text) return undefined;
  const lines = text.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const v = JSON.parse(trimmed);
      if (typeof v?.agreementPct !== "number" || !Number.isFinite(v.agreementPct)) continue;
      const out: Partial<OtariCodeCheck> = {
        agreementPct: Math.max(0, Math.min(100, Math.round(v.agreementPct * 10) / 10))
      };
      if (v.mode === "json" || v.mode === "text") out.mode = v.mode;
      for (const k of ["validA", "validB", "sameKeys"] as const) if (typeof v[k] === "boolean") out[k] = v[k];
      for (const k of ["matchingValues", "totalKeys"] as const) if (Number.isInteger(v[k]) && v[k] >= 0) out[k] = v[k];
      return out;
    } catch {
      /* not the verdict line */
    }
  }
  return undefined;
}

function codeCalls(calls: OtariToolCall[] | undefined): OtariToolCall[] {
  return (calls ?? []).filter((c) => c.type.includes("code"));
}

/** Read the sandbox's verdict out of an Otari response (exported for tests) */
export function codeCheckFromResponse(res: OtariChatResponse, model: string): OtariCodeCheck {
  const base = {
    model,
    latencyMs: res.latencyMs,
    otariRequestId: res.otariRequestId,
    idempotentReplayed: res.idempotentReplayed,
    ...(res.routing?.servedModel ? { servedModel: res.routing.servedModel } : {}),
    ...(res.gatewayCostUsd !== undefined ? { costUsd: res.gatewayCostUsd } : {})
  };
  if (res.blocked) {
    return { ...base, status: "unavailable", reason: `Otari refused the check (${res.blocked.code})`, executions: 0 };
  }
  if (res.simulated) {
    return {
      ...base,
      status: "unavailable",
      reason: res.gatewayError ? `code execution call failed: ${res.gatewayError}` : "no OTARI_API_KEY",
      executions: 0
    };
  }
  const calls = codeCalls(res.toolCalls);
  if (calls.length === 0) {
    return { ...base, status: "no_execution", reason: "the model answered without running code", executions: 0 };
  }
  // Newest successful run first: its stdout is the verdict
  const ordered = [...calls].reverse();
  for (const call of ordered) {
    const ours = call.code === undefined || call.code.includes(SCRIPT_MARKER);
    const verdict = ours && (call.exitCode === undefined || call.exitCode === 0) ? parseVerdict(call.stdout) : undefined;
    if (verdict) {
      return {
        ...base,
        status: "verified",
        ...verdict,
        code: call.code,
        stdout: call.stdout?.trim(),
        ...(call.stderr ? { stderr: call.stderr.trim() } : {}),
        exitCode: call.exitCode ?? 0,
        executions: calls.length
      };
    }
  }
  const last = calls[calls.length - 1];
  return {
    ...base,
    status: "failed",
    reason: calls.some((c) => c.code && !c.code.includes(SCRIPT_MARKER))
      ? "the model ran different code instead of PromptLint's script"
      : "the sandboxed code printed no verdict",
    code: last.code,
    stdout: last.stdout?.trim(),
    ...(last.stderr ? { stderr: last.stderr.trim() } : {}),
    ...(last.exitCode !== undefined ? { exitCode: last.exitCode } : {}),
    executions: calls.length
  };
}

/**
 * Measure agreement between two outputs with code run in Otari's sandbox.
 * Billed to the app's key, not an end user: one sandbox run costs about $0.01.
 */
export async function verifyAgreementWithCodeExecution(
  a: string,
  b: string,
  options: { client?: OtariGatewayClient; model?: string } = {}
): Promise<OtariCodeCheck> {
  const model = options.model || otariVerifierModel();
  const client = options.client ?? new OtariGatewayClient();
  const content = [
    "Use the code execution tool to run the following Python exactly as written, without changing it.",
    "Do not work the result out yourself. After it has run, reply with only the line it printed.",
    "",
    "```python",
    buildAgreementScript(a, b),
    "```"
  ].join("\n");
  let check: OtariCodeCheck | undefined;
  // A model occasionally answers from reading the data instead of calling the tool:
  // ask once more, with a fresh idempotency key so Otari does not replay that answer
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.chatCompletion({
      model,
      temperature: 0,
      // The tool loop's code and the final line both count against max_tokens
      max_tokens: 2000,
      tools: [{ type: "otari_code_execution" }],
      idempotencyKey: computeIdempotencyKey({ stage: "code-check", v: 4, model, a, b, attempt }),
      // One user turn: with the instructions in a system message, models tended to
      // answer without calling the tool
      messages: [{ role: "user", content }]
    });
    const next = codeCheckFromResponse(res, model);
    if (check?.costUsd !== undefined && next.costUsd !== undefined) next.costUsd += check.costUsd;
    check = next;
    if (check.status !== "no_execution") break;
  }
  return check!;
}
