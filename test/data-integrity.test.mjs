import assert from "node:assert/strict";
import test from "node:test";

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

const normalizedItems =
  normalizedData.menu.flatMap(
    (section) => section.items,
  );

test(
  "source data keeps expected integrity invariants",
  () => {
    assert.equal(
      sourceData.menu.length,
      25,
    );

    const sourceItems =
      sourceData.menu.flatMap(
        (section) => section.items,
      );

    assert.equal(
      sourceItems.length,
      133,
    );

    assert.equal(
      sourceData.source.verified_on,
      "2026-09-14",
    );
  },
);

test(
  "normalized data keeps 133 unique stable item IDs",
  () => {
    assert.equal(
      normalizedItems.length,
      133,
    );

    const itemIds =
      normalizedItems.map(
        (item) => item.item_id,
      );

    assert.equal(
      new Set(itemIds).size,
      133,
    );
  },
);

test(
  "transformer preserves raw item source fields",
  () => {
    let checked = 0;

    sourceData.menu.forEach(
      (sourceSection, sectionIndex) => {
        sourceSection.items.forEach(
          (sourceItem, itemIndex) => {
            const normalizedItem =
              normalizedData.menu[
                sectionIndex
              ]?.items[itemIndex];

            assert.ok(
              normalizedItem,
              `Missing normalized item at section ${sectionIndex}, item ${itemIndex}`,
            );

            assert.deepEqual(
              normalizedItem.name,
              sourceItem.name,
            );

            assert.deepEqual(
              normalizedItem.price,
              sourceItem.price,
            );

            assert.deepEqual(
              normalizedItem.description,
              sourceItem.description,
            );

            assert.deepEqual(
              normalizedItem.dietary,
              sourceItem.dietary,
            );

            assert.deepEqual(
              normalizedItem.options,
              sourceItem.options,
            );

            checked += 1;
          },
        );
      },
    );

    assert.equal(
      checked,
      133,
    );
  },
);

test(
  "all primary pricing amounts are numeric and minor units are integers",
  () => {
    const options =
      normalizedItems.flatMap(
        (item) =>
          item.pricing.options,
      );

    assert.ok(
      options.length > 0,
    );

    for (const option of options) {
      assert.equal(
        typeof option.amount,
        "number",
      );

      assert.ok(
        Number.isFinite(
          option.amount,
        ),
      );

      assert.ok(
        Number.isInteger(
          option.amount_minor,
        ),
      );
    }
  },
);

test(
  "all monetary descriptions were normalized",
  () => {
    const descriptionPricedItems =
      normalizedItems.filter(
        (item) =>
          item.description_pricing !==
          null,
      );

    assert.equal(
      descriptionPricedItems.length,
      14,
    );

    const totalDescriptionOptions =
      descriptionPricedItems.reduce(
        (total, item) =>
          total +
          (
            item.description_pricing
              ?.options.length ?? 0
          ),
        0,
      );

    assert.equal(
      totalDescriptionOptions,
      17,
    );
  },
);

test(
  "Fresh Orange Juice keeps unlabeled prices unresolved",
  () => {
    const item =
      normalizedItems.find(
        (candidate) =>
          candidate.name ===
          "Fresh Orange Juice",
      );

    assert.ok(item);

    assert.equal(
      item.pricing.options.length,
      2,
    );

    for (
      const option of
      item.pricing.options
    ) {
      assert.equal(
        option.kind,
        "unlabelled",
      );

      assert.equal(
        option.ambiguity?.status,
        "unresolved",
      );
    }
  },
);

test(
  "Water uses source description to label still and sparkling prices",
  () => {
    const item =
      normalizedItems.find(
        (candidate) =>
          candidate.name ===
          "Water",
      );

    assert.ok(item);

    assert.deepEqual(
      item.pricing.options.map(
        (option) =>
          option.qualifiers.variant,
      ),
      [
        "still",
        "sparkling",
      ],
    );

    assert.deepEqual(
      item.pricing.options.map(
        (option) =>
          option.amount_minor,
      ),
      [
        145,
        175,
      ],
    );
  },
);

test(
  "Espresso / Doppio pricing is source-backed and numeric",
  () => {
    const item =
      normalizedItems.find(
        (candidate) =>
          candidate.name ===
          "Espresso / Doppio",
      );

    assert.ok(item);

    assert.deepEqual(
      item.pricing.options.map(
        (option) => ({
          variant:
            option.qualifiers
              .variant,
          amountMinor:
            option.amount_minor,
        }),
      ),
      [
        {
          variant: "Espresso",
          amountMinor: 245,
        },
        {
          variant: "Doppio",
          amountMinor: 275,
        },
      ],
    );
  },
);
