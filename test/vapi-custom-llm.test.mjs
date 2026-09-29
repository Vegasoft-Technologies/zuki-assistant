import test from "node:test";
import assert from "node:assert/strict";
import { createOfferMemory, routeConversation, toSpokenPrices, buildSse, buildCompletion, transferToolShape } from "../dist/vapi/custom-llm.js";
import { CLARIFY_OFFER, PHRASES, REPLIES, RESERVATION_OFFER, TRANSFER_FAILURE } from "../dist/vapi/phrases.js";
import { createApiServer } from "../dist/api/server.js";
import { createKnowledgeSafeAssistantService } from "../dist/assistant/knowledge-safe-service.js";
import { loadZukiData } from "../dist/data/loader.js";
import { transformZukiData } from "../dist/data/transformer.js";

const destination = "+12025550100";
const tools = [{ type: "function", function: { name: "transferCall", parameters: {
  type: "object", properties: { destination: { type: "string", enum: [destination] } },
} } }];
const user = (content) => ({ role: "user", content });
const noLookup = { lookup: () => assert.fail("unexpected lookup") };
const transfer = { kind: "transfer", destination };
const speak = (text) => ({ kind: "speak", text });
const chunks = (sse) => {
  assert.ok(sse.endsWith("data: [DONE]\n\n"));
  return sse.split("\n\n").filter((line) => line && line !== "data: [DONE]").map((line) => {
    assert.ok(line.startsWith("data: "));
    const chunk = JSON.parse(line.slice(6));
    assert.equal(chunk.object, "chat.completion.chunk");
    assert.equal(chunk.model, "zuki-router");
    assert.equal(chunk.choices[0].index, 0);
    return chunk;
  });
};
function assertTransfer(parts, number = destination) {
  const first = parts[0].choices[0];
  assert.equal(first.delta.content, undefined);
  assert.equal(first.delta.tool_calls[0].index, 0);
  assert.match(first.delta.tool_calls[0].id, /^call_/);
  assert.equal(first.delta.tool_calls[0].type, "function");
  assert.deepEqual(first.delta.tool_calls[0].function, { name: "transferCall", arguments: JSON.stringify({ destination: number }) });
  assert.equal(parts.at(-1).choices[0].finish_reason, "tool_calls");
}

test("spoken prices preserve all required amounts and other text", () => {
  for (const [input, output] of [
    ["£3.55", "3 pounds 55"], ["£3.5", "3 pounds 50"], ["£3.50", "3 pounds 50"], ["£29.95", "29 pounds 95"],
    ["£5", "5 pounds"], ["£5.00", "5 pounds"], ["£1", "1 pound"], ["£1.20", "1 pound 20"], ["£0.80", "80 pence"],
    ["Which size?", "Which size?"], ["£1 and £3.55.", "1 pound and 3 pounds 55."],
  ]) assert.equal(toSpokenPrices(input), output);
});

test("routing handles fixed phrases and reservation follow-ups without lookup", async () => {
  for (const [phrases, reply] of [[PHRASES.greeting, REPLIES.greeting], [PHRASES.goodbye, REPLIES.goodbye], [PHRASES.filler, REPLIES.filler]]) {
    for (const phrase of phrases) assert.deepEqual(await routeConversation([user(phrase)], tools, noLookup), speak(reply));
  }
  for (const [input, output] of [["Hello!", REPLIES.greeting], ["Hi, how are you?", REPLIES.greeting], ["Thank you, bye", REPLIES.goodbye], ["thanks and goodbye", REPLIES.goodbye], ["Can I book a table for tonight?", RESERVATION_OFFER], ["Can you hold a table?", RESERVATION_OFFER]]) {
    assert.deepEqual(await routeConversation([user(input)], tools, noLookup), speak(output));
  }
  const offer = { role: "assistant", content: RESERVATION_OFFER };
  for (const yes of PHRASES.yes) {
    for (const suffix of ["", " please", " thanks"]) assert.deepEqual(await routeConversation([offer, user(yes + suffix)], tools, noLookup), transfer);
  }
  for (const no of PHRASES.no) assert.deepEqual(await routeConversation([offer, user(no)], tools, noLookup), speak("No problem."));
  for (const role of ["tool", "assistant", "system"]) assert.deepEqual(await routeConversation([{ role, content: "yes" }], tools, noLookup), { kind: "silent" });
  assert.deepEqual(await routeConversation([], tools, noLookup), { kind: "silent" });
  for (const person of PHRASES.human) {
    for (const request of PHRASES.humanRequest) assert.deepEqual(await routeConversation([user(`Can I ${request} a ${person}?`)], tools, noLookup), transfer);
  }
  for (const person of PHRASES.humanOnly) assert.deepEqual(await routeConversation([user(person)], tools, noLookup), transfer);
});

