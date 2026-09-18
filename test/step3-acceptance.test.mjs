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
  "STEP3 acceptance: Sunday closing time is answered from verified local data",
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
        "What time do you close on Sunday?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    if (result.status !== "answered") {
      return;
    }

    assert.equal(
      result.source,
      "local",
    );

    assert.equal(
      result.topic,
      "opening_hours",
    );

    assert.match(
      result.text,
      /4 PM/,
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 acceptance: Turkish breakfast uses the verified spread item and both prices",
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
                "Turkish Breakfast Spread",
              );

              assert.equal(
                context.item.rawPriceText,
                "for 2 £29.95 / for 4 £52.95",
              );

              return {
                text:
                  "The Turkish Breakfast Spread is £29.95 for 2 or £52.95 for 4.",
                model: "fake-model",
                stopReason: "end_turn",
              };
            },
        },
      );

    const result =
      await service.lookup(
        "How much is the Turkish breakfast?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    if (result.status !== "answered") {
      return;
    }

    assert.equal(
      result.text,
      "The Turkish Breakfast Spread is £29.95 for 2 or £52.95 for 4.",
    );

    assert.equal(
      result.item.itemName,
      "Turkish Breakfast Spread",
    );

    assert.equal(
      claudeCalls,
      1,
    );
  },
);

test(
  "STEP3 acceptance: vegan options are answered only from verified menu data",
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
        "Do you have anything vegan?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    if (result.status !== "answered") {
      return;
    }

    assert.equal(
      result.source,
      "local",
    );

    assert.equal(
      result.topic,
      "vegan",
    );

    assert.match(
      result.text,
      /Vegan Breakfast/,
    );

    assert.match(
      result.text,
      /Vegan Bap/,
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 acceptance: dog policy is answered from verified business data",
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
        "Can I bring my dog?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    if (result.status !== "answered") {
      return;
    }

    assert.equal(
      result.source,
      "local",
    );

    assert.equal(
      result.topic,
      "dog",
    );

    assert.equal(
      result.text,
      "Dogs are allowed.",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "STEP3 acceptance: sushi is not invented and requires transfer",
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
        "Do you do sushi?",
      );

    assert.equal(
      result.status,
      "transfer_required",
    );

    if (
      result.status !==
      "transfer_required"
    ) {
      return;
    }

    assert.match(
      result.text,
      /transfer/i,
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);
