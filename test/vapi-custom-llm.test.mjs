import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfferMemory,
  routeConversation,
  toSpokenPrices,
  buildSse,
  buildCompletion,
  transferToolShape,
} from "../dist/vapi/custom-llm.js";
import {
  CLARIFY_OFFER,
  PHRASES,
  REPLIES,
  RESERVATION_OFFER,
  TRANSFER_FAILURE,
} from "../dist/vapi/phrases.js";
import { createApiServer } from "../dist/api/server.js";
import { createKnowledgeSafeAssistantService } from "../dist/assistant/knowledge-safe-service.js";
import { loadZukiData } from "../dist/data/loader.js";
import { transformZukiData } from "../dist/data/transformer.js";
process.env.VAPI_SECRET_KEY = "test-secret-123";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const req = new Request(url, options);
  req.headers.set("x-vapi-secret", process.env.VAPI_SECRET_KEY);
  return originalFetch(req);
};

const destination = "+12025550100";
const tools = [
  {
    type: "function",
    function: {
      name: "transferCall",
      parameters: {
        type: "object",
        properties: { destination: { type: "string", enum: [destination] } },
      },
    },
  },
];
const user = (content) => ({ role: "user", content });
const noLookup = { lookup: () => assert.fail("unexpected lookup") };
const transfer = { kind: "transfer", destination };
const speak = (text) => ({ kind: "speak", text });
const chunks = (sse) => {
  assert.ok(sse.endsWith("data: [DONE]\n\n"));
  return sse
    .split("\n\n")
    .filter((line) => line && line !== "data: [DONE]")
    .map((line) => {
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
  assert.deepEqual(first.delta.tool_calls[0].function, {
    name: "transferCall",
    arguments: JSON.stringify({ destination: number }),
  });
  assert.equal(parts.at(-1).choices[0].finish_reason, "tool_calls");
}

test("spoken prices preserve all required amounts and other text", () => {
  for (const [input, output] of [
    ["£3.55", "3 pounds 55"],
    ["£3.5", "3 pounds 50"],
    ["£3.50", "3 pounds 50"],
    ["£29.95", "29 pounds 95"],
    ["£5", "5 pounds"],
    ["£5.00", "5 pounds"],
    ["£1", "1 pound"],
    ["£1.20", "1 pound 20"],
    ["£0.80", "80 pence"],
    ["Which size?", "Which size?"],
    ["£1 and £3.55.", "1 pound and 3 pounds 55."],
  ])
    assert.equal(toSpokenPrices(input), output);
});

test("routing handles fixed phrases and reservation follow-ups without lookup", async () => {
  for (const [phrases, reply] of [
    [PHRASES.greeting, REPLIES.greeting],
    [PHRASES.goodbye, REPLIES.goodbye],
    [PHRASES.filler, REPLIES.filler],
  ]) {
    for (const phrase of phrases)
      assert.deepEqual(
        await routeConversation([user(phrase)], tools, noLookup),
        speak(reply),
      );
  }
  for (const [input, output] of [
    ["Hello!", REPLIES.greeting],
    ["Hi, how are you?", REPLIES.greeting],
    ["Thank you, bye", REPLIES.goodbye],
    ["thanks and goodbye", REPLIES.goodbye],
    ["Can I book a table for tonight?", RESERVATION_OFFER],
    ["Can you hold a table?", RESERVATION_OFFER],
  ]) {
    assert.deepEqual(
      await routeConversation([user(input)], tools, noLookup),
      speak(output),
    );
  }
  const offer = { role: "assistant", content: RESERVATION_OFFER };
  for (const yes of PHRASES.yes) {
    for (const suffix of ["", " please", " thanks"])
      assert.deepEqual(
        await routeConversation([offer, user(yes + suffix)], tools, noLookup),
        transfer,
      );
  }
  for (const no of PHRASES.no)
    assert.deepEqual(
      await routeConversation([offer, user(no)], tools, noLookup),
      speak("No problem."),
    );
  for (const role of ["tool", "assistant", "system"])
    assert.deepEqual(
      await routeConversation([{ role, content: "yes" }], tools, noLookup),
      { kind: "silent" },
    );
  assert.deepEqual(await routeConversation([], tools, noLookup), {
    kind: "silent",
  });
  for (const person of PHRASES.human) {
    for (const request of PHRASES.humanRequest)
      assert.deepEqual(
        await routeConversation(
          [user(`Can I ${request} a ${person}?`)],
          tools,
          noLookup,
        ),
        transfer,
      );
  }
  for (const person of PHRASES.humanOnly)
    assert.deepEqual(
      await routeConversation([user(person)], tools, noLookup),
      transfer,
    );
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
    assert.deepEqual(
      await routeConversation([user(turn)], tools, noLookup),
      expected,
      turn,
    );
  }
  const offerWithExtraText = {
    role: "assistant",
    content: `Sorry, I can't make reservations. ${RESERVATION_OFFER}`,
  };
  assert.deepEqual(
    await routeConversation(
      [offerWithExtraText, user("yes please")],
      tools,
      noLookup,
    ),
    transfer,
  );
  assert.deepEqual(
    await routeConversation(
      [offerWithExtraText, user("no thanks")],
      tools,
      noLookup,
    ),
    speak(REPLIES.declined),
  );
});

test("reservation declines do not transfer, while new questions go to lookup", async () => {
  const offer = { role: "assistant", content: RESERVATION_OFFER };
  for (const turn of ["No, that's okay.", "No, I'm good, thanks.", "Nah."]) {
    assert.deepEqual(
      await routeConversation([offer, user(turn)], tools, noLookup),
      speak(REPLIES.declined),
      turn,
    );
  }
  const seen = [];
  const service = {
    lookup: async (query) => {
      seen.push(query);
      return { status: "answered", text: "We close at 4 PM." };
    },
  };
  for (const turn of [
    "No, what time do you close on Sunday?",
    "No, what time do you close on Sunday.",
  ]) {
    assert.deepEqual(
      await routeConversation([offer, user(turn)], tools, service),
      speak("We close at 4 PM."),
    );
  }
  assert.deepEqual(seen, [
    "No, what time do you close on Sunday?",
    "No, what time do you close on Sunday.",
  ]);
});

test("classification normalization never changes the lookup text", async () => {
  const seen = [];
  const service = {
    lookup: async (query) => {
      seen.push(query);
      return { status: "answered", text: "Source-backed answer." };
    },
  };
  for (const turn of [
    "  Hi, do you have sushi?!  ",
    "Okay, do you serve lunch?",
    "No, what's on the menu?",
    "What’s the best to share?",
  ]) {
    assert.deepEqual(
      await routeConversation([user(turn)], tools, service),
      speak("Source-backed answer."),
    );
  }
  assert.deepEqual(seen, [
    "  Hi, do you have sushi?!  ",
    "Okay, do you serve lunch?",
    "No, what's on the menu?",
    "What’s the best to share?",
  ]);
});

test("lookup receives whole original turns exactly once, including text parts and repeated questions", async () => {
  const seen = [];
  const service = {
    lookup: async (query) => {
      seen.push(query);
      return { status: "answered", text: "£3.55" };
    },
  };
  for (const turn of [
    "  Hi, how much is a cappuccino?  ",
    "What's the best to share?",
    "What's good for a group?",
    "yes",
    "Which bookcase?",
    "How much is a cappuccino?",
  ]) {
    assert.deepEqual(
      await routeConversation(
        [user(turn), { role: "assistant", content: "old answer" }, user(turn)],
        tools,
        service,
      ),
      speak("3 pounds 55"),
    );
    assert.equal(seen.at(-1), turn);
  }
  assert.equal(seen.length, 6);
  assert.deepEqual(
    await routeConversation(
      [
        user([
          { type: "text", text: "How much " },
          { type: "text", text: "is a cappuccino?" },
        ]),
      ],
      tools,
      service,
    ),
    speak("3 pounds 55"),
  );
  assert.equal(seen.at(-1), "How much is a cappuccino?");
  const result = await routeConversation(
    [
      { role: "assistant", content: RESERVATION_OFFER },
      user("What are your hours?"),
    ],
    tools,
    service,
  );
  assert.equal(seen.at(-1), "What are your hours?");
  assert.equal(result.kind, "speak");
});

test("lookup status, failures and destination fallback determine actions", async () => {
  for (const result of [
    { status: "transfer_required" },
    {
      status: "transfer_required",
      reason: "The request cannot be verified from current menu information.",
    },
    { status: "answered", text: " " },
    { status: "clarification_required", text: "" },
    null,
  ]) {
    const service = {
      lookup: async () => {
        if (result === null) throw Error("private");
        return result;
      },
    };
    assert.deepEqual(
      await routeConversation([user("sushi?")], tools, service, "+12025550101"),
      transfer,
    );
    assertTransfer(
      chunks(
        buildSse(await routeConversation([user("sushi?")], tools, service)),
      ),
    );
    assert.deepEqual(
      await routeConversation([user("sushi?")], [], service, destination),
      transfer,
    );
    assert.deepEqual(
      await routeConversation([user("sushi?")], [], service),
      speak(TRANSFER_FAILURE),
    );
  }
  for (const values of [[], [destination, "+12025550101"], ["bad"]]) {
    const ambiguous = structuredClone(tools);
    ambiguous[0].function.parameters.properties.destination.enum = values;
    assert.deepEqual(
      await routeConversation(
        [user("human")],
        ambiguous,
        noLookup,
        destination,
      ),
      transfer,
    );
    assert.deepEqual(
      await routeConversation([user("human")], ambiguous, noLookup),
      speak(TRANSFER_FAILURE),
    );
  }
  assert.deepEqual(
    await routeConversation([user("coffee?")], tools, {
      lookup: async () => ({
        status: "clarification_required",
        text: "Which size?",
      }),
    }),
    speak("Which size?"),
  );
  const shape = JSON.stringify(transferToolShape(tools));
  assert.ok(shape.includes("destination"));
  assert.ok(!shape.includes(destination));
});

test("phone knowledge transcripts route to normal answers with spoken prices", async () => {
  const data = transformZukiData(await loadZukiData());
  for (const [turn, response, expected] of [
    [
      "How much is a cappuccino?",
      "A cappuccino is £3.55.",
      "A cappuccino is 3 pounds 55.",
    ],
    [
      "How much is the Turkish breakfast for two?",
      "The Turkish Breakfast Spread is £29.95 for 2 people.",
      "The Turkish Breakfast Spread is 29 pounds 95 for 2 people.",
    ],
    [
      "What time do you close on Sunday?",
      undefined,
      "On sunday, Zuki's closes at 4 PM.",
    ],
  ]) {
    const service = createKnowledgeSafeAssistantService(data, {
      claudeResponder: async () => {
        assert.notEqual(
          response,
          undefined,
          "opening hours should be answered locally",
        );
        return { text: response, model: "test", stopReason: "end_turn" };
      },
    });
    const action = await routeConversation([user(turn)], tools, service);
    assert.equal(action.kind, "speak", turn);
    assert.equal(action.text, expected, turn);
    assert.ok(!action.text.includes("£"), turn);
  }
});

test("generic fallbacks offer transfer again after an answer; consecutive fallbacks transfer directly", async () => {
  const service = createKnowledgeSafeAssistantService(
    transformZukiData(await loadZukiData()),
  );
  for (const turn of [
    "What is the wifi password?",
    "Blah flurb cappucheeno?",
  ]) {
    assert.deepEqual(
      await routeConversation([user(turn)], tools, service),
      speak(CLARIFY_OFFER),
      turn,
    );
  }
  for (const turn of [
    "Where are you and do you have sushi?",
    "Is the cappuccino available today?",
    "Can I speak to a human?",
  ]) {
    assert.deepEqual(
      await routeConversation([user(turn)], tools, service),
      transfer,
      turn,
    );
  }
  const unavailable = {
    lookup: async () => ({
      status: "unavailable",
      reason: "claude_response_ungrounded",
      text: "private",
    }),
  };
  assert.deepEqual(
    await routeConversation([user("How much is it?")], tools, unavailable),
    speak(CLARIFY_OFFER),
  );

  const offer = { role: "assistant", content: CLARIFY_OFFER };
  for (const yes of ["yes", "yes please", "okay", "sure thanks"]) {
    assert.deepEqual(
      await routeConversation(
        [user("wifi?"), offer, user(yes)],
        tools,
        noLookup,
      ),
      transfer,
      yes,
    );
  }
  for (const no of ["no", "no thanks", "Nah."]) {
    assert.deepEqual(
      await routeConversation(
        [user("wifi?"), offer, user(no)],
        tools,
        noLookup,
      ),
      speak(REPLIES.declined),
      no,
    );
  }
  const answered = {
    lookup: async () => ({
      status: "answered",
      text: "A cappuccino is £3.55.",
    }),
  };
  assert.deepEqual(
    await routeConversation(
      [
        user("How much is a capuchino?"),
        offer,
        user("How much is a cappuccino?"),
      ],
      tools,
      answered,
    ),
    speak("A cappuccino is 3 pounds 55."),
  );

  // An answered question allows a new offer; an immediate generic fallback still transfers.
  const history = [
    user("wifi?"),
    offer,
    user("How much is a cappuccino?"),
    { role: "assistant", content: "A cappuccino is 3 pounds 55." },
  ];
  assert.deepEqual(
    await routeConversation(
      [...history, user("What is the wifi password?")],
      tools,
      service,
    ),
    speak(CLARIFY_OFFER),
  );
  assert.deepEqual(
    await routeConversation(
      [
        user("wifi?"),
        { role: "assistant", content: `Hmm. ${CLARIFY_OFFER}` },
        user("Blah flurb?"),
      ],
      tools,
      service,
    ),
    transfer,
  );
});

test("offers are remembered per call even when Vapi rewrites spoken assistant turns", async () => {
  const service = createKnowledgeSafeAssistantService(
    transformZukiData(await loadZukiData()),
  );
  const memory = createOfferMemory();
  const system = { role: "system", content: "system prompt" };
  // Vapi returns a speech transcript of what the bot said, not the text we sent.
  const greeting = {
    role: "assistant",
    content: "Hold your breath The system. How can I help you?",
  };
  const heardOffer = {
    role: "assistant",
    content:
      "I'm sorry I'm not so. Would you like me to trans for you to someone from a tea?",
  };
  const start = [system, greeting, user("What is the wifi password?")];

  for (const [reply, expected] of [
    ["No thanks", speak(REPLIES.declined)],
    ["Nah.", speak(REPLIES.declined)],
    ["yes please", transfer],
  ]) {
    const offers = memory.forCall(`call-${reply}`);
    assert.deepEqual(
      await routeConversation(start, tools, service, undefined, offers),
      speak(CLARIFY_OFFER),
    );
    assert.deepEqual(
      await routeConversation(
        [...start, heardOffer, user(reply)],
        tools,
        service,
        undefined,
        offers,
      ),
      expected,
      reply,
    );
  }

  // Memory preserves the immediate transfer and allows a new offer after an answer.
  const offers = memory.forCall("call-second");
  await routeConversation(start, tools, service, undefined, offers);
  assert.deepEqual(
    await routeConversation(
      [...start, heardOffer, user("Do you have pineapple pizza?")],
      tools,
      service,
      undefined,
      offers,
    ),
    transfer,
  );
  const afterAnswer = [
    ...start,
    heardOffer,
    user("What time do you open on Sunday?"),
  ];
  assert.equal(
    (await routeConversation(afterAnswer, tools, service, undefined, offers))
      .kind,
    "speak",
  );
  const heardAnswer = {
    role: "assistant",
    content: "On Sunday, the cookies opens at 10 AM.",
  };
  assert.deepEqual(
    await routeConversation(
      [...afterAnswer, heardAnswer, user("Do you have pineapple pizza?")],
      tools,
      service,
      undefined,
      offers,
    ),
    speak(CLARIFY_OFFER),
  );

  // Another call starts fresh.
  assert.deepEqual(
    await routeConversation(
      start,
      tools,
      service,
      undefined,
      memory.forCall("call-other"),
    ),
    speak(CLARIFY_OFFER),
  );

  // A discarded speculative answer for the same user turn is replaced by the final one.
  const speculative = memory.forCall("call-speculative");
  assert.deepEqual(
    await routeConversation(
      [system, greeting, user("What is the")],
      tools,
      service,
      undefined,
      speculative,
    ),
    speak(CLARIFY_OFFER),
  );
  assert.equal(
    (
      await routeConversation(
        [system, greeting, user("What time do you open on Sunday?")],
        tools,
        service,
        undefined,
        speculative,
      )
    ).kind,
    "speak",
  );
  const next = [
    system,
    greeting,
    user("What time do you open on Sunday?"),
    heardAnswer,
    user("Do you have pineapple pizza?"),
  ];
  assert.deepEqual(
    await routeConversation(next, tools, service, undefined, speculative),
    speak(CLARIFY_OFFER),
  );
});

test("offer text fallback and memory expiry", async () => {
  let time = 0;
  const memory = createOfferMemory(1000, () => time);
  memory.forCall("old").record(1, "clarify");
  assert.equal(memory.forCall("old").at(1), "clarify");
  time = 5000;
  assert.equal(memory.forCall("old").at(1), undefined);
  memory.forCall("new").record(1, null);
  assert.equal(memory.forCall("old").at(1), undefined);

  // Without a call id, surviving keywords still identify the offer.
  for (const heard of [
    "I'm sorry, I'm not sure about that. Would you like me to transfer you?",
    "Sorry I can't make reservations would you like",
  ]) {
    assert.deepEqual(
      await routeConversation(
        [user("x"), { role: "assistant", content: heard }, user("no thanks")],
        tools,
        noLookup,
      ),
      speak(REPLIES.declined),
      heard,
    );
  }
  assert.deepEqual(
    await routeConversation(
      [
        { role: "assistant", content: "Hold your breath The system." },
        user("no thanks"),
      ],
      tools,
      noLookup,
    ),
    speak(REPLIES.goodbye),
  );
});

test("HTTP custom LLM keeps the transfer offer across requests of the same call", async () => {
  const service = createKnowledgeSafeAssistantService(
    transformZukiData(await loadZukiData()),
  );
  await withServer(service, async (url) => {
    const post = async (messages, call) =>
      (
        await (
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              tools,
              stream: false,
              ...(call === undefined ? {} : { call }),
            }),
          })
        ).json()
      ).choices[0].message.content;
    const start = [
      { role: "assistant", content: "Hello, you reached the Zucchini System." },
      user("What is the wifi password?"),
    ];
    const heardOffer = {
      role: "assistant",
      content: "Want to be boys to some one?",
    };
    assert.equal(
      await post(start, { id: "call-http", extra: true }),
      CLARIFY_OFFER,
    );
    assert.equal(
      await post([...start, heardOffer, user("No thanks")], {
        id: "call-http",
      }),
      REPLIES.declined,
    );
    assert.equal(
      await post([...start, heardOffer, user("No thanks")], { id: 42 }),
      REPLIES.goodbye,
    );
  });
});