test("natural closers, greetings, fillers and booking words route without lookup", async () => {
  const cases = [
    ["Okay, thank you.", speak(REPLIES.goodbye)],
    ["Great, thanks!", speak(REPLIES.goodbye)],
    ["Perfect.", { kind: "silent" }],
    ["Okay.", { kind: "silent" }],
    ["No, that’s all, thanks.", speak(REPLIES.goodbye)],
    ["Hello there.", speak(REPLIES.greeting)],
    ["Hi there!", speak(REPLIES.greeting)],
    ["Sorry, what?", speak(REPLIES.filler)],
    ["I'd like to make a booking.", speak(RESERVATION_OFFER)],
    ["Do you take reservations?", speak(RESERVATION_OFFER)],
    ["Hi Zuki, how are you?", speak(REPLIES.greeting)],
    ["Hi, good morning!", speak(REPLIES.greeting)],
    ["Thank you so much.", speak(REPLIES.goodbye)],
    ["That's it.", { kind: "silent" }],
    ["Nothing else.", { kind: "silent" }],
    ["Alright, got it, cheers.", speak(REPLIES.goodbye)],
    ["Lovely. Cool.", { kind: "silent" }],
    ["Come again?", speak(REPLIES.filler)],
    ["Can you repeat that?", speak(REPLIES.filler)],
    ["Say that again.", speak(REPLIES.filler)],
    ["I didn’t catch that.", speak(REPLIES.filler)],
    ["What did you say?", speak(REPLIES.filler)],
  ];
  for (const [turn, expected] of cases) {
    assert.deepEqual(await routeConversation([user(turn)], tools, noLookup), expected, turn);
  }
  const offerWithExtraText = { role: "assistant", content: `Sorry, I can't make reservations. ${RESERVATION_OFFER}` };
  assert.deepEqual(await routeConversation([offerWithExtraText, user("yes please")], tools, noLookup), transfer);
  assert.deepEqual(await routeConversation([offerWithExtraText, user("no thanks")], tools, noLookup), speak(REPLIES.declined));
});

test("reservation declines do not transfer, while new questions go to lookup", async () => {
  const offer = { role: "assistant", content: RESERVATION_OFFER };
  for (const turn of ["No, that's okay.", "No, I'm good, thanks.", "Nah."]) {
    assert.deepEqual(await routeConversation([offer, user(turn)], tools, noLookup), speak(REPLIES.declined), turn);
  }
  const seen = [];
  const service = { lookup: async (query) => {
    seen.push(query);
    return { status: "answered", text: "We close at 4 PM." };
  } };
  for (const turn of ["No, what time do you close on Sunday?", "No, what time do you close on Sunday."]) {
    assert.deepEqual(await routeConversation([offer, user(turn)], tools, service), speak("We close at 4 PM."));
  }
  assert.deepEqual(seen, ["No, what time do you close on Sunday?", "No, what time do you close on Sunday."]);
});

test("classification normalization never changes the lookup text", async () => {
  const seen = [];
  const service = { lookup: async (query) => {
    seen.push(query);
    return { status: "answered", text: "Source-backed answer." };
  } };
  for (const turn of ["  Hi, do you have sushi?!  ", "Okay, do you serve lunch?", "No, what's on the menu?", "What’s the best to share?"]) {
    assert.deepEqual(await routeConversation([user(turn)], tools, service), speak("Source-backed answer."));
  }
  assert.deepEqual(seen, ["  Hi, do you have sushi?!  ", "Okay, do you serve lunch?", "No, what's on the menu?", "What’s the best to share?"]);
});

test("lookup receives whole original turns exactly once, including text parts and repeated questions", async () => {
  const seen = [];
  const service = { lookup: async (query) => { seen.push(query); return { status: "answered", text: "£3.55" }; } };
  for (const turn of ["  Hi, how much is a cappuccino?  ", "What's the best to share?", "What's good for a group?", "yes", "Which bookcase?", "How much is a cappuccino?"]) {
    assert.deepEqual(await routeConversation([user(turn), { role: "assistant", content: "old answer" }, user(turn)], tools, service), speak("3 pounds 55"));
    assert.equal(seen.at(-1), turn);
  }
  assert.equal(seen.length, 6);
  assert.deepEqual(await routeConversation([user([{ type: "text", text: "How much " }, { type: "text", text: "is a cappuccino?" }])], tools, service), speak("3 pounds 55"));
  assert.equal(seen.at(-1), "How much is a cappuccino?");
  const result = await routeConversation([{ role: "assistant", content: RESERVATION_OFFER }, user("What are your hours?")], tools, service);
  assert.equal(seen.at(-1), "What are your hours?");
  assert.equal(result.kind, "speak");
});

