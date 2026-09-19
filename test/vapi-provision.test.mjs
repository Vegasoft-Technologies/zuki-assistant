import assert from "node:assert/strict";
import test from "node:test";
import { provision } from "../dist/vapi/provision.js";
import { createLookupTool, createAssistantConfig, SYSTEM_PROMPT, STATUS_RULES, TRANSFER_MESSAGE } from "../dist/vapi/assistant-config.js";

const toolId = "11111111-1111-4111-8111-111111111111";
const assistantId = "22222222-2222-4222-8222-222222222222";
const env = {
  VAPI_API_KEY: "test-secret",
  ZUKI_API_BASE_URL: "https://backend.example.com/",
  ZUKI_TEST_TRANSFER_NUMBER: "+12025550100",
};
const quiet = () => {};

test("provision creates the REST lookup tool first, then attaches its returned ID", async () => {
  const calls = [];
  const logs = [];
  const result = await provision(env, {
    log: (line) => logs.push(line),
    fetch: async (url, init) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      return Response.json({ id: calls.length === 1 ? toolId : assistantId }, { status: 201 });
    },
  });
  assert.deepEqual(result, { toolId, assistantId });
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.vapi.ai/tool", "POST"], ["https://api.vapi.ai/assistant", "POST"],
  ]);
  assert.equal(calls[0].headers.Authorization, "Bearer test-secret");
  assert.equal(calls[0].body.type, "apiRequest");
  assert.deepEqual(calls[0].body.headers, {
    type: "object",
    properties: { "Content-Type": { type: "string", value: "application/json" } },
  });
  assert.equal(calls[0].body.url, "https://backend.example.com/api/lookup");
  assert.deepEqual(calls[0].body.body.required, ["query"]);
  assert.deepEqual(Object.keys(calls[0].body.body.properties), ["query"]);
  assert.equal(calls[0].body.body.additionalProperties, false);
  assert.equal(calls[0].body.variableExtractionPlan, undefined);
  assert.deepEqual(calls[1].body.model.toolIds, [toolId]);
  assert.equal(calls[1].body.model.tools[0].destinations[0].number, env.ZUKI_TEST_TRANSFER_NUMBER);
  assert.equal(calls[1].body.model.tools[0].destinations[0].message, TRANSFER_MESSAGE);
  assert.ok(!logs.join("\n").includes(env.VAPI_API_KEY));
});

test("rerun with saved IDs PATCHes existing resources and updates the backend URL", async () => {
  const calls = [];
  await provision({ ...env, ZUKI_API_BASE_URL: "https://deployed.example.com/base/", VAPI_LOOKUP_TOOL_ID: toolId, VAPI_ASSISTANT_ID: assistantId }, {
    log: quiet,
    fetch: async (url, init) => {
      calls.push({ url, ...init, body: JSON.parse(init.body) });
      return Response.json({ id: url.endsWith(toolId) ? toolId : assistantId });
    },
  });
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    [`https://api.vapi.ai/tool/${toolId}`, "PATCH"], [`https://api.vapi.ai/assistant/${assistantId}`, "PATCH"],
  ]);
  assert.equal(calls[0].body.url, "https://deployed.example.com/base/api/lookup");
});

test("dry run needs no credentials or number and makes no network calls", async () => {
  const plan = await provision({}, { dryRun: true, log: quiet, fetch: () => assert.fail("network") });
  assert.equal(plan.tool.body.url, "https://zuki-api.example.com/api/lookup");
  assert.equal(plan.assistant.body.model.tools[0].destinations[0].number, "+12025550100");
});

test("invalid environment is rejected before any remote mutation", async () => {
  for (const overrides of [
    { VAPI_API_KEY: "" }, { VAPI_API_KEY: "replace_with_key" },
    { ZUKI_TEST_TRANSFER_NUMBER: "" }, { ZUKI_TEST_TRANSFER_NUMBER: "123" },
    { ZUKI_API_BASE_URL: "http://localhost" }, { ZUKI_API_BASE_URL: "https://user:secret@example.com" },
    { ZUKI_API_BASE_URL: "https://example.com?secret=foo" },
    { VAPI_LOOKUP_TOOL_ID: "../assistant" }, { VAPI_ASSISTANT_ID: "invalid" },
  ]) {
    await assert.rejects(provision({ ...env, ...overrides }, { log: quiet, fetch: () => assert.fail("network") }));
  }
});

test("tool HTTP failure stops assistant creation and does not leak response body", async () => {
  let count = 0;
  await assert.rejects(provision(env, { log: quiet, fetch: async () => {
    count++;
    return new Response("test-secret", { status: 401 });
  } }), (error) => error.message.includes("HTTP 401") && !error.message.includes("test-secret"));
  assert.equal(count, 1);
});

test("partial creation reports tool ID so a retry can reuse it", async () => {
  const logs = [];
  let count = 0;
  await assert.rejects(provision(env, { log: (line) => logs.push(line), fetch: async () => {
    count++;
    return count === 1 ? Response.json({ id: toolId }) : new Response("failure", { status: 500 });
  } }), /assistant: HTTP 500/);
  assert.deepEqual(logs, [`VAPI_LOOKUP_TOOL_ID=${toolId}`]);
});

test("uncertain network outcomes and malformed success responses require dashboard recovery", async () => {
  for (const response of [null, {}, { id: "invalid" }]) {
    let count = 0;
    await assert.rejects(provision(env, { log: quiet, fetch: async () => {
      count++;
      if (response === null) throw new Error("secret in network error");
      return Response.json(response);
    } }), /[Cc]heck dashboard/);
    assert.equal(count, 1);
  }
});

test("deployed prompt keeps clarification separate from mandatory transfers", () => {
  assert.deepEqual(Object.keys(STATUS_RULES).sort(), ["answered", "clarification_required", "transfer_required", "unavailable"].sort());
  assert.match(STATUS_RULES.clarification_required, /Do NOT transfer/);
  assert.match(STATUS_RULES.clarification_required, /NEW lookup_zuki_info/);
  for (const status of ["transfer_required", "unavailable"]) {
    assert.match(STATUS_RULES[status], /Read text verbatim, then invoke transferCall/);
  }
  const config = createAssistantConfig(toolId, env.ZUKI_TEST_TRANSFER_NUMBER);
  assert.equal(config.model.messages[0].content, SYSTEM_PROMPT);
  assert.match(SYSTEM_PROMPT, /For EVERY factual question/);
  assert.match(SYSTEM_PROMPT, /Reservations are not supported/);
  assert.match(SYSTEM_PROMPT, /Never paraphrase/);
  assert.equal(config.transcriber.language, "en");
  assert.equal(createLookupTool(env.ZUKI_API_BASE_URL).name, "lookup_zuki_info");
});