test("HTTP concurrent corrections preserve the latest request's offer state", async () => {
  for (const [older, newer, expected] of [
    [
      { status: "unavailable" },
      { status: "answered", text: "A cappuccino is £3.55." },
      CLARIFY_OFFER,
    ],
    [
      { status: "answered", text: "A cappuccino is £3.55." },
      { status: "unavailable" },
      undefined,
    ],
  ]) {
    let release;
    let started;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const service = {
      lookup: async (query) => {
        if (query === "partial") {
          started();
          return pending;
        }
        return query === "corrected" ? newer : { status: "unavailable" };
      },
    };
    await withServer(service, async (url) => {
      const post = async (messages) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            tools,
            stream: false,
            call: { id: "concurrent-correction" },
          }),
        });
        assert.equal(response.status, 200);
        return (await response.json()).choices[0];
      };
      const stale = post([user("partial")]);
      await entered;
      const corrected = await post([user("corrected")]);
      release(older);
      await stale;
      const result = await post([
        user("corrected"),
        corrected.message,
        user("unknown"),
      ]);
      assert.equal(result.message.content, expected);
      assert.equal(
        result.finish_reason,
        expected === undefined ? "tool_calls" : "stop",
      );
      if (expected === undefined) {
        assert.equal(
          result.message.tool_calls[0].function.name,
          "transferCall",
        );
        assert.deepEqual(
          JSON.parse(result.message.tool_calls[0].function.arguments),
          { destination },
        );
      }
    });
  }
});

