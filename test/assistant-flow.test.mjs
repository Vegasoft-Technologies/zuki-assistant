import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssistantService,
} from "../dist/assistant/service.js";

import {
  buildMenuContext,
} from "../dist/context/builder.js";

import {
  loadZukiData,
} from "../dist/data/loader.js";

import {
  transformZukiData,
} from "../dist/data/transformer.js";

import {
  createMenuMatcher,
} from "../dist/matching/matcher.js";

const sourceData =
  await loadZukiData();

const normalizedData =
  transformZukiData(sourceData);

const match =
  createMenuMatcher(normalizedData);

test(
  "Doppio is matched from a natural-language query",
  () => {
    const result =
      match(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "matched",
    );

    if (
      result.status !== "matched"
    ) {
      return;
    }

    assert.equal(
      result.candidate.itemName,
      "Espresso / Doppio",
    );

    assert.equal(
      result.candidate.section,
      "Caffetteria",
    );

    assert.equal(
      result.candidate.matchedPhrase,
      "Doppio",
    );
  },
);

test(
  "Iced Americano wins over the shorter Americano match",
  () => {
    const result =
      match(
        "How much is an Iced Americano?",
      );

    assert.equal(
      result.status,
      "matched",
    );

    if (
      result.status !== "matched"
    ) {
      return;
    }

    assert.equal(
      result.candidate.itemName,
      "Iced Americano",
    );

    assert.equal(
      result.candidate.section,
      "Iced drinks",
    );
  },
);

test(
  "duplicate Affogato remains ambiguous",
  () => {
    const result =
      match("Affogato");

    assert.equal(
      result.status,
      "ambiguous",
    );

    if (
      result.status !== "ambiguous"
    ) {
      return;
    }

    assert.deepEqual(
      result.candidates.map(
        (candidate) => ({
          name:
            candidate.itemName,
          section:
            candidate.section,
        }),
      ),
      [
        {
          name: "Affogato",
          section:
            "Italian favourites",
        },
        {
          name: "Affogato",
          section: "Sundaes",
        },
      ],
    );
  },
);

test(
  "explicit section hint resolves Affogato ambiguity",
  () => {
    const result =
      match(
        "Affogato",
        {
          sectionHint:
            "Sundaes",
        },
      );

    assert.equal(
      result.status,
      "matched",
    );

    if (
      result.status !== "matched"
    ) {
      return;
    }

    assert.equal(
      result.candidate.itemName,
      "Affogato",
    );

    assert.equal(
      result.candidate.section,
      "Sundaes",
    );

    assert.equal(
      result.sectionContextSource,
      "explicit",
    );
  },
);

test(
  "unknown query is blocked before language-model context",
  () => {
    const matchResult =
      match(
        "Do you sell unicorn soup?",
      );

    assert.equal(
      matchResult.status,
      "unknown",
    );

    const contextResult =
      buildMenuContext(
        normalizedData,
        matchResult,
      );

    assert.equal(
      contextResult.status,
      "blocked",
    );

    if (
      contextResult.status !==
      "blocked"
    ) {
      return;
    }

    assert.equal(
      contextResult.reason,
      "unknown",
    );

    assert.deepEqual(
      contextResult.candidates,
      [],
    );
  },
);

test(
  "ambiguous query is blocked before language-model context",
  () => {
    const contextResult =
      buildMenuContext(
        normalizedData,
        match("Affogato"),
      );

    assert.equal(
      contextResult.status,
      "blocked",
    );

    if (
      contextResult.status !==
      "blocked"
    ) {
      return;
    }

    assert.equal(
      contextResult.reason,
      "ambiguous",
    );

    assert.equal(
      contextResult.candidates.length,
      2,
    );
  },
);

test(
  "matched context contains only the selected menu item",
  () => {
    const contextResult =
      buildMenuContext(
        normalizedData,
        match(
          "How much is a Doppio?",
        ),
      );

    assert.equal(
      contextResult.status,
      "ready",
    );

    if (
      contextResult.status !==
      "ready"
    ) {
      return;
    }

    assert.equal(
      contextResult.context
        .item.name,
      "Espresso / Doppio",
    );

    assert.equal(
      contextResult.context
        .section.name,
      "Caffetteria",
    );

    assert.equal(
      contextResult.context
        .item.rawPriceText,
      "£2.45 / £2.75",
    );

    assert.equal(
      JSON.stringify(
        contextResult.context,
      ).includes("Affogato"),
      false,
    );
  },
);

test(
  "unknown and ambiguous queries never call Claude",
  async () => {
    let claudeCalls = 0;

    const service =
      createAssistantService(
        normalizedData,
        {
          claudeResponder:
            async () => {
              claudeCalls += 1;

              return {
                text:
                  "Unexpected call",
                model:
                  "fake-model",
                stopReason:
                  "end_turn",
              };
            },
        },
      );

    const unknown =
      await service.ask(
        "Do you sell unicorn soup?",
      );

    const ambiguous =
      await service.ask(
        "Affogato",
      );

    assert.equal(
      unknown.status,
      "not_found",
    );

    assert.equal(
      ambiguous.status,
      "clarification_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );
  },
);

test(
  "matched item without Claude configuration fails safely",
  async () => {
    const service =
      createAssistantService(
        normalizedData,
      );

    const result =
      await service.ask(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "unavailable",
    );

    if (
      result.status !==
      "unavailable"
    ) {
      return;
    }

    assert.equal(
      result.reason,
      "claude_not_configured",
    );

    assert.equal(
      result.item.itemName,
      "Espresso / Doppio",
    );
  },
);

test(
  "matched item can be answered through a fake Claude responder",
  async () => {
    let claudeCalls = 0;

    const service =
      createAssistantService(
        normalizedData,
        {
          claudeResponder:
            async (context) => {
              claudeCalls += 1;

              assert.equal(
                context.item.name,
                "Espresso / Doppio",
              );

              return {
                text:
                  "The Doppio is £2.75.",
                model:
                  "fake-model",
                stopReason:
                  "end_turn",
              };
            },
        },
      );

    const result =
      await service.ask(
        "How much is a Doppio?",
      );

    assert.equal(
      result.status,
      "answered",
    );

    if (
      result.status !==
      "answered"
    ) {
      return;
    }

    assert.equal(
      result.text,
      "The Doppio is £2.75.",
    );

    assert.equal(
      result.item.itemName,
      "Espresso / Doppio",
    );

    assert.equal(
      result.model,
      "fake-model",
    );

    assert.equal(
      claudeCalls,
      1,
    );
  },
);
test(
  "multi-word unknown product query is not split into separate menu items",
  () => {
    const result =
      match(
        "DondurmalÄ± helva ne kadar?",
      );

    assert.equal(
      result.status,
      "unknown",
    );
  },
);


test(
  "independent product matches remain ambiguous instead of choosing one by length",
  () => {
    const result =
      match(
        "Americano cheesecake combo",
      );

    assert.equal(
      result.status,
      "ambiguous",
    );

    if (
      result.status !== "ambiguous"
    ) {
      return;
    }

    assert.deepEqual(
      new Set(
        result.candidates.map(
          (candidate) =>
            candidate.itemName,
        ),
      ),
      new Set([
        "Americano",
        "Cheesecake",
      ]),
    );
  },
);

test(
  "unknown surrounding words do not block a single valid product phrase",
  () => {
    const result =
      match(
        "Doppio smoothie sandwich",
      );

    assert.equal(
      result.status,
      "matched",
    );

    if (
      result.status !== "matched"
    ) {
      return;
    }

    assert.equal(
      result.candidate.itemName,
      "Espresso / Doppio",
    );
  },
);
