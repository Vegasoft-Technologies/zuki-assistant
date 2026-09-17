import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createAssistantService,
} from "../dist/assistant/service.js";

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
  normalizeMatchText,
} from "../dist/matching/normalize.js";

const sourceData =
  await loadZukiData();

const normalizedData =
  transformZukiData(sourceData);

const diskNormalized =
  JSON.parse(
    fs.readFileSync(
      new URL(
        "../data/zuki_data.normalized.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

const match =
  createMenuMatcher(normalizedData);

function getItems(data) {
  return data.menu.flatMap(
    (section) =>
      section.items.map(
        (item) => ({
          section: section.section,
          item,
        }),
      ),
  );
}

function getIds(data) {
  return getItems(data).map(
    ({ item }) => item.item_id,
  );
}

function findSourceItemName(
  normalizedName,
) {
  const found =
    getItems(normalizedData).find(
      ({ item }) =>
        normalizeMatchText(
          item.name,
        ) === normalizedName,
    );

  if (found === undefined) {
    throw new Error(
      `Source item not found: ${normalizedName}`,
    );
  }

  return found.item.name;
}

test(
  "STEP2-01 dataset has exactly 25 sections and 133 normalized items with unique non-empty IDs",
  () => {
    const sourceItems =
      sourceData.menu.reduce(
        (sum, section) =>
          sum + section.items.length,
        0,
      );

    const normalizedItems =
      getItems(
        normalizedData,
      );

    const ids =
      normalizedItems.map(
        ({ item }) =>
          item.item_id,
      );

    assert.equal(
      sourceData.menu.length,
      25,
    );

    assert.equal(
      normalizedData.menu.length,
      25,
    );

    assert.equal(
      sourceItems,
      133,
    );

    assert.equal(
      normalizedItems.length,
      133,
    );

    assert.equal(
      ids.length,
      133,
    );

    assert.equal(
      new Set(ids).size,
      133,
    );

    assert.equal(
      ids.filter(
        (id) =>
          typeof id !== "string" ||
          id.trim().length === 0,
      ).length,
      0,
    );
  },
);

test(
  "STEP2-02 item IDs are deterministic and match the generated normalized file",
  () => {
    const run1 =
      transformZukiData(
        sourceData,
      );

    const run2 =
      transformZukiData(
        sourceData,
      );

    assert.deepEqual(
      getIds(run1),
      getIds(run2),
    );

    assert.deepEqual(
      getIds(run1),
      getIds(diskNormalized),
    );
  },
);

test(
  "STEP2-03 every primary item price is normalized and all expected pricing forms are represented",
  () => {
    const kindCounts = {};

    for (
      const { item }
      of getItems(normalizedData)
    ) {
      assert.ok(
        item.pricing,
        `Missing pricing for ${item.name}`,
      );

      assert.ok(
        Array.isArray(
          item.pricing.options,
        ),
        `Pricing options missing for ${item.name}`,
      );

      assert.ok(
        item.pricing.options.length > 0,
        `Empty pricing options for ${item.name}`,
      );

      for (
        const option
        of item.pricing.options
      ) {
        kindCounts[option.kind] =
          (kindCounts[option.kind] ?? 0) +
          1;
      }
    }

    assert.deepEqual(
      kindCounts,
      {
        base: 102,
        bundle: 2,
        variant: 4,
        size: 20,
        quantity: 9,
        surcharge: 6,
        service_mode: 10,
        volume: 9,
        unlabelled: 2,
      },
    );
  },
);

test(
  "STEP2-04 every normalized monetary amount is finite non-negative and consistent with integer minor units",
  () => {
    let checkedAmounts = 0;

    function walk(
      value,
      path = "",
    ) {
      if (Array.isArray(value)) {
        value.forEach(
          (entry, index) =>
            walk(
              entry,
              `${path}/${index}`,
            ),
        );

        return;
      }

      if (
        value === null ||
        typeof value !== "object"
      ) {
        return;
      }

      const hasAmount =
        Object.prototype
          .hasOwnProperty.call(
            value,
            "amount",
          );

      const hasMinor =
        Object.prototype
          .hasOwnProperty.call(
            value,
            "amount_minor",
          );

      if (
        hasAmount ||
        hasMinor
      ) {
        checkedAmounts += 1;

        assert.equal(
          typeof value.amount,
          "number",
          `${path}: amount is not numeric`,
        );

        assert.ok(
          Number.isFinite(
            value.amount,
          ),
          `${path}: amount is not finite`,
        );

        assert.ok(
          value.amount >= 0,
          `${path}: amount is negative`,
        );

        assert.ok(
          Number.isInteger(
            value.amount_minor,
          ),
          `${path}: amount_minor is not an integer`,
        );

        assert.ok(
          value.amount_minor >= 0,
          `${path}: amount_minor is negative`,
        );

        assert.equal(
          Math.round(
            value.amount * 100,
          ),
          value.amount_minor,
          `${path}: amount and amount_minor disagree`,
        );
      }

      for (
        const [key, entry]
        of Object.entries(value)
      ) {
        walk(
          entry,
          `${path}/${key}`,
        );
      }
    }

    walk(
      normalizedData,
    );

    assert.ok(
      checkedAmounts > 0,
    );
  },
);

test(
  "STEP2-05 derived normalization preserves the complete raw source dataset",
  () => {
    const rawOnly =
      structuredClone(
        normalizedData,
      );

    for (
      const section
      of rawOnly.menu
    ) {
      delete section.normalized_pricing;
      delete section.normalized_extras;
      delete section.normalized_mini_bottles;

      for (
        const item
        of section.items
      ) {
        delete item.item_id;
        delete item.pricing;
        delete item.description_pricing;
      }
    }

    if (
      rawOnly.menu_service
    ) {
      delete rawOnly
        .menu_service
        .normalized_brunch_mimosa_add_on;
    }

    assert.deepEqual(
      rawOnly,
      sourceData,
    );
  },
);

test(
  "STEP2-06 monetary information in source data is accounted for including descriptions and section metadata",
  () => {
    const moneyFields = [];

    function collectMoney(
      value,
      path = "",
    ) {
      if (
        typeof value === "string"
      ) {
        if (
          /£|(?:^|[^A-Za-z])\d+(?:\.\d+)?p\b/i
            .test(value)
        ) {
          moneyFields.push({
            path,
            value,
          });
        }

        return;
      }

      if (Array.isArray(value)) {
        value.forEach(
          (entry, index) =>
            collectMoney(
              entry,
              `${path}/${index}`,
            ),
        );

        return;
      }

      if (
        value !== null &&
        typeof value === "object"
      ) {
        for (
          const [key, entry]
          of Object.entries(value)
        ) {
          collectMoney(
            entry,
            `${path}/${key}`,
          );
        }
      }
    }

    const evidencePaths =
      new Set();

    function collectEvidence(
      value,
    ) {
      if (Array.isArray(value)) {
        value.forEach(
          collectEvidence,
        );

        return;
      }

      if (
        value === null ||
        typeof value !== "object"
      ) {
        return;
      }

      if (
        typeof value.source_path ===
        "string"
      ) {
        evidencePaths.add(
          value.source_path,
        );
      }

      for (
        const entry
        of Object.values(value)
      ) {
        collectEvidence(
          entry,
        );
      }
    }

    collectMoney(
      sourceData,
    );

    collectEvidence(
      normalizedData,
    );

    const uncovered =
      moneyFields.filter(
        ({ path }) =>
          !evidencePaths.has(path),
      );

    assert.equal(
      uncovered.length,
      3,
    );

    for (
      const entry
      of uncovered
    ) {
      assert.match(
        entry.path,
        /^\/menu\/\d+\/site_heading$/,
      );

      const matchResult =
        entry.path.match(
          /^\/menu\/(\d+)\/site_heading$/,
        );

      assert.ok(
        matchResult,
      );

      const sectionIndex =
        Number(
          matchResult[1],
        );

      const section =
        normalizedData
          .menu[
            sectionIndex
          ];

      assert.ok(
        section,
      );

      const headingAmounts =
        (
          entry.value.match(
            /£\d+(?:\.\d+)?/g,
          ) ?? []
        ).map(
          (token) =>
            Math.round(
              Number(
                token.slice(1),
              ) * 100,
            ),
        );

      const normalizedAmounts =
        (
          section
            .normalized_pricing
            ?.options ?? []
        ).map(
          (option) =>
            option.amount_minor,
        );

      assert.deepEqual(
        headingAmounts,
        normalizedAmounts,
      );
    }

    const descriptionPriced =
      getItems(
        normalizedData,
      ).filter(
        ({ item }) =>
          item.description_pricing !==
          null,
      );

    const descriptionOptions =
      descriptionPriced.reduce(
        (sum, { item }) =>
          sum +
          item.description_pricing
            .options.length,
        0,
      );

    assert.equal(
      descriptionPriced.length,
      14,
    );

    assert.equal(
      descriptionOptions,
      17,
    );

    const findSection =
      (name) =>
        normalizedData.menu.find(
          (section) =>
            section.section === name,
        );

    assert.ok(
      findSection(
        "Caffetteria",
      )?.normalized_extras,
    );

    assert.ok(
      findSection(
        "Gelato & sorbet",
      )?.normalized_pricing,
    );

    assert.ok(
      findSection(
        "Sundaes",
      )?.normalized_pricing,
    );

    assert.ok(
      findSection(
        "Wine",
      )?.normalized_mini_bottles,
    );

    assert.ok(
      findSection(
        "Smoothies",
      )?.normalized_pricing,
    );

    assert.ok(
      normalizedData
        .menu_service
        .normalized_brunch_mimosa_add_on,
    );
  },
);

test(
  "STEP2-07 unsupported multi-price semantics remain explicitly unresolved without invented labels",
  () => {
    const juice =
      getItems(
        normalizedData,
      ).find(
        ({ item }) =>
          item.name ===
          "Fresh Orange Juice",
      );

    assert.ok(
      juice,
    );

    const options =
      juice.item
        .pricing
        .options;

    assert.equal(
      options.length,
      2,
    );

    assert.deepEqual(
      options.map(
        (option) =>
          option.amount_minor,
      ),
      [
        495,
        620,
      ],
    );

    for (
      const option
      of options
    ) {
      assert.equal(
        option.kind,
        "unlabelled",
      );

      assert.equal(
        option.ambiguity?.status,
        "unresolved",
      );

      assert.ok(
        typeof option
          .ambiguity
          ?.reason === "string" &&
          option
            .ambiguity
            .reason
            .length > 0,
      );

      assert.deepEqual(
        Object.keys(
          option.qualifiers,
        ),
        [
          "option_index",
        ],
      );
    }
  },
);

test(
  "STEP2-08 matcher handles normalization punctuation aliases and longest valid product specificity",
  () => {
    const cases = [
      {
        query:
          "How much is a Doppio?",
        expected:
          findSourceItemName(
            "espresso doppio",
          ),
      },
      {
        query:
          "DOPPIO!!!",
        expected:
          findSourceItemName(
            "espresso doppio",
          ),
      },
      {
        query:
          "How much is an iced americano?",
        expected:
          findSourceItemName(
            "iced americano",
          ),
      },
      {
        query:
          "Zuki's Favourite please",
        expected:
          findSourceItemName(
            "zukis favourite",
          ),
      },
      {
        query:
          "sigara borek",
        expected:
          findSourceItemName(
            "sigara borek",
          ),
      },
      {
        query:
          "Ham and Cheese Omelette",
        expected:
          findSourceItemName(
            "ham and cheese omelette",
          ),
      },
      {
        query:
          "Ham and Cheese",
        expected:
          findSourceItemName(
            "ham and cheese",
          ),
      },
      {
        query:
          "wafer biscuits",
        expected:
          findSourceItemName(
            "whipped cream wafer biscuits",
          ),
      },
      {
        query:
          "Rio Tropical",
        expected:
          findSourceItemName(
            "coca cola diet rio tropical",
          ),
      },
      {
        query:
          "Smoked Salmon Rocket and Brie",
        expected:
          findSourceItemName(
            "smoked salmon rocket and brie",
          ),
      },
    ];

    for (
      const current
      of cases
    ) {
      const result =
        match(
          current.query,
        );

      assert.equal(
        result.status,
        "matched",
        current.query,
      );

      if (
        result.status !==
        "matched"
      ) {
        continue;
      }

      assert.equal(
        result.candidate.itemName,
        current.expected,
        current.query,
      );
    }
  },
);

test(
  "STEP2-09 duplicate product names remain ambiguous and source section context resolves them safely",
  () => {
    const groups =
      new Map();

    for (
      const { section, item }
      of getItems(
        normalizedData,
      )
    ) {
      const key =
        normalizeMatchText(
          item.name,
        );

      if (
        !groups.has(key)
      ) {
        groups.set(
          key,
          [],
        );
      }

      groups.get(key).push({
        section,
        item,
      });
    }

    const duplicates =
      [...groups.entries()]
        .filter(
          ([, items]) =>
            items.length > 1,
        );

    assert.equal(
      duplicates.length,
      1,
    );

    assert.equal(
      duplicates[0][0],
      "affogato",
    );

    assert.equal(
      duplicates[0][1].length,
      2,
    );

    const plain =
      match(
        "Affogato",
      );

    assert.equal(
      plain.status,
      "ambiguous",
    );

    if (
      plain.status ===
      "ambiguous"
    ) {
      assert.equal(
        plain.candidates.length,
        2,
      );
    }

    const sundae =
      match(
        "Affogato",
        {
          sectionHint:
            "Sundaes",
        },
      );

    assert.equal(
      sundae.status,
      "matched",
    );

    if (
      sundae.status ===
      "matched"
    ) {
      assert.equal(
        sundae.candidate.section,
        "Sundaes",
      );
    }

    const italian =
      match(
        "Affogato",
        {
          sectionHint:
            "Italian favourites",
        },
      );

    assert.equal(
      italian.status,
      "matched",
    );

    if (
      italian.status ===
      "matched"
    ) {
      assert.equal(
        italian.candidate.section,
        "Italian favourites",
      );
    }

    const natural =
      match(
        "Affogato from Sundaes",
      );

    assert.equal(
      natural.status,
      "matched",
    );

    if (
      natural.status ===
      "matched"
    ) {
      assert.equal(
        natural.candidate.section,
        "Sundaes",
      );
    }
  },
);

test(
  "STEP2-10 compound and adversarial product queries are not silently collapsed to the wrong product",
  () => {
    const unknown =
      match(
        "Dondurmali helva ne kadar?",
      );

    assert.equal(
      unknown.status,
      "unknown",
    );

    const independent =
      match(
        "Americano cheesecake combo",
      );

    assert.equal(
      independent.status,
      "ambiguous",
    );

    if (
      independent.status ===
      "ambiguous"
    ) {
      assert.deepEqual(
        new Set(
          independent
            .candidates
            .map(
              (candidate) =>
                candidate.itemName,
            ),
        ),
        new Set([
          "Americano",
          "Cheesecake",
        ]),
      );
    }

    const secondIndependent =
      match(
        "Latte salmon special",
      );

    assert.equal(
      secondIndependent.status,
      "ambiguous",
    );

    const singleValid =
      match(
        "Doppio smoothie sandwich",
      );

    assert.equal(
      singleValid.status,
      "matched",
    );

    if (
      singleValid.status ===
      "matched"
    ) {
      assert.equal(
        singleValid
          .candidate
          .itemName,
        "Espresso / Doppio",
      );
    }
  },
);

test(
  "STEP2-11 unknown and ambiguous queries are blocked before Claude while matched queries can reach it",
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
                  "FAKE CLAUDE RESPONSE",
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

    assert.equal(
      unknown.status,
      "not_found",
    );

    assert.equal(
      claudeCalls,
      0,
    );

    const duplicate =
      await service.ask(
        "Affogato",
      );

    assert.equal(
      duplicate.status,
      "clarification_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );

    const independent =
      await service.ask(
        "Americano cheesecake combo",
      );

    assert.equal(
      independent.status,
      "clarification_required",
    );

    assert.equal(
      claudeCalls,
      0,
    );

    const matched =
      await service.ask(
        "How much is a Doppio?",
      );

    assert.equal(
      matched.status,
      "answered",
    );

    assert.equal(
      claudeCalls,
      1,
    );
  },
);
