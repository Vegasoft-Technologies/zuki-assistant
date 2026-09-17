import type {
  PricingEffect,
  PricingEvidence,
  PricingKind,
  PricingOption,
  PricingQualifiers,
} from "../types.js";

import { parseMoneyToken } from "./parser.js";

export interface DescriptionPricing {
  currency: "GBP";
  rawDescription: string;
  options: PricingOption[];
}

interface MatchRange {
  start: number;
  end: number;
}

interface CollectedOption {
  index: number;
  option: PricingOption;
}

function createDescriptionEvidence(
  sourcePath: string,
  rawText: string,
): PricingEvidence {
  return {
    source: "item_description",
    sourcePath,
    rawText,
  };
}

function createDescriptionOption(
  moneyText: string,
  kind: PricingKind,
  qualifiers: PricingQualifiers,
  sourcePath: string,
  rawText: string,
  pricingEffectOverride?: PricingEffect,
): PricingOption {
  const money = parseMoneyToken(moneyText);

  if (money === null) {
    throw new Error(
      `Unable to parse description money token: ${moneyText}`,
    );
  }

  const evidence = createDescriptionEvidence(
    sourcePath,
    rawText,
  );

  return {
    kind,
    amount: money.amount,
    amountMinor: money.amountMinor,
    pricingEffect:
      pricingEffectOverride ?? money.pricingEffect,
    qualifiers,
    evidence,
    qualifierEvidence: evidence,
  };
}

function addMatchedOption(
  collected: CollectedOption[],
  ranges: MatchRange[],
  match: RegExpMatchArray,
  option: PricingOption,
): void {
  if (match.index === undefined) {
    throw new Error(
      "Regex match did not provide an index.",
    );
  }

  const start = match.index;
  const end = start + match[0].length;

  const overlapsExistingRange = ranges.some(
    (range) =>
      start < range.end &&
      end > range.start,
  );

  if (overlapsExistingRange) {
    return;
  }

  ranges.push({
    start,
    end,
  });

  collected.push({
    index: start,
    option,
  });
}

function parseQuantityToken(
  rawQuantity: string,
): number | null {
  if (/^\d+$/.test(rawQuantity)) {
    return Number.parseInt(rawQuantity, 10);
  }

  const normalized =
    rawQuantity.toLowerCase();

  const wordQuantities: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };

  return wordQuantities[normalized] ?? null;
}

function addOnQualifiers(
  rawLabel: string,
): PricingQualifiers {
  const label = rawLabel.trim();

  const quantityMatch = label.match(
    /^(\d+)\s+(.+)$/,
  );

  if (quantityMatch === null) {
    return {
      variant: label,
    };
  }

  const quantityText = quantityMatch[1];
  const variant = quantityMatch[2];

  if (
    quantityText === undefined ||
    variant === undefined
  ) {
    return {
      variant: label,
    };
  }

  return {
    quantity: Number.parseInt(
      quantityText,
      10,
    ),
    variant: variant.trim(),
  };
}

function assertAllMoneyWasParsed(
  description: string,
  ranges: readonly MatchRange[],
): void {
  const moneyPattern =
    /(?:\+?£\d+(?:\.\d{1,2})?|\+?\d+p)/gi;

  const unparsedMoney: string[] = [];

  for (
    const match of description.matchAll(
      moneyPattern,
    )
  ) {
    if (match.index === undefined) {
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;

    const isCovered = ranges.some(
      (range) =>
        start >= range.start &&
        end <= range.end,
    );

    if (!isCovered) {
      unparsedMoney.push(match[0]);
    }
  }

  if (unparsedMoney.length > 0) {
    throw new Error(
      `Unsupported monetary information in description: ${unparsedMoney.join(
        ", ",
      )}. Description: ${description}`,
    );
  }
}

export function parseDescriptionPricing(
  description: string | null,
  sourcePath: string,
): DescriptionPricing | null {
  if (description === null) {
    return null;
  }

  const containsMoney =
    /(?:\+?£\d+(?:\.\d{1,2})?|\+?\d+p)/i.test(
      description,
    );

  if (!containsMoney) {
    return null;
  }

  const collected: CollectedOption[] = [];
  const ranges: MatchRange[] = [];

  const addPattern =
    /\bAdd\s+(.+?)\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      addPattern,
    )
  ) {
    const label = match[1];
    const moneyText = match[2];

    if (
      label === undefined ||
      moneyText === undefined
    ) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "surcharge",
        addOnQualifiers(label),
        sourcePath,
        match[0],
        "surcharge",
      ),
    );
  }

  const largePattern =
    /\bLarge\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      largePattern,
    )
  ) {
    const moneyText = match[1];

    if (moneyText === undefined) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "size",
        {
          size: "large",
        },
        sourcePath,
        match[0],
      ),
    );
  }

  const wordBundlePattern =
    /\bFor\s+(one|two|three|four|\d+)\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      wordBundlePattern,
    )
  ) {
    const quantityText = match[1];
    const moneyText = match[2];

    if (
      quantityText === undefined ||
      moneyText === undefined
    ) {
      continue;
    }

    const quantity =
      parseQuantityToken(quantityText);

    if (quantity === null) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "bundle",
        {
          quantity,
        },
        sourcePath,
        match[0],
      ),
    );
  }

  const numericBundlePattern =
    /\b(\d+)\s+for\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      numericBundlePattern,
    )
  ) {
    const quantityText = match[1];
    const moneyText = match[2];

    if (
      quantityText === undefined ||
      moneyText === undefined
    ) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "bundle",
        {
          quantity: Number.parseInt(
            quantityText,
            10,
          ),
        },
        sourcePath,
        match[0],
      ),
    );
  }

  const glutenFreePattern =
    /\bGluten-free\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      glutenFreePattern,
    )
  ) {
    const moneyText = match[1];

    if (moneyText === undefined) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "variant",
        {
          variant: "gluten-free",
        },
        sourcePath,
        match[0],
      ),
    );
  }

  const filledPattern =
    /\bFilled\s+\(([^)]+)\)\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      filledPattern,
    )
  ) {
    const fillingText = match[1];
    const moneyText = match[2];

    if (
      fillingText === undefined ||
      moneyText === undefined
    ) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "variant",
        {
          variant: `filled (${fillingText.trim()})`,
        },
        sourcePath,
        match[0],
      ),
    );
  }

  const conePattern =
    /\b(Waffle cone|dipped cone)\s+(\+?£\d+(?:\.\d{1,2})?|\+?\d+p)\b/gi;

  for (
    const match of description.matchAll(
      conePattern,
    )
  ) {
    const coneType = match[1];
    const moneyText = match[2];

    if (
      coneType === undefined ||
      moneyText === undefined
    ) {
      continue;
    }

    addMatchedOption(
      collected,
      ranges,
      match,
      createDescriptionOption(
        moneyText,
        "surcharge",
        {
          variant:
            coneType.toLowerCase(),
        },
        sourcePath,
        match[0],
        "surcharge",
      ),
    );
  }

  assertAllMoneyWasParsed(
    description,
    ranges,
  );

  collected.sort(
    (left, right) =>
      left.index - right.index,
  );

  return {
    currency: "GBP",
    rawDescription: description,
    options: collected.map(
      (entry) => entry.option,
    ),
  };
}