test("multi-turn offer lifecycle uses only the latest offer state", async () => {
  const service = {
    lookup: async (query) => {
      if (query.startsWith("unknown")) {
        return {
          status: "unavailable",
          reason: "claude_response_ungrounded",
        };
      }

      if (query === "What time do you open on Sunday?") {
        return {
          status: "answered",
          text: "On sunday, Zuki's opens at 10 AM.",
        };
      }

      if (query === "yes please") {
        return {
          status: "answered",
          text: "Lookup handled yes.",
        };
      }

      return {
        status: "answered",
        text: "Source-backed answer.",
      };
    },
  };

  const memory = createOfferMemory();
  const offers = memory.forCall("call-long-lifecycle");
  const system = {
    role: "system",
    content: "system prompt",
  };

  let history = [system, user("unknown one")];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak(CLARIFY_OFFER),
  );

  // Vapi may rewrite what the assistant actually said.
  history = [
    ...history,
    {
      role: "assistant",
      content: "garbled assistant speech one",
    },
    user("no thanks"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak(REPLIES.declined),
  );

  // A decline clears the previous offer state.
  history = [
    ...history,
    {
      role: "assistant",
      content: "okay no problem",
    },
    user("unknown two"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak(CLARIFY_OFFER),
  );

  // A real question after the offer is answered normally.
  history = [
    ...history,
    {
      role: "assistant",
      content: "garbled assistant speech two",
    },
    user("What time do you open on Sunday?"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak("On sunday, Zuki's opens at 10 AM."),
  );

  // "yes" must NOT act on a stale clarification after an answered turn.
  history = [
    ...history,
    {
      role: "assistant",
      content: "On Sunday the cookies opens at ten",
    },
    user("yes please"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak("Lookup handled yes."),
  );

  // After another ordinary answer, a new unknown gets a fresh offer.
  history = [
    ...history,
    {
      role: "assistant",
      content: "lookup handled yes",
    },
    user("unknown three"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    speak(CLARIFY_OFFER),
  );

  // But an immediate second unresolved turn after that offer escalates.
  history = [
    ...history,
    {
      role: "assistant",
      content: "another garbled assistant transcript",
    },
    user("unknown four"),
  ];

  assert.deepEqual(
    await routeConversation(history, tools, service, undefined, offers),
    transfer,
  );
});

test("HTTP duplicate retries are idempotent and call offer memory is isolated", async () => {
  const service = {
    lookup: async (query) => {
      if (query === "unknown") {
        return {
          status: "unavailable",
          reason: "claude_response_ungrounded",
        };
      }

      if (query === "yes please") {
        return {
          status: "answered",
          text: "Lookup handled yes.",
        };
      }

      return {
        status: "answered",
        text: "Source-backed answer.",
      };
    },
  };

  await withServer(service, async (url) => {
    const post = async (messages, callId) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          tools,
          stream: false,
          call: {
            id: callId,
          },
        }),
      });

      assert.equal(response.status, 200);

      return (await response.json()).choices[0];
    };

    const start = [user("unknown")];

    const first = await post(start, "call-retry-a");

    assert.equal(first.message.content, CLARIFY_OFFER);
    assert.equal(first.finish_reason, "stop");

    // Same request retried with the same call/user turn:
    // it must not advance the offer chain.
    const retry = await post(start, "call-retry-a");

    assert.equal(retry.message.content, CLARIFY_OFFER);
    assert.equal(retry.finish_reason, "stop");

    const rewrittenOffer = {
      role: "assistant",
      content: "garbled words only",
    };

    // Call A remembers that this rewritten speech was a clarify offer.
    const callA = await post(
      [...start, rewrittenOffer, user("yes please")],
      "call-retry-a",
    );

    assert.equal(callA.finish_reason, "tool_calls");
    assert.equal(callA.message.tool_calls[0].function.name, "transferCall");

    // Call B receives the identical transcript but MUST NOT inherit
    // Call A's hidden offer state.
    const callB = await post(
      [...start, rewrittenOffer, user("yes please")],
      "call-retry-b",
    );

    assert.equal(callB.finish_reason, "stop");
    assert.equal(callB.message.content, "Lookup handled yes.");
  });
});

