import assert from "node:assert/strict";
import test from "node:test";

import {
  createKnowledgeSafeAssistantService,
} from "../dist/assistant/knowledge-safe-service.js";

import {
  loadZukiData,
} from "../dist/data/loader.js";

import {
  transformZukiData,
} from "../dist/data/transformer.js";

const sourceData =
  await loadZukiData();

const normalizedData =
  transformZukiData(sourceData);

test(
  "STEP3 safety: unknown business question requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Do you have a rooftop terrace?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unknown menu item requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Do you sell unicorn soup?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: ambiguous menu item never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Affogato",
      );

    assert.equal(
      result.status,
      "clarification_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: matched menu item can reach Claude with only selected context",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              claudeCalls += 1;

              assert.equal(
                context.item.name,
                "Espresso / Doppio",
              );

              assert.equal(
                JSON.stringify(context)
                  .includes("Affogato"),
                false,
              );

              return {
                text: "The Doppio is £2.75.",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    assert.equal(
      claudeCalls,
      1,
    );
  },
);

test(
  "STEP3 safety: missing business fact requires transfer instead of guessing",
  async () => {
    let claudeCalls = 0;

    const dataWithoutBusinessFacts =
      structuredClone(normalizedData);

    delete dataWithoutBusinessFacts
      .business_facts;

    const service =
      createKnowledgeSafeAssistantService(
        dataWithoutBusinessFacts,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Can I bring my dog?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: reservation request is unsupported and requires transfer",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Can I reserve a table for two tonight?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unverified business fact requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const unverifiedData =
      structuredClone(normalizedData);

    unverifiedData.business_facts.dog_policy =
      "Dogs can use the kitchen.";

    unverifiedData.business_facts.provenance.dog_policy.status =
      "unverified";

    const service =
      createKnowledgeSafeAssistantService(
        unverifiedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Can I bring my dog?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );

    assert.equal(
      result.text.includes(
        "Dogs can use the kitchen.",
      ),
      false,
    );
  },
);

test(
  "STEP3 safety: verified parking information is answered locally without Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Is there parking nearby?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    assert.equal(
      result.text,
      "Nearby public parking is available at Exeter Central Station (APCOA).",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: verified card payment information is answered locally without Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Can I pay by card?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    assert.equal(
      result.text,
      "Card payments are accepted.",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unverified contactless payment support requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Do you accept contactless payments?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      result.reason,
      "Contactless payment support is not verified in the current source data.",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unsupported specific dog policy requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Are dogs allowed in the kitchen?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unsupported own-parking claim requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Do you have your own car park?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unsupported minimum card spend requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Is there a minimum card spend?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: parking payment multi-intent requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Can I pay for parking by card?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: near-match must not fall through to a shorter menu item",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Turkish breakfest",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: unsupported Turkish breakfast price inference requires transfer and never calls Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const queries = [
      "How much is the Turkish breakfast for one person?",
      "How much is the Turkish breakfast for three people?",
      "Can five people share the Turkish breakfast?",
      "What is the Turkish breakfast price per person?",
      "Can I get half a Turkish breakfast?",
    ];

    for (const query of queries) {
      const result =
        await service.lookup(query);

      assert.equal(
        result.status,
        "transfer_required",
        query,
      );
    }

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: vegan dietary qualifiers require transfer and never call Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text: "Unexpected Claude call",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const queries = [
      "Is your vegan food allergy-safe?",
      "Do you have vegan gluten-free food?",
      "Do your vegan dishes contain soy?",
    ];

    for (const query of queries) {
      const result =
        await service.lookup(query);

      assert.equal(
        result.status,
        "transfer_required",
        query,
      );
    }

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: Claude failure becomes unavailable without leaking the error",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              throw new Error(
                "simulated-secret-error",
              );
            },
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    assert.equal(
      result.source,
      "local",
    );

    assert.equal(
      result.reason,
      "claude_request_failed",
    );

    assert.equal(
      JSON.stringify(result).includes(
        "simulated-secret-error",
      ),
      false,
    );
  },
);