test("lookup status, failures and destination fallback determine actions", async () => {
  for (const result of [{ status: "transfer_required" }, { status: "transfer_required", reason: "The request cannot be verified from current menu information." }, { status: "answered", text: " " }, { status: "clarification_required", text: "" }, null]) {
    const service = { lookup: async () => { if (result === null) throw Error("private"); return result; } };
    assert.deepEqual(await routeConversation([user("sushi?")], tools, service, "+12025550101"), transfer);
    assertTransfer(chunks(buildSse(await routeConversation([user("sushi?")], tools, service))));
    assert.deepEqual(await routeConversation([user("sushi?")], [], service, destination), transfer);
    assert.deepEqual(await routeConversation([user("sushi?")], [], service), speak(TRANSFER_FAILURE));
  }
  for (const values of [[], [destination, "+12025550101"], ["bad"]]) {
    const ambiguous = structuredClone(tools);
    ambiguous[0].function.parameters.properties.destination.enum = values;
    assert.deepEqual(await routeConversation([user("human")], ambiguous, noLookup, destination), transfer);
    assert.deepEqual(await routeConversation([user("human")], ambiguous, noLookup), speak(TRANSFER_FAILURE));
  }
  assert.deepEqual(await routeConversation([user("coffee?")], tools, { lookup: async () => ({ status: "clarification_required", text: "Which size?" }) }), speak("Which size?"));
  const shape = JSON.stringify(transferToolShape(tools));
  assert.ok(shape.includes("destination"));
  assert.ok(!shape.includes(destination));
});

test("generic fallbacks offer one transfer per call; deliberate transfers stay direct", async () => {
  const service = createKnowledgeSafeAssistantService(transformZukiData(await loadZukiData()));
  for (const turn of ["What is the wifi password?", "Blah flurb cappucheeno?"]) {
    assert.deepEqual(await routeConversation([user(turn)], tools, service), speak(CLARIFY_OFFER), turn);
  }
  for (const turn of ["Where are you and do you have sushi?", "Is the cappuccino available today?", "Can I speak to a human?"]) {
    assert.deepEqual(await routeConversation([user(turn)], tools, service), transfer, turn);
  }
  const unavailable = { lookup: async () => ({ status: "unavailable", reason: "claude_response_ungrounded", text: "private" }) };
  assert.deepEqual(await routeConversation([user("How much is it?")], tools, unavailable), speak(CLARIFY_OFFER));

  const offer = { role: "assistant", content: CLARIFY_OFFER };
  for (const yes of ["yes", "yes please", "okay", "sure thanks"]) {
    assert.deepEqual(await routeConversation([user("wifi?"), offer, user(yes)], tools, noLookup), transfer, yes);
  }
  for (const no of ["no", "no thanks", "Nah."]) {
    assert.deepEqual(await routeConversation([user("wifi?"), offer, user(no)], tools, noLookup), speak(REPLIES.declined), no);
  }
  const answered = { lookup: async () => ({ status: "answered", text: "A cappuccino is £3.55." }) };
  assert.deepEqual(await routeConversation([user("How much is a capuchino?"), offer, user("How much is a cappuccino?")], tools, answered), speak("A cappuccino is 3 pounds 55."));

  // A second generic fallback in the same call transfers instead of looping.
  const history = [user("wifi?"), offer, user("How much is a cappuccino?"), { role: "assistant", content: "A cappuccino is 3 pounds 55." }];
  assert.deepEqual(await routeConversation([...history, user("What is the wifi password?")], tools, service), transfer);
  assert.deepEqual(await routeConversation([user("wifi?"), { role: "assistant", content: `Hmm. ${CLARIFY_OFFER}` }, user("Blah flurb?")], tools, service), transfer);
});