test("HTTP JSON and SSE duplicate requests preserve equivalent offer state", async () => {
  const service = {
    lookup: async (query) => {
      if (query === "unknown") {
        return {
          status: "unavailable",
          reason: "claude_response_ungrounded",
        };
      }

      return {
        status: "answered",
        text: "Source-backed answer.",
      };
    },
  };

  await withServer(service, async (url) => {
    const start = [user("unknown")];

    const base = {
      messages: start,
      tools,
      call: {
        id: "call-json-sse-parity",
      },
    };

    // First delivery as normal JSON.
    const jsonResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...base,
        stream: false,
      }),
    });

    assert.equal(jsonResponse.status, 200);

    const jsonChoice = (await jsonResponse.json()).choices[0];

    assert.equal(jsonChoice.message.content, CLARIFY_OFFER);
    assert.equal(jsonChoice.finish_reason, "stop");

    // Same user turn retried in streaming mode.
    // It must produce the same offer, not escalate.
    const sseResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...base,
        stream: true,
      }),
    });

    assert.equal(sseResponse.status, 200);

    const retryParts = chunks(await sseResponse.text());

    assert.equal(retryParts[0].choices[0].delta.content, CLARIFY_OFFER);
    assert.equal(retryParts.at(-1).choices[0].finish_reason, "stop");

    // The next turn must still see exactly one active clarify offer.
    const transferResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          ...start,
          {
            role: "assistant",
            content: "garbled transcript",
          },
          user("yes"),
        ],
        tools,
        stream: true,
        call: {
          id: "call-json-sse-parity",
        },
      }),
    });

    assert.equal(transferResponse.status, 200);

    assertTransfer(chunks(await transferResponse.text()));
  });
});

