import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as expectedPhrases from "../dist/vapi/phrases.js";
const root = process.env.ZUKI_BASELINE_DIR;
const moduleAt = (path) => import(root ? pathToFileURL(resolve(root, "dist", path)).href : new URL(`../dist/${path}`, import.meta.url).href);
const { routeConversation, createOfferMemory, buildCompletion, buildSse } = await moduleAt("vapi/custom-llm.js");
const { createApiServer } = await moduleAt("api/server.js");
const { createKnowledgeSafeAssistantService } = await moduleAt("assistant/knowledge-safe-service.js");
const { loadZukiData } = await moduleAt("data/loader.js");
const { transformZukiData } = await moduleAt("data/transformer.js");
const { createAssistantConfig } = await moduleAt("vapi/assistant-config.js");
const targetPhrases = await moduleAt("vapi/phrases.js");
const { CONFIRMATION, DELIBERATE_OFFER, LOOKUP_ERROR_OFFER, FIRST_MESSAGE, RESERVATION_OFFER, REPLIES } = expectedPhrases;
// Baseline setup uses its own clarification text so later decisions are exercised.
const CLARIFY_OFFER = targetPhrases.CLARIFY_OFFER;
const data = transformZukiData(await loadZukiData());
const destination = "+12025550100";
const tools = [{ type: "function", function: { name: "transferCall", parameters: { type: "object", properties: { destination: { type: "string", enum: [destination] } } } } }];
const user = (content) => ({ role: "user", content });
const assistant = (content) => ({ role: "assistant", content });
const unknown = { lookup: async () => ({ status: "unavailable" }) };
const liveService = () => createKnowledgeSafeAssistantService(data, { claudeResponder: async () => ({ text: "A cappuccino is £3.55.", model: "test", stopReason: "end_turn" }) });
function decodeSse(body) {
  assert.ok(body.endsWith("data: [DONE]\n\n"));
  const chunks = body.split("\n\n").filter((part) => part && part !== "data: [DONE]").map((part) => JSON.parse(part.slice(6)));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].choices[0].finish_reason, null);
  const delta = chunks[0].choices[0].delta;
  if (delta.tool_calls) assert.equal(delta.tool_calls[0].index, 0);
  return { message: delta, finish_reason: chunks[1].choices[0].finish_reason };
}
function spoken(choice, text, context) {
  assert.equal(choice.finish_reason, "stop");
  assert.equal(choice.message.tool_calls, undefined);
  assert.equal(choice.message.content, text, context);
}
function transferred(choice) {
  assert.equal(choice.finish_reason, "tool_calls");
  assert.equal(choice.message.content, undefined);
  assert.equal(choice.message.tool_calls.length, 1);
  assert.equal(choice.message.tool_calls[0].function.name, "transferCall");
  assert.deepEqual(JSON.parse(choice.message.tool_calls[0].function.arguments), { destination });
}
async function http(service, stream, run) {
  const server = await new Promise((resolve) => { const s = createApiServer(service).listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const post = async (messages, id = "scenario") => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vapi/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, tools, stream, call: { id } }) });
      assert.equal(response.status, 200);
      return stream ? decodeSse(await response.text()) : (await response.json()).choices[0];
    };
    const session = (id = "scenario") => {
      const history = [];
      return async (text, omit = false) => {
        history.push(user(text));
        const choice = await post(history, id);
        if (!omit && choice.message.content !== undefined) history.push(assistant(choice.message.content));
        return choice;
      };
    };
    await run(post, session);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