test("offers are remembered per call even when Vapi rewrites spoken assistant turns", async () => {
  const service = createKnowledgeSafeAssistantService(transformZukiData(await loadZukiData()));
  const memory = createOfferMemory();
  const system = { role: "system", content: "system prompt" };
  // Vapi returns a speech transcript of what the bot said, not the text we sent.
  const greeting = { role: "assistant", content: "Hold your breath The system. How can I help you?" };
  const heardOffer = { role: "assistant", content: "I'm sorry I'm not so. Would you like me to trans for you to someone from a tea?" };
  const start = [system, greeting, user("What is the wifi password?")];

  for (const [reply, expected] of [["No thanks", speak(REPLIES.declined)], ["Nah.", speak(REPLIES.declined)], ["yes please", transfer]]) {
    const offers = memory.forCall(`call-${reply}`);
    assert.deepEqual(await routeConversation(start, tools, service, undefined, offers), speak(CLARIFY_OFFER));
    assert.deepEqual(await routeConversation([...start, heardOffer, user(reply)], tools, service, undefined, offers), expected, reply);
  }

  // A second generic fallback in the same call transfers, even though the offer text was garbled.
  const offers = memory.forCall("call-second");
  await routeConversation(start, tools, service, undefined, offers);
  const afterAnswer = [...start, heardOffer, user("What time do you open on Sunday?")];
  assert.equal((await routeConversation(afterAnswer, tools, service, undefined, offers)).kind, "speak");
  const heardAnswer = { role: "assistant", content: "On Sunday, the cookies opens at 10 AM." };
  assert.deepEqual(await routeConversation([...afterAnswer, heardAnswer, user("Do you have pineapple pizza?")], tools, service, undefined, offers), transfer);

  // Another call starts fresh.
  assert.deepEqual(await routeConversation(start, tools, service, undefined, memory.forCall("call-other")), speak(CLARIFY_OFFER));

  // A discarded speculative answer for the same user turn is replaced by the final one.
  const speculative = memory.forCall("call-speculative");
  assert.deepEqual(await routeConversation([system, greeting, user("What is the")], tools, service, undefined, speculative), speak(CLARIFY_OFFER));
  assert.equal((await routeConversation([system, greeting, user("What time do you open on Sunday?")], tools, service, undefined, speculative)).kind, "speak");
  const next = [system, greeting, user("What time do you open on Sunday?"), heardAnswer, user("Do you have pineapple pizza?")];
  assert.deepEqual(await routeConversation(next, tools, service, undefined, speculative), speak(CLARIFY_OFFER));
});

test("offer text fallback and memory expiry", async () => {
  let time = 0;
  const memory = createOfferMemory(1000, () => time);
  memory.forCall("old").record(1, "clarify");
  assert.equal(memory.forCall("old").at(1), "clarify");
  time = 5000;
  memory.forCall("new").record(1, null);
  assert.equal(memory.forCall("old").at(1), undefined);

  // Without a call id, surviving keywords still identify the offer.
  for (const heard of ["I'm sorry, I'm not sure about that. Would you like me to transfer you?", "Sorry I can't make reservations would you like"]) {
    assert.deepEqual(await routeConversation([user("x"), { role: "assistant", content: heard }, user("no thanks")], tools, noLookup), speak(REPLIES.declined), heard);
  }
  assert.deepEqual(await routeConversation([{ role: "assistant", content: "Hold your breath The system." }, user("no thanks")], tools, noLookup), speak(REPLIES.goodbye));
});

test("HTTP custom LLM keeps the transfer offer across requests of the same call", async () => {
  const service = createKnowledgeSafeAssistantService(transformZukiData(await loadZukiData()));
  await withServer(service, async (url) => {
    const post = async (messages, call) => (await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, tools, stream: false, ...(call === undefined ? {} : { call }) }) })).json()).choices[0].message.content;
    const start = [{ role: "assistant", content: "Hello, you reached the Zucchini System." }, user("What is the wifi password?")];
    const heardOffer = { role: "assistant", content: "Want to be boys to some one?" };
    assert.equal(await post(start, { id: "call-http", extra: true }), CLARIFY_OFFER);
    assert.equal(await post([...start, heardOffer, user("No thanks")], { id: "call-http" }), REPLIES.declined);
    assert.equal(await post([...start, heardOffer, user("No thanks")], { id: 42 }), REPLIES.goodbye);
  });
});

test("SSE and JSON builders cover speak, silent and transfer completions", () => {
  for (const action of [speak("Hello!"), { kind: "silent" }, transfer]) {
    const parts = chunks(buildSse(action));
    assert.equal(parts.length, 2);
    assert.equal(parts[0].id, parts[1].id);
    assert.equal(parts[0].choices[0].delta.role, "assistant");
    assert.equal(parts[0].choices[0].finish_reason, null);
    assert.deepEqual(parts[1].choices[0].delta, {});
    const json = buildCompletion(action);
    assert.equal(json.object, "chat.completion");
    if (action.kind === "transfer") {
      assertTransfer(parts);
      assert.equal(json.choices[0].finish_reason, "tool_calls");
      assert.equal(json.choices[0].message.content, undefined);
    } else {
      assert.equal(parts[0].choices[0].delta.content, action.text);
      assert.equal(parts[1].choices[0].finish_reason, "stop");
      assert.equal(json.choices[0].message.content, action.text);
    }
  }
});