test("HTTP realistic call transcript resets clarification after a real answer", async () => {
  let claudeCalls = 0;

  const service = createKnowledgeSafeAssistantService(
    transformZukiData(await loadZukiData()),
    {
      claudeResponder: async () => {
        claudeCalls += 1;

        return {
          text: "A cappuccino is \u00A33.55.",
          model: "test",
          stopReason: "end_turn",
        };
      },
    },
  );

  await withServer(service, async (url) => {
    const call = {
      id: "call-realistic-transcript",
    };

    const post = async (messages) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          tools,
          stream: false,
          call,
        }),
      });

      assert.equal(response.status, 200);

      return (await response.json()).choices[0];
    };

    let history = [user("How much is a cappuccino?")];

    const price = await post(history);

    assert.equal(price.finish_reason, "stop");

    assert.equal(price.message.content, "A cappuccino is 3 pounds 55.");

    // Simulate Vapi speech transcription rather
    // than feeding our exact text back.
    history = [
      ...history,
      {
        role: "assistant",
        content: "a cappuccino is three pounds fifty five",
      },
      user("What is the wifi password?"),
    ];

    const firstUnknown = await post(history);

    assert.equal(firstUnknown.message.content, CLARIFY_OFFER);

    history = [
      ...history,
      {
        role: "assistant",
        content: "garbled transfer offer transcript",
      },
      user("what time you close sunday"),
    ];

    const hours = await post(history);

    assert.equal(hours.message.content, "On sunday, Zuki's closes at 4 PM.");

    // The answered hours turn must clear the
    // previous clarification chain.
    history = [
      ...history,
      {
        role: "assistant",
        content: "on sunday zukis closes at four",
      },
      user("What is the wifi password?"),
    ];

    const secondUnknown = await post(history);

    assert.equal(secondUnknown.message.content, CLARIFY_OFFER);

    // Only the immediately consecutive
    // unresolved turn may escalate.
    history = [
      ...history,
      {
        role: "assistant",
        content: "garbled clarification transcript",
      },
      user("Blah flurb cappucheeno?"),
    ];

    const escalation = await post(history);

    assert.equal(escalation.finish_reason, "tool_calls");

    assert.equal(
      escalation.message.tool_calls[0].function.name,
      "transferCall",
    );

    // Only the actual menu-price turn needed Claude.
    assert.equal(claudeCalls, 1);
  });
});

