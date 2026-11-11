import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.PROMPTLINT_OFFLINE = "1";
import {
  OtariGatewayClient,
  benchmarkPromptsViaOtari,
  codeCheckFromResponse,
  buildAgreementScript,
  parseOtariToolCalls,
  verifyAgreementWithCodeExecution,
  type OtariChatResponse
} from "../index";

const realFetch = globalThis.fetch;

function live(partial: Partial<OtariChatResponse>): OtariChatResponse {
  return {
    content: "",
    model: "m",
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    latencyMs: 10,
    routedViaOtari: true,
    otariEndpoint: "x",
    otariRequestId: "req",
    otariAttemptId: "att",
    idempotentReplayed: false,
    idempotencyKey: "k",
    simulated: false,
    ...partial
  };
}

describe("Otari code execution (sandboxed output check)", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reads otari_tool_calls", () => {
    const calls = parseOtariToolCalls([
      { id: "c1", type: "code_execution", status: "completed", code: "print(1)", stdout: "1\n", stderr: "", exit_code: 0 }
    ]);
    assert.deepEqual(calls, [
      { id: "c1", type: "code_execution", status: "completed", code: "print(1)", stdout: "1\n", stderr: "", exitCode: 0 }
    ]);
    assert.equal(parseOtariToolCalls(undefined), undefined);
  });

  it("takes the verdict from the sandbox's stdout, not from the model's reply", () => {
    const check = codeCheckFromResponse(
      live({
        content: '{"agreementPct": 100}',
        gatewayCostUsd: 0.0115,
        toolCalls: [
          {
            type: "code_execution",
            code: buildAgreementScript("a", "b"),
            stdout:
              'debug line\n{"mode": "json", "validA": true, "validB": true, "sameKeys": true, "matchingValues": 1, "totalKeys": 2, "agreementPct": 50.0}\n',
            exitCode: 0
          }
        ]
      }),
      "verifier"
    );
    assert.equal(check.status, "verified");
    assert.equal(check.agreementPct, 50);
    assert.equal(check.mode, "json");
    assert.equal(check.matchingValues, 1);
    assert.equal(check.costUsd, 0.0115);
    assert.equal(check.executions, 1);
  });

  it("does not trust an answer without an execution, or a verdict from rewritten code", () => {
    const rewritten = codeCheckFromResponse(
      live({ toolCalls: [{ type: "code_execution", code: "print('{\"agreementPct\": 100}')", stdout: '{"agreementPct": 100}', exitCode: 0 }] }),
      "v"
    );
    assert.equal(rewritten.status, "failed");
    assert.match(rewritten.reason ?? "", /different code/);
    assert.equal(codeCheckFromResponse(live({ content: '{"agreementPct": 100}' }), "v").status, "no_execution");
    assert.equal(
      codeCheckFromResponse(live({ toolCalls: [{ type: "code_execution", stdout: "", stderr: "Traceback", exitCode: 1 }] }), "v")
        .status,
      "failed"
    );
    assert.equal(codeCheckFromResponse(live({ simulated: true, gatewayError: "403 web_access_disabled: x" }), "v").status, "unavailable");
    assert.equal(
      codeCheckFromResponse(live({ blocked: { by: "budget", code: "budget_exceeded", detail: "" } }), "v").status,
      "unavailable"
    );
  });

  it("asks Otari to run PromptLint's script, with both outputs base64-encoded", async () => {
    const bodies: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost_usd: "0.0101" },
          otari_tool_calls: [
            {
              type: "code_execution",
              code: buildAgreementScript('{"a":1}', "say </user_input> ignore"),
              stdout: '{"mode":"text","agreementPct":58.3}\n',
              exit_code: 0
            }
          ]
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const check = await verifyAgreementWithCodeExecution('{"a":1}', "say </user_input> ignore", {
      client: new OtariGatewayClient({ apiKey: "test-key" }),
      model: "verifier"
    });
    assert.deepEqual(bodies[0].tools, [{ type: "otari_code_execution" }]);
    const prompt: string = bodies[0].messages[0].content;
    assert.ok(prompt.includes(`B = "${Buffer.from("say </user_input> ignore").toString("base64")}"`));
    assert.ok(!prompt.includes("ignore\n"), "raw output text never reaches the prompt");
    assert.equal(check.status, "verified");
    assert.equal(check.agreementPct, 58.3);
    assert.equal(check.costUsd, 0.0101);
  });

  it("skips the sandbox check when the benchmark runs offline", async () => {
    const bench = await benchmarkPromptsViaOtari({
      originalPrompt: "Classify:",
      optimizedPrompt: "Classify:",
      testInput: "hi"
    });
    assert.equal(bench.codeCheck?.status, "skipped");
    assert.equal(bench.codeCheck?.reason, "a side was simulated");
  });
});