async function withServer(service, run) {
  const server = await new Promise((resolve) => { const s = createApiServer(service).listen(0, "127.0.0.1", () => resolve(s)); });
  try { await run(`http://127.0.0.1:${server.address().port}/api/vapi/chat/completions`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("HTTP custom LLM preserves combined query, streams transfers and speaks prices/clarification", async () => {
  const seen = [];
  const combined = "Where are you and do you have sushi?";
  await withServer({ lookup: async (query) => {
    seen.push(query);
    if (query === combined) return { status: "transfer_required", text: "must not speak" };
    if (query === "coffee?") return { status: "clarification_required", text: "Which size?" };
    return { status: "answered", text: "3.55? No, £3.55." };
  } }, async (url) => {
    const post = (body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await post({ messages: [user(combined)], tools, stream: true, call: { id: "extra" }, metadata: {}, temperature: 0 });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    assertTransfer(chunks(await response.text()));
    assert.deepEqual(seen, [combined]);
    for (const stream of [true, false]) {
      for (const [turn, expected] of [["How much is a cappuccino?", "3.55? No, 3 pounds 55."], ["coffee?", "Which size?"]]) {
        const response = await post({ messages: [user([{ type: "text", text: turn }])], stream });
        const text = stream ? chunks(await response.text())[0].choices[0].delta.content : (await response.json()).choices[0].message.content;
        assert.equal(text, expected);
        assert.ok(!text.includes("£"));
      }
    }
    const silent = await post({ messages: [{ role: "tool", content: "done" }], stream: false });
    assert.deepEqual((await silent.json()).choices[0], { index: 0, message: { role: "assistant" }, finish_reason: "stop" });
  });
});

test("HTTP lookup exceptions still return SSE or JSON with env fallback or failure sentence", async (t) => {
  t.mock.method(console, "info", () => {});
  const old = process.env.ZUKI_TEST_TRANSFER_NUMBER;
  try {
    await withServer({ lookup: async () => { throw Error("private"); } }, async (url) => {
      for (const fallback of [destination, undefined]) {
        if (fallback) process.env.ZUKI_TEST_TRANSFER_NUMBER = fallback;
        else delete process.env.ZUKI_TEST_TRANSFER_NUMBER;
        for (const stream of [true, false]) {
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [user("sushi?")], stream }) });
          assert.equal(response.status, 200);
          if (stream) {
            const parts = chunks(await response.text());
            if (fallback) assertTransfer(parts);
            else assert.equal(parts[0].choices[0].delta.content, TRANSFER_FAILURE);
          } else {
            const completion = await response.json();
            assert.equal(completion.object, "chat.completion");
            assert.equal(completion.choices[0].finish_reason, fallback ? "tool_calls" : "stop");
          }
        }
      }
    });
  } finally {
    if (old === undefined) delete process.env.ZUKI_TEST_TRANSFER_NUMBER;
    else process.env.ZUKI_TEST_TRANSFER_NUMBER = old;
  }
});

test("HTTP validation retains JSON error conventions and 100kb body limit", async () => {
  await withServer(noLookup, async (url) => {
    for (const [body, status] of [["{", 400], ["{}", 400], [JSON.stringify({ messages: [{ role: "user", content: 5 }] }), 400], [JSON.stringify({ messages: [], padding: "x".repeat(103000) }), 413]]) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, "string");
    }
  });
});

test("internal route errors return a valid transfer and schema logging occurs once", async (t) => {
  const info = t.mock.method(console, "info", () => { throw Error("internal logger error"); });
  await withServer(noLookup, async (url) => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [user("human")], tools, stream: true, call: { id: "call-1" } }) });
      assert.equal(response.status, 200);
      assertTransfer(chunks(await response.text()));
    }
    // The transfer schema and the call-id presence are each logged once, never per request.
    assert.equal(info.mock.callCount(), 2);
    for (const call of info.mock.calls) {
      assert.ok(!JSON.stringify(call.arguments).includes(destination));
      assert.ok(!JSON.stringify(call.arguments).includes("call-1"));
    }
  });
});