test("HTTP three-way speculative corrections cannot overwrite the final state", async () => {
  let releaseA;
  let releaseB;
  let enteredA;
  let enteredB;

  const pendingA = new Promise((resolve) => {
    releaseA = resolve;
  });

  const pendingB = new Promise((resolve) => {
    releaseB = resolve;
  });

  const startedA = new Promise((resolve) => {
    enteredA = resolve;
  });

  const startedB = new Promise((resolve) => {
    enteredB = resolve;
  });

  const unavailable = {
    status: "unavailable",
    reason: "claude_response_ungrounded",
  };

  const service = {
    lookup: async (query) => {
      if (query === "stale-a") {
        enteredA();
        return pendingA;
      }

      if (query === "stale-b") {
        enteredB();
        return pendingB;
      }

      if (query === "final") {
        return {
          status: "answered",
          text: "Final answer.",
        };
      }

      return unavailable;
    },
  };

  await withServer(service, async (url) => {
    const post = async (messages) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          tools,
          stream: false,
          call: {
            id: "three-way-correction",
          },
        }),
      });

      assert.equal(response.status, 200);

      return (await response.json()).choices[0];
    };

    // Three versions of the SAME user turn.
    const staleA = post([user("stale-a")]);

    await startedA;

    const staleB = post([user("stale-b")]);

    await startedB;

    // Final transcript completes first.
    const final = await post([user("final")]);

    assert.equal(final.message.content, "Final answer.");

    // Now let older speculative requests finish
    // in reverse order after the final response.
    releaseB(unavailable);
    await staleB;

    releaseA(unavailable);
    await staleA;

    // If either stale request overwrote the final
    // state, this would transfer immediately.
    // Correct behavior is a NEW clarification.
    const next = await post([user("final"), final.message, user("unknown")]);

    assert.equal(next.finish_reason, "stop");

    assert.equal(next.message.content, CLARIFY_OFFER);
  });
});

