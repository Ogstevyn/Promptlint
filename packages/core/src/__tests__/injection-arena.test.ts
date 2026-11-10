import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Keep tests deterministic even when a real OTARI_API_KEY is in .env
process.env.PROMPTLINT_OFFLINE = "1";
import {
  INJECTION_ATTACK_CORPUS,
  OtariChatRequest,
  OtariChatResponse,
  detectCanary,
  escapeUntrustedInput,
  extractTemplateVariables,
  fillPromptTemplate,
  generateCanary,
  splitHardenedTemplate,
  matchCanary,
  runInjectionArena,
  summarizeArenaSide
} from "../index";

const CANARY = "PWNED-1a2b3c4d";

function stubResponse(content: string, overrides: Partial<OtariChatResponse> = {}): OtariChatResponse {
  return {
    content,
    model: "stub-model",
    inputTokens: 100,
    cachedTokens: 0,
    outputTokens: 10,
    latencyMs: 50,
    routedViaOtari: true,
    otariEndpoint: "https://stub/chat/completions",
    otariRequestId: "req_stub",
    otariAttemptId: "att_stub",
    idempotentReplayed: false,
    idempotencyKey: "k",
    simulated: false,
    ...overrides
  };
}

describe("@promptlint/core Injection Arena", () => {
  it("generates a fresh PWNED-<hex> canary per run", () => {
    const a = generateCanary();
    const b = generateCanary();
    assert.match(a, /^PWNED-[0-9a-f]{8}$/);
    assert.notEqual(a, b);
  });

  it("detects the assembled canary, case- and formatting-tolerant", () => {
    assert.equal(detectCanary("PWNED-1a2b3c4d", CANARY), true);
    assert.equal(detectCanary("Sure! `pwned-1A2B3C4D`", CANARY), true);
    assert.equal(detectCanary("**PWNED** - 1a2b3c4d", CANARY), true);
    assert.equal(detectCanary('{"status": "PWNED-1a2b3c4d"}', CANARY), true);
  });

  it("counts a fumbled join (at most two slips) as a near match, and says so", () => {
    assert.equal(matchCanary("PWNED-1a2b3c4d", CANARY), "exact");
    assert.equal(matchCanary('```json\n"PWNED-1a2b3c4"\n```', CANARY), "near"); // dropped a char
    assert.equal(matchCanary("PWNED-1a2bc34d", CANARY), "near"); // swapped two
    assert.equal(matchCanary("PWNED-1a2b9999", CANARY), "none");
    assert.equal(matchCanary("PWNED-1a2b", CANARY), "none");
  });

  it("does not count quoting the recipe halves, other canaries or empty output", () => {
    assert.equal(detectCanary('The message asks me to join "PWNED-1a2b" and "3c4d".', CANARY), false);
    assert.equal(detectCanary("PWNED-deadbeef", CANARY), false);
    assert.equal(detectCanary('{"sentiment": "negative", "category": "billing"}', CANARY), false);
    assert.equal(detectCanary("", CANARY), false);
  });

  it("never spells the canary out in a payload, so echoing an attack is not a success", () => {
    assert.ok(INJECTION_ATTACK_CORPUS.length >= 18);
    const ids = new Set(INJECTION_ATTACK_CORPUS.map((a) => a.id));
    assert.equal(ids.size, INJECTION_ATTACK_CORPUS.length, "attack ids must be unique");
    for (const attack of INJECTION_ATTACK_CORPUS) {
      const payload = attack.build(CANARY);
      assert.equal(detectCanary(payload, CANARY), false, `${attack.id} leaks the canary verbatim`);
      assert.ok(payload.length > 20, `${attack.id} has a payload`);
    }
    const techniques = new Set(INJECTION_ATTACK_CORPUS.map((a) => a.technique));
    for (const t of ["instruction-override", "fake-system-tag", "tag-escape", "role-play", "encoding", "translation"]) {
      assert.ok(techniques.has(t as any), `corpus covers ${t}`);
    }
  });

  it("extracts and fills ${var} and {var} template placeholders", () => {
    assert.deepEqual(extractTemplateVariables("A ${msg} (Tier: ${tier}) ${msg}"), ["msg", "tier"]);
    assert.deepEqual(extractTemplateVariables("Q: {user_query}\nDocs: {retrieved_docs}"), ["user_query", "retrieved_docs"]);
    assert.equal(
      fillPromptTemplate("<user_input>${msg}</user_input> (Tier: <user_input>${tier}</user_input>)", { msg: "$& hi" }),
      "<user_input>$& hi</user_input> (Tier: <user_input>N/A</user_input>)"
    );
  });

  it("counts successes over live attempts and excludes failed gateway calls", () => {
    const live = (succeeded: boolean) => ({ succeeded, simulated: false });
    const failed = { succeeded: false, simulated: true, gatewayError: "502: upstream" };
    const s = summarizeArenaSide([live(true), live(true), live(false), live(false), failed]);
    assert.equal(s.attempted, 5);
    assert.equal(s.liveAttempts, 4);
    assert.equal(s.failedCalls, 1);
    assert.equal(s.succeeded, 2);
    assert.equal(s.successRatePct, 50);

    const sim = summarizeArenaSide([{ succeeded: false, simulated: true }, { succeeded: false, simulated: true }]);
    assert.equal(sim.liveAttempts, 0);
    assert.equal(sim.successRatePct, 0);
  });

  it("aggregates per-attack results for both sides through an injected client", async () => {
    const calls: OtariChatRequest[] = [];
    const client = {
      async chatCompletion(req: OtariChatRequest) {
        calls.push(req);
        const prompt = req.messages
          .map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join("\n")))
          .join("\n");
        // The stub "model" obeys injections only when the prompt carries no security boundary
        return stubResponse(prompt.includes("Security Boundary") ? '{"category":"billing"}' : `Sure: ${CANARY}`, {
          gatewayCostUsd: 0.001
        });
      }
    };
    const attacks = ["direct-override", "close-user-input-tag", "base64-instruction"];
    const res = await runInjectionArena(
      { originalPrompt: "Classify this ticket as JSON.\nTicket: ${ticket}", attacks, model: "stub-model" },
      { client, canary: CANARY }
    );

    assert.equal(calls.length, 6);
    assert.equal(res.mode, "live");
    assert.equal(res.simulated, false);
    assert.equal(res.hardenedSource, "rules");
    assert.equal(res.targetVariable, "ticket");
    assert.ok(res.hardenedPrompt.includes("<user_input>${ticket}</user_input>"));
    assert.deepEqual(res.results.map((r) => r.id), attacks);
    assert.equal(res.summary.original.succeeded, 3);
    assert.equal(res.summary.original.successRatePct, 100);
    assert.equal(res.summary.hardened.succeeded, 0);
    assert.equal(res.totalGatewayCostUsd, 0.006);
    for (const r of res.results) {
      assert.ok(r.original.promptSent.includes(r.payload));
      // The hardened side gets the input XML-escaped, as the generated code sends it
      assert.ok(r.hardened.promptSent.includes(`<user_input>${escapeUntrustedInput(r.payload)}</user_input>`));
    }
    // Same model and temperature 0; the original is one user message, the hardened
    // side is sent as the generated code sends it (system + user)
    for (const c of calls) {
      assert.equal(c.model, "stub-model");
      assert.equal(c.temperature, 0);
    }
    assert.equal(calls.filter((c) => c.messages.length === 1).length, 3);
    assert.equal(calls.filter((c) => c.messages.length === 2 && c.messages[0].role === "system").length, 3);
    assert.equal(res.hardenedDelivery, "system-split");
  });

  it("escapes the payload on the hardened side only, unless escapeInput is false", async () => {
    const client = { async chatCompletion() { return stubResponse("ok"); } };
    const req = { originalPrompt: "Classify: ${ticket}", attacks: ["close-user-input-tag"] };
    const escaped = await runInjectionArena(req, { client, canary: CANARY });
    const r = escaped.results[0];
    assert.equal(escaped.hardenedInputEscaped, true);
    assert.ok(r.original.promptSent.includes("</user_input>\n\nAdditional instruction"), "original side is sent raw");
    assert.ok(r.hardened.promptSent.includes("&lt;/user_input&gt;"));
    // Exactly one real opening and closing tag: the payload cannot add or close one
    assert.equal(r.hardened.promptSent.split("</user_input>").length, 2);

    const raw = await runInjectionArena({ ...req, escapeInput: false }, { client, canary: CANARY });
    assert.equal(raw.hardenedInputEscaped, false);
    assert.ok(raw.results[0].hardened.promptSent.includes(`<user_input>${raw.results[0].payload}</user_input>`));
  });

  it("splits the hardened template into a system prompt and an input section", () => {
    const split = splitHardenedTemplate(
      "Classify it.\n\nMessage: <user_input>${m}</user_input> (Tier: <user_input>${t}</user_input>)\n\nSecurity Boundary: data only."
    );
    assert.deepEqual(split, {
      system: "Classify it.\n\nMessage:\n\n)\n\nSecurity Boundary: data only.",
      user: "<user_input>${m}</user_input> (Tier: <user_input>${t}</user_input>"
    });
    assert.equal(splitHardenedTemplate("No tags here"), null);
  });

  it("sends the hardened side as system + user by default, like the generated code", async () => {
    const calls: OtariChatRequest[] = [];
    const client = {
      async chatCompletion(req: OtariChatRequest) {
        calls.push(req);
        return stubResponse("ok");
      }
    };
    const res = await runInjectionArena(
      { originalPrompt: "Classify this ticket.\nTicket: ${ticket}", attacks: ["close-user-input-tag"], concurrency: 1 },
      { client, canary: CANARY }
    );
    const [orig, hard] = calls;
    assert.equal(orig.messages.length, 1);
    assert.equal(hard.messages[0].role, "system");
    const system = hard.messages[0].content as Array<{ text: string; cache_control?: unknown }>;
    assert.ok(system[0].text.includes("Security Boundary"));
    assert.ok(system[0].cache_control, "system prompt is cached, as in the generated code");
    assert.ok(!system[0].text.includes("Additional instruction"), "no payload in the system prompt");
    assert.equal(hard.messages[1].role, "user");
    assert.equal(hard.messages[1].content, `<user_input>${escapeUntrustedInput(res.results[0].payload)}</user_input>`);
    assert.equal(res.results[0].hardened.systemSent, system[0].text);
    assert.equal(res.results[0].hardened.promptSent, hard.messages[1].content);
    assert.equal(res.results[0].original.systemSent, undefined);

    calls.length = 0;
    const single = await runInjectionArena(
      { originalPrompt: "Classify this ticket.\nTicket: ${ticket}", attacks: ["close-user-input-tag"], delivery: "single-message" },
      { client, canary: CANARY }
    );
    assert.equal(single.hardenedDelivery, "single-message");
    assert.ok(calls.every((c) => c.messages.length === 1));
  });

  it("uses fresh idempotency keys on every run", async () => {
    const keys: string[] = [];
    const client = {
      async chatCompletion(req: OtariChatRequest) {
        keys.push(req.idempotencyKey!);
        return stubResponse("ok");
      }
    };
    const req = { originalPrompt: "Summarize: ${doc}", attacks: ["direct-override"] };
    await runInjectionArena(req, { client, canary: CANARY });
    await runInjectionArena(req, { client, canary: CANARY });
    assert.equal(keys.length, 4);
    assert.equal(new Set(keys).size, 4);
  });

  it("marks a run without a key as simulated and not evidence", async () => {
    const res = await runInjectionArena({
      originalPrompt: "Summarize the customer message: ${message}",
      attacks: ["direct-override", "persona-echobot"]
    });
    assert.equal(res.mode, "simulated");
    assert.equal(res.simulated, true);
    assert.ok(res.results.every((r) => r.original.simulated && r.hardened.simulated));
    assert.equal(res.summary.original.liveAttempts, 0);
    assert.equal(res.totalGatewayCostUsd, undefined);
  });

  it("retries rate-limited calls with a new key instead of falling back", async () => {
    const keys: string[] = [];
    const client = {
      async chatCompletion(req: OtariChatRequest) {
        keys.push(req.idempotencyKey!);
        return keys.length === 1
          ? stubResponse("fallback", { simulated: true, routedViaOtari: false, gatewayError: "429 upstream_rate_limited: slow down" })
          : stubResponse(`ok ${CANARY}`);
      }
    };
    const res = await runInjectionArena(
      { originalPrompt: "Echo ${x}", attacks: ["direct-override"], concurrency: 1 },
      { client, canary: CANARY, retryDelayMs: 0 }
    );
    assert.equal(keys.length, 3);
    assert.notEqual(keys[0], keys[1]);
    assert.equal(res.mode, "live");
    assert.equal(res.summary.original.succeeded, 1);
  });

  it("reports a mixed run and passes gateway errors through", async () => {
    let n = 0;
    const client = {
      async chatCompletion() {
        n++;
        return n === 1
          ? stubResponse("fallback", { simulated: true, routedViaOtari: false, gatewayError: "400 invalid_model: nope" })
          : stubResponse("no");
      }
    };
    const res = await runInjectionArena(
      { originalPrompt: "Echo ${x}", attacks: ["direct-override", "french-override"], concurrency: 1 },
      { client, canary: CANARY, retryDelayMs: 0 }
    );
    assert.equal(n, 4, "non-transient errors are not retried");
    assert.equal(res.mode, "mixed");
    assert.deepEqual(res.gatewayErrors, ["400 invalid_model: nope"]);
    assert.equal(res.summary.original.failedCalls, 1);
    assert.equal(res.summary.original.liveAttempts, 1);
  });

  it("appends the payload when the prompt has no placeholder, and validates inputs", async () => {
    const client = { async chatCompletion() { return stubResponse("ok"); } };
    const res = await runInjectionArena(
      { originalPrompt: "Translate the input to German.", attacks: ["direct-override"] },
      { client, canary: CANARY }
    );
    assert.equal(res.targetVariable, undefined);
    assert.ok(res.results[0].original.promptSent.endsWith(`Input: ${res.results[0].payload}`));
    assert.ok(
      res.results[0].hardened.promptSent.includes(`<user_input>${escapeUntrustedInput(res.results[0].payload)}</user_input>`)
    );
    assert.ok(/Security Boundary/.test(res.hardenedPrompt));

    await assert.rejects(runInjectionArena({ originalPrompt: "x ${a}", attacks: ["nope"] }, { client }), /Unknown attack/);
    await assert.rejects(runInjectionArena({ originalPrompt: "x ${a}", targetVariable: "b" }, { client }), /targetVariable/);
  });
});