test(
  "STEP3 safety: concurrent lookups keep menu contexts isolated",
  async () => {
    const captured = [];

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              captured.push({
                query:
                  context.query.raw,
                item:
                  context.item.name,
                snapshot:
                  JSON.stringify(context),
              });

              await new Promise(
                (resolve) =>
                  setTimeout(
                    resolve,
                    context.item.name ===
                      "Espresso / Doppio"
                      ? 40
                      : 5,
                  ),
              );

              return {
                text:
                  `Answer for ${context.item.name}`,
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const [
      doppioResult,
      americanoResult,
    ] = await Promise.all([
      service.lookup(
        "How much is a Doppio?",
      ),
      service.lookup(
        "How much is an Iced Americano?",
      ),
    ]);

    assert.equal(
      doppioResult.status,
      "answered",
    );

    assert.equal(
      americanoResult.status,
      "answered",
    );

    assert.equal(
      doppioResult.item.itemName,
      "Espresso / Doppio",
    );

    assert.equal(
      americanoResult.item.itemName,
      "Iced Americano",
    );

    const doppioCapture =
      captured.find(
        (entry) =>
          entry.query ===
            "How much is a Doppio?",
      );

    const americanoCapture =
      captured.find(
        (entry) =>
          entry.query ===
            "How much is an Iced Americano?",
      );

    assert.ok(doppioCapture);
    assert.ok(americanoCapture);

    assert.equal(
      doppioCapture.snapshot.includes(
        '"name":"Iced Americano"',
      ),
      false,
    );

    assert.equal(
      americanoCapture.snapshot.includes(
        '"name":"Espresso / Doppio"',
      ),
      false,
    );
  },
);

test(
  "STEP3 safety: adversarial string inputs never crash and keep valid public statuses",
  async () => {
    const allowedStatuses =
      new Set([
        "answered",
        "transfer_required",
        "clarification_required",
        "unavailable",
      ]);

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => ({
              text:
                context.item.name,
              model: "fake-model",
              stopReason: "end_turn",
            }),
        },
      );

    const cases = [
      {
        query: "",
        expected: "transfer_required",
      },
      {
        query: "   \t   ",
        expected: "transfer_required",
      },
      {
        query: "!!!???...",
        expected: "transfer_required",
      },
      {
        query:
          String.fromCodePoint(
            0x2615,
            0xfe0f,
            0x1f950,
            0x1f373,
          ),
        expected: "transfer_required",
      },
      {
        query: "How much\u2019s a Doppio?",
        expected: "answered",
      },
      {
        query: "How     much     is     a Doppio?",
        expected: "answered",
      },
      {
        query: "DOPPIO!!!",
        expected: "answered",
      },
      {
        query: "x".repeat(20000),
        expected: "transfer_required",
      },
    ];

    for (const entry of cases) {
      const result =
        await service.lookup(
          entry.query,
        );

      assert.ok(
        allowedStatuses.has(
          result.status,
        ),
      );

      assert.equal(
        result.status,
        entry.expected,
      );
    }
  },
);

test(
  "STEP3 safety: unsupported Claude price claim is never returned",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => ({
              text:
                "The Doppio is \u00A31.00.",
              model: "fake-model",
              stopReason: "end_turn",
            }),
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    assert.equal(
      JSON.stringify(result).includes(
        "1.00",
      ),
      false,
    );
  },
);

test(
  "STEP3 safety: source-backed Claude price claim remains answerable",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              const option =
                context.item.pricing.options.find(
                  (entry) =>
                    entry.qualifiers.variant ===
                    "Doppio",
                );

              assert.notEqual(
                option,
                undefined,
              );

              return {
                text:
                  `GBP ${option.amount.toFixed(2)}`,
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    assert.equal(
      result.source,
      "claude",
    );
  },
);

test(
  "STEP3 safety: grounded price does not excuse an unsupported Claude fact",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              const option =
                context.item.pricing.options.find(
                  (entry) =>
                    entry.qualifiers.variant ===
                    "Doppio",
                );

              assert.notEqual(
                option,
                undefined,
              );

              return {
                text:
                  `GBP ${option.amount.toFixed(2)}. Sushi is also available.`,
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    assert.equal(
      JSON.stringify(result)
        .toLowerCase()
        .includes("sushi"),
      false,
    );
  },
);