test("HTTP completed user turns reset offers when assistant acknowledgements are omitted", async (t) => {
  t.mock.method(console, "info", () => {});
  let calls = 0;
  const service = createKnowledgeSafeAssistantService(
    transformZukiData(await loadZukiData()),
    {
      claudeResponder: async () => {
        calls += 1;
        return {
          text: "A cappuccino is £3.55.",
          model: "test",
          stopReason: "end_turn",
        };
      },
    },
  );
  await withServer(service, async (url) => {
    for (const stream of [false, true]) {
      const id = `missing-ack-${stream}`;
      const priceHistory = [user("How much is a cappuccino?")];
      const price = await postConversation(url, priceHistory, id, stream);
      assert.equal(price.message.content, "A cappuccino is 3 pounds 55.");
      const history = [
        ...priceHistory,
        { role: "assistant", content: "A cappuccino is three" },
        user("Blah flurb?"),
      ];
      const offer = await postConversation(url, history, id, stream);
      assert.equal(offer.message.content, CLARIFY_OFFER);
      const offered = [...history, offer.message];
      const decline = [...offered, user("No thanks.")];
      assert.equal(
        (await postConversation(url, decline, id, stream)).message.content,
        REPLIES.declined,
      );
      assert.equal(
        (await postConversation(url, decline, id, stream)).message.content,
        REPLIES.declined,
      );
      const next = [
        ...decline,
        user("Okay, thanks. Do you know the Wi-Fi password by any chance?"),
      ];
      const fresh = await postConversation(url, next, id, stream);
      assert.equal(fresh.finish_reason, "stop");
      assert.equal(fresh.message.tool_calls, undefined);
      assert.equal(fresh.message.content, CLARIFY_OFFER);
      assert.equal(
        (await postConversation(url, next, id, stream)).message.content,
        CLARIFY_OFFER,
      );
      assert.equal(
        (
          await postConversation(
            url,
            [...next, user("Blah flurb?")],
            id,
            stream,
          )
        ).finish_reason,
        "tool_calls",
      );

      const otherId = `other-${stream}`;
      assert.equal(
        (await postConversation(url, history, otherId, stream)).message.content,
        CLARIFY_OFFER,
      );
      assert.equal(
        (
          await postConversation(
            url,
            [...offered, user("Blah flurb?")],
            otherId,
            stream,
          )
        ).finish_reason,
        "tool_calls",
      );
      assert.equal(
        (
          await postConversation(
            url,
            [...offered, user("Yes please")],
            otherId,
            stream,
          )
        ).finish_reason,
        "tool_calls",
      );
      assert.equal(
        (
          await postConversation(
            url,
            [user("Blah flurb?")],
            `new-${stream}`,
            stream,
          )
        ).message.content,
        CLARIFY_OFFER,
      );

      const answerHistory = [
        ...offered,
        user("What time do you close on Sunday?"),
      ];
      assert.equal(
        (await postConversation(url, answerHistory, id, stream)).message
          .content,
        "On sunday, Zuki's closes at 4 PM.",
      );
      assert.equal(
        (
          await postConversation(
            url,
            [...answerHistory, user("What is the wifi password?")],
            id,
            stream,
          )
        ).message.content,
        CLARIFY_OFFER,
      );
    }
  });
  assert.equal(calls, 2);
});

test("HTTP rewritten offers stay cancelled across repeated declines and delayed acknowledgements", async (t) => {
  t.mock.method(console, "info", () => {});
  const service = { lookup: async () => ({ status: "unavailable" }) };
  await withServer(service, async (url) => {
    for (const [index, initial, reply, expectedOffer] of [
      [0, "unknown", "Nah.", CLARIFY_OFFER],
      [1, "Can I book a table?", "No thank you.", RESERVATION_OFFER],
    ]) {
      const id = `rewritten-decline-${index}`;
      const start = [user(initial)];
      assert.equal(
        (await postConversation(url, start, id)).message.content,
        expectedOffer,
      );
      const decline = [
        ...start,
        { role: "assistant", content: "garbled speech" },
        user(reply),
      ];
      assert.equal(
        (await postConversation(url, decline, id)).message.content,
        REPLIES.declined,
      );
      const repeated = [...decline, user("No thanks.")];
      const response = await postConversation(url, repeated, id);
      assert.equal(response.finish_reason, "stop");
      assert.equal(response.message.tool_calls, undefined);
      for (const acknowledgement of [
        [],
        [{ role: "assistant", content: CLARIFY_OFFER }],
      ]) {
        const next = await postConversation(
          url,
          [
            ...repeated,
            ...acknowledgement,
            user("Okay, thanks. Do you know the Wi-Fi password by any chance?"),
          ],
          id,
        );
        assert.equal(next.finish_reason, "stop");
        assert.equal(next.message.tool_calls, undefined);
        assert.equal(next.message.content, CLARIFY_OFFER);
      }
    }
  });
});

test("HTTP declines with new questions cancel old offers without swallowing the question", async (t) => {
  t.mock.method(console, "info", () => {});
  const seen = [];
  const service = {
    lookup: async (query) => {
      seen.push(query);
      if (query.includes("cappuccino"))
        return { status: "answered", text: "A cappuccino is £3.55." };
      if (query.includes("sushi"))
        return {
          status: "transfer_required",
          reason:
            "The request cannot be verified from current menu information.",
        };
      return { status: "unavailable" };
    },
  };
  await withServer(service, async (url) => {
    for (const [index, query] of [
      "No thanks, but do you know the Wi-Fi password?",
      "No, what is the Wi-Fi password?",
      "No thanks, but how much is a cappuccino?",
      "Do you know whether the Wi-Fi password is yes or no?",
      "Yes, but how much is a cappuccino?",
      "No thanks, but will you have sushi?",
    ].entries()) {
      const id = `compound-${index}`;
      const start = [user("unknown")];
      const offer = await postConversation(url, start, id);
      const result = await postConversation(
        url,
        [...start, offer.message, user(query)],
        id,
      );
      assert.equal(seen.at(-1), query);
      if (query.includes("cappuccino"))
        assert.equal(result.message.content, "A cappuccino is 3 pounds 55.");
      else if (query.startsWith("No") && !query.includes("sushi")) {
        assert.equal(result.finish_reason, "stop");
        assert.equal(result.message.tool_calls, undefined);
        assert.equal(result.message.content, CLARIFY_OFFER);
      } else assert.equal(result.finish_reason, "tool_calls");
    }
  });
});