for (const stream of [false, true]) {
  const mode = stream ? "SSE" : "JSON";
  test(`[G01 ${mode}] yes plus new Sunday question answers and clears offer`, async () => {
    await http(liveService(), stream, async (_, session) => {
      const turn = session(); spoken(await turn("What is the wifi password?"), CLARIFY_OFFER);
      spoken(await turn("Yes, but what time do you close on Sunday?"), "On sunday, Zuki's closes at 4 PM.");
      const next = await turn("Yes please"); assert.equal(next.finish_reason, "stop"); assert.equal(next.message.tool_calls, undefined);
    });
  });
  for (const question of ["What time do you close on Sunday?", "How much is a cappuccino?"]) test(`[G02 ${mode}] no thanks plus ${question}`, async () => {
    await http(liveService(), stream, async (_, session) => {
      const turn = session(); spoken(await turn("What is the wifi password?"), CLARIFY_OFFER);
      spoken(await turn(`No thanks, but ${question}`), question.startsWith("What") ? "On sunday, Zuki's closes at 4 PM." : "A cappuccino is 3 pounds 55.");
    });
  });
  for (const phrase of ["okay", "ok", "sure", "go ahead", "yes thanks", "yeah sure", "please", "sure thanks", "yes that'd be lovely", "yes please thanks", "Okay, great.", "thank you", "that'd be great", "that'd be nice", "that'd be perfect"]) test(`[G03 ${mode}] ${phrase} confirms then yes transfers`, async () => {
    await http(unknown, stream, async (_, session) => {
      const turn = session(); spoken(await turn("wifi?"), CLARIFY_OFFER);
      spoken(await turn(phrase), CONFIRMATION); transferred(await turn("Yes please"));
    });
  });
  for (const phrase of ["yes", "yes please", "yeah", "yep", "Yes, please transfer me!"]) test(`[G03 ${mode}] exact net yes ${phrase}`, async () => {
    const seen = [];
    const service = { lookup: async (query) => { seen.push(query); return { status: "unavailable" }; } };
    await http(service, stream, async (_, session) => {
      const turn = session(); spoken(await turn("wifi?"), CLARIFY_OFFER); transferred(await turn(phrase));
      assert.deepEqual(seen, ["wifi?"]);
    });
  });
  for (const phrase of ["Please tell me your address", "Okay, but do you have wifi?", "yes absolutely", "sure and thanks", "surely", "yes please transfer me now"]) test(`[G03 ${mode}] outside closed dictionary routes full query: ${phrase}`, async () => {
    const seen = [];
    const real = liveService();
    const service = { lookup: async (query) => { seen.push(query); return phrase === "Please tell me your address" ? real.lookup(query) : { status: "answered", text: "Lookup answer." }; } };
    await http(service, stream, async (post) => {
      const choice = await post([user("wifi?"), assistant(CLARIFY_OFFER), user(phrase)]);
      if (phrase === "Please tell me your address") {
        assert.equal(choice.finish_reason, "stop"); assert.equal(choice.message.tool_calls, undefined);
        assert.equal(choice.message.content, (await real.lookup(phrase)).text); assert.notEqual(choice.message.content, CONFIRMATION);
      } else spoken(choice, "Lookup answer.");
      assert.deepEqual(seen, [phrase]);
    });
  });
  test(`[G03 ${mode}] Okay but hours uses real service and unchanged query`, async () => {
    const query = "Okay, but what time do you close on Sunday?";
    const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
    const seen = [];
    const service = { lookup: async (original) => { seen.push(original); return real.lookup(original); } };
    await http(service, stream, async (_, session) => {
      const turn = session();
      spoken(await turn("What is the wifi password?"), CLARIFY_OFFER);
      spoken(await turn(query), "On sunday, Zuki's closes at 4 PM.");
      assert.deepEqual(seen, ["What is the wifi password?", query]);
    });
  });
  for (const memory of [true, false]) test(`[G04 ${mode}] two confirmations close on third, memory=${memory}`, async () => {
    await http(unknown, stream, async (post, session) => {
      if (memory) {
        const turn = session(); spoken(await turn("wifi?"), CLARIFY_OFFER);
        spoken(await turn("okay"), CONFIRMATION); spoken(await turn("okay"), CONFIRMATION);
        spoken(await turn("okay"), undefined); spoken(await turn("yes"), CLARIFY_OFFER);
      } else {
        const history = [user("wifi?"), assistant(CLARIFY_OFFER)];
        const offers = undefined;
        for (const [phrase, expected] of [["okay", CONFIRMATION], ["okay", CONFIRMATION], ["okay", undefined], ["yes", CLARIFY_OFFER]]) {
          history.push(user(phrase)); const action = await routeConversation(history, tools, unknown, undefined, offers);
          spoken(stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0], expected);
          if (action.kind === "speak") history.push(assistant(action.text));
        }
      }
    });
  });
  test(`[G04 ${mode}] confirmation records one, two, then closed`, async () => {
    const offers = createOfferMemory().forCall("counter");
    const history = [user("wifi?")];
    await routeConversation(history, tools, unknown, undefined, offers);
    assert.equal(offers.at(1), "clarify");
    for (const [turn, expected, state] of [[2, CONFIRMATION, "confirmation-1"], [3, CONFIRMATION, "confirmation-2"], [4, undefined, null]]) {
      history.push(user("okay"));
      const action = await routeConversation(history, tools, unknown, undefined, offers);
      spoken(stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0], expected);
      assert.equal(offers.at(turn), state);
    }
  });
  for (const phrase of ["Can I speak to someone?", "Please transfer me to someone", "Transfer me to someone"]) for (const offered of [false, true]) test(`[G05 ${mode}] explicit human ${phrase}, offer=${offered}`, async () => {
    const seen = [];
    const service = { lookup: async (query) => { seen.push(query); return { status: "unavailable" }; } };
    await http(service, stream, async (_, session) => {
      const turn = session(); if (offered) spoken(await turn("wifi?"), CLARIFY_OFFER); transferred(await turn(phrase));
      assert.deepEqual(seen, offered ? ["wifi?"] : []);
    });
  });
  for (const result of ["exception", "answered", "clarification_required"]) for (const response of ["yes", "no"]) test(`[G06 ${mode}] lookup ${result} offer then ${response}`, async () => {
    const service = { lookup: async () => { if (result === "exception") throw Error("private"); return { status: result, text: " \t " }; } };
    await http(service, stream, async (_, session) => { const turn = session(); spoken(await turn("query?"), LOOKUP_ERROR_OFFER); const choice = await turn(response); response === "yes" ? transferred(choice) : spoken(choice, REPLIES.declined); });
  });
  test(`[G07 ${mode}] deliberate live stock offer then yes`, async () => {
    await http(liveService(), stream, async (_, session) => { const turn = session(); spoken(await turn("Is the cappuccino available today?"), DELIBERATE_OFFER); transferred(await turn("yes")); });
  });
  test(`[G08 ${mode}] three repeated/new generic questions always reoffer`, async () => {
    await http(liveService(), stream, async (_, session) => { const turn = session(); for (const query of ["What is the wifi password?", "What is the wifi password?", "Do you have pineapple pizza?"]) spoken(await turn(query), CLARIFY_OFFER); transferred(await turn("yes")); });
  });
  for (const phrase of ["Okay, great.", "Alright.", "Lovely, cool."]) test(`[G09 ${mode}] ${phrase} preserves offer even with omitted transcript`, async () => {
    await http(unknown, stream, async (_, session) => { const turn = session(); spoken(await turn("wifi?"), CLARIFY_OFFER); spoken(await turn(phrase, true), phrase === "Okay, great." ? CONFIRMATION : undefined); transferred(await turn("Yes please")); });
  });
  for (const query of ["What time do you open on Sunday and what time do you close?", "What time do you close on Sunday and what time do you open?"]) test(`[G10 ${mode}] both times: ${query}`, async () => {
    await http(liveService(), stream, async (post) => { const expected = await post([user("What time do you open and close on Sunday?")], "reference"); spoken(await post([user(query)]), expected.message.content); assert.match(expected.message.content, /10 AM to 4 PM/); });
  });
  for (const query of [
    "Yes, but what time do you close on Sunday and what time do you open for delivery?",
    "No thanks, but what time do you open on Sunday and what time do you close for lunch?",
    "What time do you open on Sunday and what time do you close the kitchen?",
    "What time do you open on Sunday and what time do you close on Monday?",
    "What time do you open on Sunday and what time do you close and will you have cappuccino?",
  ]) test(`[G10 ${mode}] range rewrite preserves guard: ${query}`, async () => {
    const { lookupBusinessKnowledge } = await moduleAt("knowledge/router.js");
    const knowledge = lookupBusinessKnowledge(data, query);
    if (/delivery|lunch|kitchen/.test(query)) assert.equal(knowledge.status, "no_match");
    else if (query.includes("Monday")) assert.equal(knowledge.status, "transfer_required");
    else {
      assert.equal((await liveService().lookup(query)).status, "transfer_required");
      await http(liveService(), stream, async (post) => spoken(await post([user(query)]), DELIBERATE_OFFER));
    }
  });
  for (const [query, text, state] of [["wifi?", expectedPhrases.CLARIFY_OFFER, "clarify"], ["Can I book a table?", RESERVATION_OFFER, "reservation"], ["stock?", DELIBERATE_OFFER, "deliberate"], ["failure?", LOOKUP_ERROR_OFFER, "error"], ["okay", CONFIRMATION, "confirmation-1"]]) test(`[G11 ${mode}] records and text-recognizes ${state}`, async () => {
    const offers = createOfferMemory().forCall(state);
    const service = { lookup: async () => { if (state === "error") throw Error("private"); return state === "deliberate" ? { status: "transfer_required", reason: "live stock" } : { status: "unavailable" }; } };
    const history = state === "confirmation-1" ? [user("wifi?"), assistant(CLARIFY_OFFER), user(query)] : [user(query)];
    const action = await routeConversation(history, tools, service, undefined, offers);
    spoken(stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0], text);
    assert.equal(offers.at(state === "confirmation-1" ? 2 : 1), state);
    await http(unknown, stream, async (post) => { transferred(await post([user("question"), assistant(text), user("yes")], "text-fallback")); });
  });
  test(`[G11 ${mode}] opening is recorded greeting and never an offer`, async () => {
    assert.equal(createAssistantConfig("https://example.test", destination).firstMessage, FIRST_MESSAGE);
    await http(unknown, stream, async (post) => { spoken(await post([assistant(FIRST_MESSAGE), user("yes")]), CLARIFY_OFFER); });
  });
  for (const newerOffer of [false, true]) test(`[G12 ${mode}] late speculative result cannot overwrite ${newerOffer ? "offer" : "answer"}`, async () => {
    const offers = createOfferMemory().forCall("stale"); let release; let entered;
    const pending = new Promise((resolve) => { release = resolve; }); const started = new Promise((resolve) => { entered = resolve; });
    const service = { lookup: async (query) => { if (query === "partial") { entered(); return pending; } return query === "corrected" && !newerOffer ? { status: "answered", text: "Answer." } : { status: "unavailable" }; } };
    const stale = routeConversation([user("partial")], tools, service, undefined, offers); await started;
    await routeConversation([user("corrected")], tools, service, undefined, offers);
    release(newerOffer ? { status: "answered", text: "Old answer." } : { status: "unavailable" }); await stale;
    assert.equal(offers.at(1), newerOffer ? "clarify" : null);
    const action = await routeConversation([user("corrected"), assistant("Unrecognizable ASR"), user("yes")], tools, service, undefined, offers);
    const choice = stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0]; newerOffer ? transferred(choice) : spoken(choice, CLARIFY_OFFER);
  });
  test(`[G12 ${mode}] stale confirmation response cannot overwrite corrected answer`, async () => {
    const offers = createOfferMemory().forCall("counter-stale"); offers.record(1, "clarify");
    const history = [user("wifi?"), assistant(CLARIFY_OFFER)];
    const stale = routeConversation([...history, user("okay")], tools, unknown, undefined, offers);
    const corrected = routeConversation([...history, user("corrected")], tools, { lookup: async () => ({ status: "answered", text: "Answer." }) }, undefined, offers);
    await Promise.all([stale, corrected]); assert.equal(offers.at(2), null);
    const action = await routeConversation([...history, user("corrected"), user("yes")], tools, unknown, undefined, offers);
    spoken(stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0], CLARIFY_OFFER);
  });
  test(`[G12 ${mode}] TTL clears record and old begin cannot revive expired call`, async () => {
    let now = 0; const memory = createOfferMemory(100, () => now); const offers = memory.forCall("ttl");
    const finish = offers.begin(1); finish("clarify"); assert.equal(offers.at(1), "clarify"); now = 101; assert.equal(offers.at(1), undefined); finish("clarify"); assert.equal(offers.at(1), undefined);
    const action = await routeConversation([user("wifi?"), assistant("Unknown ASR"), user("yes")], tools, unknown, undefined, offers);
    spoken(stream ? decodeSse(buildSse(action)) : buildCompletion(action).choices[0], CLARIFY_OFFER);
    assert.equal(offers.at(2), "clarify");
  });
  test(`[G12 ${mode}] successful answer resets, repeated unknown reoffers, calls isolated`, async () => {
    await http(liveService(), stream, async (post, session) => {
      const turn = session("A"); spoken(await turn("What is the wifi password?"), CLARIFY_OFFER);
      spoken(await post([user("yes")], "B"), CLARIFY_OFFER);
      spoken(await turn("What time do you close on Sunday?", true), "On sunday, Zuki's closes at 4 PM.");
      const afterAnswer = await turn("yes"); assert.equal(afterAnswer.finish_reason, "stop"); assert.equal(afterAnswer.message.tool_calls, undefined);
      spoken(await turn("What is the wifi password?"), CLARIFY_OFFER); transferred(await turn("yes"));
    });
  });
}

