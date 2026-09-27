import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssistantService,
} from "../dist/assistant/service.js";

import {
  createKnowledgeSafeAssistantService,
} from "../dist/assistant/knowledge-safe-service.js";

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

import {
  buildSourceNameProfile,
  normalizeMatchText,
} from "../dist/matching/normalize.js";

const sourceData =
  await loadZukiData();

const normalizedData =
  transformZukiData(sourceData);

const match =
  createMenuMatcher(normalizedData);

test(
  "bounded speech fillers preserve missing double letter query forms",
  async () => {
    const queries = [
      "uh do you guys have cappucino please",
      "um do you guys have cappucino please",
      "hey do you guys have cappucino",
      "sorry do you guys have cappucino",
      "uh do you serve cappucino",
      "um how much is a cappucino",
      "uh how much is a capuccino please",
      "do you guys have cappucino?",
      "do you guys have capuccino?",
      "How much is a cappucino?",
      "How much is a capuccino?",
    ];
    const failures = [];

    for (const query of queries) {
      let calls = 0;
      const service = createKnowledgeSafeAssistantService(normalizedData, {
        claudeResponder: async () => {
          calls += 1;
          return {
            text: "The Cappuccino is \u00a33.55.",
            model: "fake-model",
            stopReason: "end_turn",
          };
        },
      });
      const matched = match(query);
      const result = await service.lookup(query);

      if (
        matched.status !== "matched" ||
        matched.candidate.itemName !== "Cappuccino" ||
        result.status !== "answered" ||
        calls !== 1
      ) {
        failures.push({ query, match: matched.status, status: result.status, calls });
      }
      assert.equal(matched.normalizedQuery, normalizeMatchText(query));
    }
    assert.deepEqual(failures, []);
  },
);

test(
  "speech fillers do not broaden typo edits products or ambiguity",
  () => {
    for (const filler of ["uh", "um", "hey", "sorry"]) {
      for (const product of [
        "late", "eg", "sushi", "unicorn soup", "cappaccino", "capucino",
        "cappucccino", "cappucicno", "cappuccin", "cappucino sushi",
        "iced cappucino", "cappucino lobster", "Turkish breakfest",
      ]) {
        const query = `${filler} do you guys have ${product} please`;
        assert.equal(match(query).status, "unknown", query);
      }

      const query = `${filler} do you have afogato please`;
      const expected = match("afogato");
      const result = match(query, { sectionHint: "Sundaes" });

      assert.equal(result.status, "ambiguous", query);
      assert.deepEqual(
        result.candidates.map((candidate) => candidate.itemId),
        expected.candidates.map((candidate) => candidate.itemId),
      );
    }

    for (const query of [
      "uh um do you have cappucino please",
      "well do you have cappucino please",
      "do you uh have cappucino please",
      "uh do you have cappucino please please",
      "uh cappucino please",
    ]) {
      assert.equal(match(query).status, "unknown", query);
    }

    const exact = match("uh do you have cappucino and Latte please");
    assert.equal(exact.status, "matched");
    assert.equal(exact.candidate.itemName, "Latte");
  },
);

test(
  "spelling and speech variants follow exact and bounded fallback rules",
  () => {
    const accepted = [
      "cappuccino", "cappucino", "capuccino", "CAPPUCCINO", "Cappuccino!!!",
      "  cappuccino  ", "cappuccino cappuccino", "uh cappuccino please",
      "do you guys have cappucino", "how much is cappucino",
      "noise cappuccino noise", "cappu'ccino", "cappu\u2019ccino",
      "\uFF43\uFF41\uFF50\uFF50\uFF55\uFF43\uFF43\uFF49\uFF4E\uFF4F",
      "cappuccin\u006F\u0301", "\u201CCappuccino\u201D",
    ];
    const rejected = [
      "cappaccino", "cappuchino", "capucino", "cappuccinooo", "cappu ccino",
      "cappu-cino", "uh cappucino please", "cappucccino", "cappucicno",
      "cappuccinos", "cappuccin", "cappuccinxo", "sushi", "late", "mocho",
      "americani", "cappu\u200Bccino", "cappu\u200Dccino", "c\u0430ppuccino",
    ];

    for (const query of accepted) {
      const result = match(query);

      assert.equal(result.status, "matched", query);
      assert.equal(result.candidate.itemName, "Cappuccino", query);
    }
    for (const query of rejected) {
      assert.equal(match(query).status, "unknown", query);
    }
  },
);