test("HTTP stale requests cannot restore offers after an omitted decline acknowledgement", async (t) => {
  t.mock.method(console, "info", () => {});
  for (const sameTurn of [false, true]) {
    let release;
    let entered;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const service = {
      lookup: async (query) => {
        if (query === "partial") {
          entered();
          return pending;
        }
        return { status: "unavailable" };
      },
    };
    await withServer(service, async (url) => {
      const id = `stale-decline-${sameTurn}`;
      const start = [user("unknown")];
      const offer = await postConversation(url, start, id);
      const offered = [...start, offer.message];
      const stale = postConversation(
        url,
        sameTurn ? [...offered, user("partial")] : [user("partial")],
        id,
      );
      await started;
      const decline = [...offered, user("No thanks.")];
      try {
        assert.equal(
          (await postConversation(url, decline, id)).message.content,
          REPLIES.declined,
        );
      } finally {
        release({ status: "clarification_required", text: CLARIFY_OFFER });
        await stale;
      }
      const result = await postConversation(
        url,
        [
          ...decline,
          user("Okay, thanks. Do you know the Wi-Fi password by any chance?"),
        ],
        id,
      );
      assert.equal(result.finish_reason, "stop");
      assert.equal(result.message.tool_calls, undefined);
      assert.equal(result.message.content, CLARIFY_OFFER);
    });
  }
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
  const server = await new Promise((resolve) => {
    const s = createApiServer(service).listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(
      `http://127.0.0.1:${server.address().port}/api/vapi/chat/completions`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postConversation(url, messages, callId, stream = false) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools, stream, call: { id: callId } }),
  });
  assert.equal(response.status, 200);
  let choice;
  if (stream) {
    const parts = chunks(await response.text());
    choice = {
      message: parts[0].choices[0].delta,
      finish_reason: parts.at(-1).choices[0].finish_reason,
    };
    if (choice.finish_reason === "tool_calls") assertTransfer(parts);
  } else choice = (await response.json()).choices[0];
  assert.equal(choice.message.role, "assistant");
  if (choice.finish_reason === "tool_calls") {
    assert.equal(choice.message.content, undefined);
    assert.equal(choice.message.tool_calls[0].function.name, "transferCall");
    assert.deepEqual(
      JSON.parse(choice.message.tool_calls[0].function.arguments),
      { destination },
    );
  }
  return choice;
}

test("HTTP custom LLM preserves combined query, streams transfers and speaks prices/clarification", async () => {
  const seen = [];
  const combined = "Where are you and do you have sushi?";
  await withServer(
    {
      lookup: async (query) => {
        seen.push(query);
        if (query === combined)
          return { status: "transfer_required", text: "must not speak" };
        if (query === "coffee?")
          return { status: "clarification_required", text: "Which size?" };
        return { status: "answered", text: "3.55? No, £3.55." };
      },
    },
    async (url) => {
      const post = (body) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      const response = await post({
        messages: [user(combined)],
        tools,
        stream: true,
        call: { id: "extra" },
        metadata: {},
        temperature: 0,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^text\/event-stream/);
      assertTransfer(chunks(await response.text()));
      assert.deepEqual(seen, [combined]);
      for (const stream of [true, false]) {
        for (const [turn, expected] of [
          ["How much is a cappuccino?", "3.55? No, 3 pounds 55."],
          ["coffee?", "Which size?"],
        ]) {
          const response = await post({
            messages: [user([{ type: "text", text: turn }])],
            stream,
          });
          const text = stream
            ? chunks(await response.text())[0].choices[0].delta.content
            : (await response.json()).choices[0].message.content;
          assert.equal(text, expected);
          assert.ok(!text.includes("£"));
        }
      }
      const silent = await post({
        messages: [{ role: "tool", content: "done" }],
        stream: false,
      });
      assert.deepEqual((await silent.json()).choices[0], {
        index: 0,
        message: { role: "assistant" },
        finish_reason: "stop",
      });
    },
  );
});

test("HTTP lookup exceptions still return SSE or JSON with env fallback or failure sentence", async (t) => {
  t.mock.method(console, "info", () => {});
  const old = process.env.ZUKI_TEST_TRANSFER_NUMBER;
  try {
    await withServer(
      {
        lookup: async () => {
          throw Error("private");
        },
      },
      async (url) => {
        for (const fallback of [destination, undefined]) {
          if (fallback) process.env.ZUKI_TEST_TRANSFER_NUMBER = fallback;
          else delete process.env.ZUKI_TEST_TRANSFER_NUMBER;
          for (const stream of [true, false]) {
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: [user("sushi?")], stream }),
            });
            assert.equal(response.status, 200);
            if (stream) {
              const parts = chunks(await response.text());
              if (fallback) assertTransfer(parts);
              else
                assert.equal(
                  parts[0].choices[0].delta.content,
                  TRANSFER_FAILURE,
                );
            } else {
              const completion = await response.json();
              assert.equal(completion.object, "chat.completion");
              assert.equal(
                completion.choices[0].finish_reason,
                fallback ? "tool_calls" : "stop",
              );
            }
          }
        }
      },
    );
  } finally {
    if (old === undefined) delete process.env.ZUKI_TEST_TRANSFER_NUMBER;
    else process.env.ZUKI_TEST_TRANSFER_NUMBER = old;
  }
});

test("HTTP validation retains JSON error conventions and 100kb body limit", async () => {
  await withServer(noLookup, async (url) => {
    for (const [body, status] of [
      ["{", 400],
      ["{}", 400],
      [JSON.stringify({ messages: [{ role: "user", content: 5 }] }), 400],
      [JSON.stringify({ messages: [], padding: "x".repeat(103000) }), 413],
    ]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, "string");
    }
  });
});

test("internal route errors return a valid transfer and schema logging occurs once", async (t) => {
  const info = t.mock.method(console, "info", () => {
    throw Error("internal logger error");
  });
  await withServer(noLookup, async (url) => {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [user("human")],
          tools,
          stream: true,
          call: { id: "call-1" },
        }),
      });
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