const hoursRegressions = [
  ["Okay, but what time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM.", true],
  ["Sure, but what time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM.", true],
  ["Yes, but are you open on Sunday?", "On sunday, Zuki's opens at 10 AM.", true],
  ["No thanks, but are you open on Sunday?", "On sunday, Zuki's opens at 10 AM.", true],
  ["No, what time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM.", true],
  ["Yes, but how late are you open on Sunday?", "On sunday, Zuki's closes at 4 PM.", true],
  ["When do you open on Sunday and when do you close?", "On sunday, Zuki's is open from 10 AM to 4 PM.", false],
  ["What time do you open on Sunday and when do you close?", "On sunday, Zuki's is open from 10 AM to 4 PM.", false],
  ["What time do you open and what time do you close on Sunday?", "On sunday, Zuki's is open from 10 AM to 4 PM.", false],
];
for (const stream of [false, true]) {
  const mode = stream ? "SSE" : "JSON";
  for (const [index, [query, expected, offered]] of hoursRegressions.entries()) {
    test(`[H${String(index + 1).padStart(2, "0")} ${mode}] real knowledge service: ${query}`, async () => {
      const real = createKnowledgeSafeAssistantService(data, {
        claudeResponder: async () => assert.fail("hours must be answered locally"),
      });
      const seen = [];
      const service = { lookup: async (original) => { seen.push(original); return real.lookup(original); } };
      await http(service, stream, async (_, session) => {
        const turn = session();
        if (offered) spoken(await turn("What is the wifi password?"), CLARIFY_OFFER);
        const choice = await turn(query);
        if (process.env.ZUKI_HOURS_OBSERVATIONS) {
          const { appendFile } = await import("node:fs/promises");
          await appendFile(process.env.ZUKI_HOURS_OBSERVATIONS, JSON.stringify({ index: index + 1, mode, query, expected, actual: choice.message.content ?? "transferCall", finish_reason: choice.finish_reason }) + "\n");
        }
        spoken(choice, expected);
        assert.deepEqual(seen, offered ? ["What is the wifi password?", query] : [query]);
      });
    });
  }
}
for (const stream of [false, true]) {
  const mode = stream ? "SSE" : "JSON";
  for (const prefix of ["yes", "yeah", "yep", "okay", "ok", "sure", "go ahead", "no", "no thanks", "no thank you"]) {
    test(`[HM ${mode}] every hours family after ${prefix} with or without but`, async () => {
      const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
      const forms = [
        ["What time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM."],
        ["Are you open on Sunday?", "On sunday, Zuki's opens at 10 AM."],
        ["How late are you open on Sunday?", "On sunday, Zuki's closes at 4 PM."],
        ["Until what time are you open on Sunday?", "On sunday, Zuki's closes at 4 PM."],
        ["What are your Sunday hours?", "On sunday, Zuki's is open from 10 AM to 4 PM."],
        ["What is your opening time on Sunday?", "On sunday, Zuki's opens at 10 AM."],
        ["What is your closing time on Sunday?", "On sunday, Zuki's closes at 4 PM."],
        ["On Sunday when do you open?", "On sunday, Zuki's opens at 10 AM."],
      ];
      await http(real, stream, async (post) => {
        for (const but of ["", "but "]) for (const [question, expected] of forms) {
          const query = `${prefix}, ${but}${question}`;
          spoken(await post([user(query)], query), expected);
        }
      });
    });
  }
  test(`[HM ${mode}] different hours families, both orders and day positions`, async () => {
    const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
    const opening = ["What time do you open", "When do you open", "At what time are you opening", "Will you be open", "What time does the cafe open", "What is your opening time", "Are you open", "Do you open"];
    const closing = ["What time do you close", "When do you close", "At what time are you closing", "Will you shut", "What time does the cafe shut", "What is your closing time", "How late are you open", "Until what time are you open"];
    await http(real, stream, async (post) => {
      for (const open of opening) for (const close of closing) for (const reverse of [false, true]) {
        const [first, second] = reverse ? [close, open] : [open, close];
        for (const query of [
          `On Sunday ${first} and ${second}?`,
          `${first} on Sunday and ${second}?`,
          `${first} and on Sunday ${second}?`,
          `${first} and ${second} on Sunday?`,
        ]) spoken(await post([user(query)], query), "On sunday, Zuki's is open from 10 AM to 4 PM.", query);
      }
      for (const query of ["When do you close and open on Sunday?", "What time are you closing and opening on Sunday?"]) {
        spoken(await post([user(query)], query), "On sunday, Zuki's is open from 10 AM to 4 PM.");
      }
      spoken(await post([user("How late are you open on Sunday and when do you close?")], "same-intent"), "On sunday, Zuki's closes at 4 PM.");
    });
  });
}