test(
  "every source name and all one-character mutations preserve fallback boundaries",
  () => {
    const rows = normalizedData.menu.flatMap(
      (section) => section.items.map((item) => ({
        item,
        section: section.section,
        profile: buildSourceNameProfile(item.name),
      })),
    );
    const phrases = rows.flatMap(
      (row) => row.profile.normalizedSourceDerivedPhrases,
    );
    const allowedFallbacks = new Map();

    for (const row of rows) {
      const result = match(row.item.name, { sectionHint: row.section });

      assert.equal(result.status, "matched", row.item.name);
      assert.equal(result.candidate.itemId, row.item.item_id, row.item.name);

      const name = row.profile.normalizedName;

      if (!/^[a-z]{8,}$/u.test(name)) {
        continue;
      }
      for (let offset = 1; offset < name.length; offset += 1) {
        if (name[offset] === name[offset - 1]) {
          const variant = name.slice(0, offset) + name.slice(offset + 1);
          const ids = allowedFallbacks.get(variant) ?? new Set();

          ids.add(row.item.item_id);
          allowedFallbacks.set(variant, ids);
        }
      }
    }

    const queries = new Set();

    for (const row of rows) {
      const name = row.profile.normalizedName;

      queries.add(`${name}s`);
      for (let offset = 0; offset < name.length; offset += 1) {
        queries.add(name.slice(0, offset) + name.slice(offset + 1));
        queries.add(name.slice(0, offset) + name[offset] + name.slice(offset));
        queries.add(name.slice(0, offset) + "x" + name.slice(offset));
        queries.add(name.slice(0, offset) + "x" + name.slice(offset + 1));
        if (offset + 1 < name.length) {
          queries.add(
            name.slice(0, offset) + name[offset + 1] + name[offset] + name.slice(offset + 2),
          );
        }
      }
    }

    for (const query of queries) {
      const normalized = normalizeMatchText(query);
      const hasExact = phrases.some(
        (phrase) => ` ${normalized} `.includes(` ${phrase} `),
      );

      if (hasExact) {
        continue;
      }

      const expected = allowedFallbacks.get(normalized);
      const result = match(query);

      if (expected === undefined) {
        assert.equal(result.status, "unknown", query);
      } else if (expected.size === 1) {
        assert.equal(result.status, "matched", query);
        assert.ok(expected.has(result.candidate.itemId), query);
      } else {
        assert.equal(result.status, "ambiguous", query);
        assert.deepEqual(
          new Set(result.candidates.map((candidate) => candidate.itemId)),
          expected,
          query,
        );
      }
    }
  },
);

test(
  "missing double letters match only long single-word products in simple queries",
  () => {
    for (const spelling of [
      "cappucino",
      "capuccino",
      "cappuccino",
    ]) {
      for (const query of [
        spelling,
        `do you guys have ${spelling}?`,
        `how much is a ${spelling}`,
        `Do you serve ${spelling}, please?`,
      ]) {
        const result = match(query);

        assert.equal(
          result.status,
          "matched",
          query,
        );
        assert.equal(
          result.candidate.itemName,
          "Cappuccino",
          query,
        );
        assert.equal(
          result.normalizedQuery.includes(spelling),
          true,
        );
      }
    }
  },
);

test(
  "typo fallback rejects substitutions short names and compound unknown products",
  () => {
    const queries = [
      "cappaccino",
      "cappuchino",
      "cappuccina",
      "capucino",
      "chocolata",
      "americani",
      "late",
      "latt",
      "mocho",
      "eg",
      "sushi",
      "unicorn soup",
      "cappucino sushi",
      "iced cappucino",
      "cappucino lobster",
      "cappucino prosciuto",
      "Turkish breakfest",
    ];

    for (const query of queries) {
      assert.equal(
        match(query).status,
        "unknown",
        query,
      );
    }
  },
);

test(
  "missing double letter candidates stay ambiguous even with a section hint",
  () => {
    for (const options of [
      {},
      { sectionHint: "Sundaes" },
    ]) {
      const result =
        match("afogato", options);

      assert.equal(
        result.status,
        "ambiguous",
      );
      assert.equal(
        result.candidates.length,
        2,
      );
    }

    const data =
      structuredClone(normalizedData);
    const section = data.menu.find(
      (entry) => entry.section === "Caffetteria",
    );
    const item = section.items.find(
      (entry) => entry.name === "Cappuccino",
    );

    section.items.push({
      ...structuredClone(item),
      name: "Cappucinno",
      item_id: "nearby-product",
    });

    const result =
      createMenuMatcher(data)("cappucino");

    assert.equal(
      result.status,
      "ambiguous",
    );
    assert.deepEqual(
      new Set(result.candidates.map(
        (candidate) => candidate.itemName,
      )),
      new Set(["Cappuccino", "Cappucinno"]),
    );
  },
);

test(
  "exact source phrases take precedence over missing double letter candidates",
  () => {
    const data =
      structuredClone(normalizedData);
    const section = data.menu.find(
      (entry) => entry.section === "Caffetteria",
    );
    const item = section.items.find(
      (entry) => entry.name === "Cappuccino",
    );

    section.items.push({
      ...structuredClone(item),
      name: "Cappucino",
      item_id: "exact-product",
    });

    const localMatch = createMenuMatcher(data);

    for (const name of ["Cappucino", "Cappuccino"]) {
      const result = localMatch(`Do you have ${name}?`);

      assert.equal(
        result.status,
        "matched",
      );
      assert.equal(
        result.candidate.itemName,
        name,
      );
    }
  },
);

test(
  "missing double letter variants preserve the actual menu corpus and its ambiguity",
  () => {
    const items = normalizedData.menu.flatMap(
      (section) => section.items,
    );
    const variants = new Map();

    for (const item of items) {
      const name = item.name.toLowerCase();

      if (!/^[a-z]{8,}$/u.test(name)) {
        continue;
      }

      for (let offset = 1; offset < name.length; offset += 1) {
        if (name[offset] !== name[offset - 1]) {
          continue;
        }

        const variant =
          name.slice(0, offset) + name.slice(offset + 1);
        const candidates = variants.get(variant) ?? new Set();

        candidates.add(item.item_id);
        variants.set(variant, candidates);
      }
    }

    assert.equal(variants.size, 8);

    for (const [variant, candidates] of variants) {
      const result = match(variant);

      if (candidates.size === 1) {
        assert.equal(result.status, "matched", variant);
        assert.ok(candidates.has(result.candidate.itemId), variant);
      } else {
        assert.equal(result.status, "ambiguous", variant);
        assert.deepEqual(
          new Set(result.candidates.map(
            (candidate) => candidate.itemId,
          )),
          candidates,
          variant,
        );
      }
    }
  },
);

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
