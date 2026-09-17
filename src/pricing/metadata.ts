import type {
  PricingEvidence,
  PricingKind,
  PricingOption,
  PricingQualifiers,
} from "../types.js";

import { parseMoneyToken } from "./parser.js";

export interface ParsedSectionExtras {
  pricingOptions: PricingOption[];
  nonMonetary: Record<string, string>;
}

export interface ParsedMetadataPricing {
  currency: "GBP";
  options: PricingOption[];
}

function createMetadataEvidence(
  source:
    | "section_pricing"
    | "section_extras"
    | "section_mini_bottles"
    | "menu_service",
  sourcePath: string,
  rawText: string,
): PricingEvidence {
  return {
    source,
    sourcePath,
    rawText,
  };
}

function createMetadataOption(
  rawMoneyText: string,
  kind: PricingKind,
  qualifiers: PricingQualifiers,
  evidence: PricingEvidence,
): PricingOption {
  const money = parseMoneyToken(rawMoneyText);

  if (money === null) {
    throw new Error(
      `Unable to parse metadata money token: ${rawMoneyText}`,
    );
  }

  return {
    kind,
    amount: money.amount,
    amountMinor: money.amountMinor,
    pricingEffect: money.pricingEffect,
    qualifiers,
    evidence,
    qualifierEvidence: evidence,
  };
}

function containsMonetaryText(value: string): boolean {
  return /(?:\+?£\d|\+?\d+p\b)/i.test(value);
}

function parseSectionPricingKey(
  key: string,
): {
  kind: PricingKind;
  qualifiers: PricingQualifiers;
} {
  const scoopMatch = key.match(
    /^(\d+)_scoops?$/i,
  );

  if (scoopMatch !== null) {
    const quantityText = scoopMatch[1];

    if (quantityText === undefined) {
      throw new Error(
        `Unable to extract scoop quantity from key: ${key}`,
      );
    }

    return {
      kind: "quantity",
      qualifiers: {
        quantity: Number.parseInt(
          quantityText,
          10,
        ),
        unit: "scoop",
      },
    };
  }

  const normalizedKey =
    key.toLowerCase();

  if (
    normalizedKey === "regular" ||
    normalizedKey === "large"
  ) {
    return {
      kind: "size",
      qualifiers: {
        size: normalizedKey,
      },
    };
  }

  if (
    normalizedKey === "eat_in" ||
    normalizedKey === "takeaway"
  ) {
    return {
      kind: "service_mode",
      qualifiers: {
        serviceMode:
          normalizedKey === "eat_in"
            ? "eat in"
            : "takeaway",
      },
    };
  }

  return {
    kind: "variant",
    qualifiers: {
      variant: key,
    },
  };
}

export function parseSectionPricing(
  pricing: Readonly<Record<string, string>> | undefined,
  sourcePath: string,
): ParsedMetadataPricing | null {
  if (pricing === undefined) {
    return null;
  }

  const options: PricingOption[] = [];

  for (const [key, rawValue] of Object.entries(pricing)) {
    const money = parseMoneyToken(rawValue);

    if (money === null) {
      if (containsMonetaryText(rawValue)) {
        throw new Error(
          `Unsupported monetary section pricing value at ${sourcePath}/${key}: ${rawValue}`,
        );
      }

      throw new Error(
        `Section pricing value is not monetary at ${sourcePath}/${key}: ${rawValue}`,
      );
    }

    const parsedKey =
      parseSectionPricingKey(key);

    const evidence =
      createMetadataEvidence(
        "section_pricing",
        `${sourcePath}/${key}`,
        `${key}: ${rawValue}`,
      );

    options.push({
      kind: parsedKey.kind,
      amount: money.amount,
      amountMinor: money.amountMinor,
      pricingEffect: money.pricingEffect,
      qualifiers: parsedKey.qualifiers,
      evidence,
      qualifierEvidence: evidence,
    });
  }

  return {
    currency: "GBP",
    options,
  };
}

export function parseSectionExtras(
  extras: Readonly<Record<string, string>> | undefined,
  sourcePath: string,
): ParsedSectionExtras | null {
  if (extras === undefined) {
    return null;
  }

  const pricingOptions: PricingOption[] = [];
  const nonMonetary: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(extras)) {
    const money = parseMoneyToken(rawValue);

    if (money === null) {
      if (containsMonetaryText(rawValue)) {
        throw new Error(
          `Unsupported monetary section extra at ${sourcePath}/${key}: ${rawValue}`,
        );
      }

      nonMonetary[key] = rawValue;
      continue;
    }

    const evidence =
      createMetadataEvidence(
        "section_extras",
        `${sourcePath}/${key}`,
        `${key}: ${rawValue}`,
      );

    pricingOptions.push(
      createMetadataOption(
        rawValue,
        money.pricingEffect === "surcharge"
          ? "surcharge"
          : "variant",
        {
          variant: key,
        },
        evidence,
      ),
    );
  }

  return {
    pricingOptions,
    nonMonetary,
  };
}

export function parseMiniBottles(
  miniBottles:
    | Readonly<Record<string, string>>
    | undefined,
  sourcePath: string,
): ParsedMetadataPricing | null {
  if (miniBottles === undefined) {
    return null;
  }

  const options: PricingOption[] = [];

  for (
    const [bottleName, rawValue]
    of Object.entries(miniBottles)
  ) {
    const evidence =
      createMetadataEvidence(
        "section_mini_bottles",
        `${sourcePath}/${bottleName}`,
        `${bottleName}: ${rawValue}`,
      );

    options.push(
      createMetadataOption(
        rawValue,
        "variant",
        {
          variant: bottleName,
        },
        evidence,
      ),
    );
  }

  return {
    currency: "GBP",
    options,
  };
}

export function parseBrunchMimosaAddOn(
  rawValue: string,
  sourcePath: string,
  siteText: string,
): PricingOption {
  const money = parseMoneyToken(rawValue);

  if (money === null) {
    throw new Error(
      `Unable to parse brunch Mimosa add-on price: ${rawValue}`,
    );
  }

  const addOnEvidence =
    createMetadataEvidence(
      "menu_service",
      sourcePath,
      rawValue,
    );

  const qualifierEvidence =
    createMetadataEvidence(
      "menu_service",
      sourcePath.replace(
        /brunch_mimosa_add_on$/,
        "site_text",
      ),
      siteText,
    );

  return {
    kind: "surcharge",
    amount: money.amount,
    amountMinor: money.amountMinor,
    pricingEffect: "surcharge",
    qualifiers: {
      variant: "Mimosa",
    },
    evidence: addOnEvidence,
    qualifierEvidence,
  };
}