test(
  "STEP3 safety: public result serialization excludes internal context and prompt data",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => ({
              text:
                context.item.name,
              model: "fake-model",
              stopReason: "end_turn",
            }),
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    const serialized =
      JSON.stringify(result);

    const forbidden = [
      "raw_price_text",
      "source_path",
      "raw_text",
      "SOURCE-BACKED CONTEXT",
      "CUSTOMER QUERY:",
      "ANTHROPIC_API_KEY",
      "business_facts",
      "menu_service",
    ];

    for (const value of forbidden) {
      assert.equal(
        serialized.includes(value),
        false,
        value,
      );
    }
  },
);

test(
  "STEP3 safety: product-specific vegan query must not collapse to generic vegan answer",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              claudeCalls += 1;

              return {
                text:
                  context.item.name,
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "Do you have a vegan Turkish breakfast?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);


test(
  "STEP3 safety: unsupported quantity boundaries never reach Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              claudeCalls += 1;

              return {
                text:
                  context.item.name,
                model:
                  "fake-model",
                stopReason:
                  "end_turn",
              };
            },
        },
      );

    const queries = [
      "How much is the Turkish Breakfast for 21 people?",
      "How much is the Turkish Breakfast for 100 people?",
      "How much is the Turkish Breakfast for eleven people?",
    ];

    for (const query of queries) {
      const result =
        await service.lookup(query);

      assert.equal(
        result.status,
        "transfer_required",
        query,
      );
    }

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 safety: business intent detection uses whole words instead of substrings",
  async () => {
    let claudeCalls = 0;

    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              claudeCalls += 1;

              return {
                text:
                  context.item.name,
                model:
                  "fake-model",
                stopReason:
                  "end_turn",
              };
            },
        },
      );

    const cases = [
      {
        query:
          "Do you serve hotdogs?",
        forbiddenText:
          "Dogs are allowed.",
      },
      {
        query:
          "Do you have cardamom?",
        forbiddenText:
          "Card payments are accepted.",
      },
    ];

    for (const entry of cases) {
      const result =
        await service.lookup(
          entry.query,
        );

      assert.equal(
        result.status,
        "transfer_required",
        entry.query,
      );

      assert.equal(
        result.text.includes(
          entry.forbiddenText,
        ),
        false,
        entry.query,
      );
    }

    assert.equal(
      claudeCalls,
      0,
    );
  },
);


test(
  "STEP3 safety: section extra price cannot validate as the matched item price",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => ({
              text:
                "GBP 0.30",
              model:
                "fake-model",
              stopReason:
                "end_turn",
            }),
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    assert.equal(
      JSON.stringify(result).includes(
        "0.30",
      ),
      false,
    );
  },
);


test(
  "STEP3 safety: sibling variant price cannot validate for the requested variant",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => ({
              text:
                "GBP 2.45",
              model:
                "fake-model",
              stopReason:
                "end_turn",
            }),
        },
      );

    const result =
      await service.lookup(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    assert.equal(
      JSON.stringify(result).includes(
        "2.45",
      ),
      false,
    );
  },
);


test(
  "STEP3 safety: explicitly requested section surcharge remains grounded",
  async () => {
    const service =
      createKnowledgeSafeAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => ({
              text:
                "GBP 0.60",
              model:
                "fake-model",
              stopReason:
                "end_turn",
            }),
        },
      );

    const result =
      await service.lookup(
        "How much extra is an extra shot with a Doppio?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    assert.equal(
      result.text,
      "GBP 0.60",
    );
  },
);


test(
  "STEP3 safety: alternate monetary formats cannot bypass price grounding",
  async () => {
    const answers = [
      "The Doppio costs 2.45.",
      "The Doppio costs 60p.",
    ];

    for (const answer of answers) {
      const service =
        createKnowledgeSafeAssistantService(
          normalizedData,
          {
            claudeResponder:
              async () => ({
                text:
                  answer,
                model:
                  "fake-model",
                stopReason:
                  "end_turn",
              }),
          },
        );

      const result =
        await service.lookup(
          "How much is a Doppio?",
        );

      assert.equal(
        result.status,
        "unavailable",
        answer,
      );

      assert.equal(
        result.text.includes(
          answer,
        ),
        false,
        answer,
      );
    }
  },
);