for (const stream of [false, true]) {
  const mode = stream ? "SSE" : "JSON";
  for (const [query, kind] of [
    ["Sure, but when do you open on Sunday and how late are you open for delivery?", "scoped"],
    ["No thanks, but how late are you open on Sunday and when does the kitchen open?", "scoped"],
    ["Okay, but when do you open on Sunday and what time do you close for lunch?", "scoped"],
    ["When do you open on Sunday and what time do you close on Monday?", "multi-day"],
    ["Sure, but when do you open on Sunday and when do you close and will you have cappuccino?", "live"],
    ["How late are you open on Sunday and when do you open and is cappuccino available right now?", "live"],
    ["What is your opening time and what is your closing time on Sunday and do you have any cappuccino left?", "live"],
    ["How late are you open and when do you open on Sunday? I might get cappuccino.", "incidental"],
  ]) test(`[HG ${mode}] ${kind} guard in combined hours: ${query}`, async () => {
    const { lookupBusinessKnowledge } = await moduleAt("knowledge/router.js");
    const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
    if (kind === "scoped") {
      assert.equal(lookupBusinessKnowledge(data, query).status, "no_match");
      assert.equal((await real.lookup(query)).status, "transfer_required");
      await http(real, stream, async (post) => spoken(await post([user(query)]), CLARIFY_OFFER));
    } else {
      const result = await real.lookup(query);
      assert.equal(result.status, kind === "incidental" ? "answered" : "transfer_required");
      await http(real, stream, async (post) => {
        spoken(await post([user("wifi?"), assistant(CLARIFY_OFFER), user(query)]), kind === "incidental" ? "On sunday, Zuki's is open from 10 AM to 4 PM." : DELIBERATE_OFFER);
      });
    }
  });
}
const connectorQuestions = [
  ["What time do you open tomorrow?", DELIBERATE_OFFER],
  ["What time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM."],
  ["Are you open on Sunday?", "On sunday, Zuki's opens at 10 AM."],
  ["How late are you open on Sunday?", "On sunday, Zuki's closes at 4 PM."],
  ["Until what time are you open on Sunday?", "On sunday, Zuki's closes at 4 PM."],
  ["What are your Sunday hours?", "On sunday, Zuki's is open from 10 AM to 4 PM."],
  ["What is your opening time on Sunday?", "On sunday, Zuki's opens at 10 AM."],
  ["What is your closing time on Sunday?", "On sunday, Zuki's closes at 4 PM."],
  ["When do you open on Sunday and when do you close?", "On sunday, Zuki's is open from 10 AM to 4 PM."],
];
for (const stream of [false, true]) {
  const mode = stream ? "SSE" : "JSON";
  for (const [question, expected] of connectorQuestions) {
    test(`[HC ${mode}] prefix and connector equivalence: ${question}`, async () => {
      const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
      const seen = [];
      let result;
      const service = { lookup: async (original) => { seen.push(original); result = await real.lookup(original); return result; } };
      const comparable = () => ({ status: result.status, text: result.text, topic: result.topic, reason: result.reason });
      await http(service, stream, async (post) => {
        const start = [user("What is the wifi password?")];
        spoken(await post(start, "reference"), CLARIFY_OFFER);
        const history = [...start, assistant(CLARIFY_OFFER)];
        const reference = await post([...history, user(question)], "reference");
        spoken(reference, expected);
        assert.equal(seen.at(-1), question);
        const referenceResult = comparable();
        for (const prefix of ["yes", "yeah", "yep", "okay", "ok", "sure", "go ahead", "no", "no thanks", "no thank you"]) {
          for (const connector of ["but", "and", "so", ""]) {
            const query = `${prefix}, ${connector ? connector + " " : ""}${question}`;
            const id = `${prefix}-${connector}`;
            const before = seen.length;
            spoken(await post(start, id), CLARIFY_OFFER);
            const actual = await post([...history, user(query)], id);
            spoken(actual, reference.message.content, query);
            assert.equal(actual.finish_reason, reference.finish_reason, query);
            assert.deepEqual(comparable(), referenceResult, query);
            assert.deepEqual(seen.slice(before), ["What is the wifi password?", query]);
          }
        }
      });
    });
  }
  for (const [query, question, expected] of [
    ["Okay, and what time do you open tomorrow?", "What time do you open tomorrow?", DELIBERATE_OFFER],
    ["Yes, and what time do you close on Sunday?", "What time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM."],
    ["Okay, so what time do you close on Sunday?", "What time do you close on Sunday?", "On sunday, Zuki's closes at 4 PM."],
    ["No thanks, and are you open on Sunday?", "Are you open on Sunday?", "On sunday, Zuki's opens at 10 AM."],
  ]) test(`[HC-case ${mode}] offered question: ${query}`, async () => {
    const real = createKnowledgeSafeAssistantService(data, { claudeResponder: async () => assert.fail("unexpected responder") });
    const seen = [];
    const service = { lookup: async (original) => { seen.push(original); return real.lookup(original); } };
    await http(service, stream, async (post) => {
      const start = [user("What is the wifi password?")];
      const history = [...start, assistant(CLARIFY_OFFER)];
      spoken(await post(start, "bare"), CLARIFY_OFFER);
      const reference = await post([...history, user(question)], "bare");
      spoken(reference, expected);
      spoken(await post(start, "prefixed"), CLARIFY_OFFER);
      const actual = await post([...history, user(query)], "prefixed");
      spoken(actual, reference.message.content, query);
      assert.deepEqual(seen, ["What is the wifi password?", question, "What is the wifi password?", query]);
    });
  });
}