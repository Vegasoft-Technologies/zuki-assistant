import type {
  Pricing,
  PricingAmbiguity,
  PricingEvidence,
  PricingOption,
  PricingQualifiers,
} from "../types.js";

import {
  parseDescriptionPricing,
  type DescriptionPricing,
} from "../pricing/description.js";

import {
  parseBrunchMimosaAddOn,
  parseMiniBottles,
  parseSectionExtras,
  parseSectionPricing,
  type ParsedMetadataPricing,
  type ParsedSectionExtras,
} from "../pricing/metadata.js";

import {
  parsePrimaryPrice,
  type ParsePrimaryPriceInput,
} from "../pricing/parser.js";

import type {
  SourceMenuItem,
  SourceMenuSection,
  SourceZukiData,
} from "./schema.js";

export interface SerializedPricingQualifiers {
  quantity?: number;
  unit?: string;
  size?: string;
  service_mode?: string;
  volume_ml?: number;
  variant?: string;
  option_index?: number;
}

export interface SerializedPricingEvidence {
  source: PricingEvidence["source"];
  source_path: string;
  raw_text: string;
}

export interface SerializedPricingAmbiguity {
  status: PricingAmbiguity["status"];
  reason: string;
}

export interface SerializedPricingOption {
  kind: PricingOption["kind"];
  amount: number;
  amount_minor: number;
  pricing_effect: PricingOption["pricingEffect"];
  qualifiers: SerializedPricingQualifiers;
  evidence: SerializedPricingEvidence;
  qualifier_evidence?: SerializedPricingEvidence;
  ambiguity?: SerializedPricingAmbiguity;
}

export interface SerializedPricing {
  currency: "GBP";
  raw_price_text: string;
  options: SerializedPricingOption[];
}

export interface SerializedDescriptionPricing {
  currency: "GBP";
  raw_description: string;
  options: SerializedPricingOption[];
}

export interface SerializedMetadataPricing {
  currency: "GBP";
  options: SerializedPricingOption[];
}

export interface SerializedSectionExtras {
  pricing_options: SerializedPricingOption[];
  non_monetary: Record<string, string>;
}

type KnownSourceMenuItem = Pick<
  SourceMenuItem,
  | "name"
  | "price"
  | "dietary"
  | "description"
  | "options"
>;

type KnownSourceMenuSection = Pick<
  SourceMenuSection,
  | "section"
  | "items"
  | "extras"
  | "pricing"
  | "price_order"
  | "mini_bottles"
  | "note"
  | "site_heading"
>;

type SourceMenuService =
  SourceZukiData["menu_service"];

type KnownSourceMenuService = Pick<
  SourceMenuService,
  | "full_menu_until"
  | "brunch_mimosa_add_on"
  | "site_text"
>;

type KnownSourceZukiData = Pick<
  SourceZukiData,
  | "business"
  | "opening_hours"
  | "menu_service"
  | "menu"
  | "source"
  | "dietary_legend"
  | "customer_notes"
>;

export type NormalizedMenuItem =
  KnownSourceMenuItem & {
    [key: string]: unknown;
    item_id: string;
    pricing: SerializedPricing;
    description_pricing:
      | SerializedDescriptionPricing
      | null;
  };

export type NormalizedMenuSection =
  Omit<
    KnownSourceMenuSection,
    "items"
  > & {
    [key: string]: unknown;
    items: NormalizedMenuItem[];
    normalized_pricing?: SerializedMetadataPricing;
    normalized_extras?: SerializedSectionExtras;
    normalized_mini_bottles?: SerializedMetadataPricing;
  };

export type NormalizedMenuService =
  KnownSourceMenuService & {
    [key: string]: unknown;
    normalized_brunch_mimosa_add_on:
      SerializedPricingOption;
  };

export type NormalizedZukiData =
  Omit<
    KnownSourceZukiData,
    "menu" | "menu_service"
  > & {
    [key: string]: unknown;
    menu_service: NormalizedMenuService;
    menu: NormalizedMenuSection[];
  };

function serializeQualifiers(
  qualifiers: PricingQualifiers,
): SerializedPricingQualifiers {
  const serialized: SerializedPricingQualifiers =
    {};

  if (qualifiers.quantity !== undefined) {
    serialized.quantity =
      qualifiers.quantity;
  }

  if (qualifiers.unit !== undefined) {
    serialized.unit = qualifiers.unit;
  }

  if (qualifiers.size !== undefined) {
    serialized.size = qualifiers.size;
  }

  if (
    qualifiers.serviceMode !== undefined
  ) {
    serialized.service_mode =
      qualifiers.serviceMode;
  }

  if (
    qualifiers.volumeMl !== undefined
  ) {
    serialized.volume_ml =
      qualifiers.volumeMl;
  }

  if (
    qualifiers.variant !== undefined
  ) {
    serialized.variant =
      qualifiers.variant;
  }

  if (
    qualifiers.optionIndex !== undefined
  ) {
    serialized.option_index =
      qualifiers.optionIndex;
  }

  return serialized;
}

function serializeEvidence(
  evidence: PricingEvidence,
): SerializedPricingEvidence {
  return {
    source: evidence.source,
    source_path: evidence.sourcePath,
    raw_text: evidence.rawText,
  };
}

function serializeOption(
  option: PricingOption,
): SerializedPricingOption {
  const serialized: SerializedPricingOption =
    {
      kind: option.kind,
      amount: option.amount,
      amount_minor: option.amountMinor,
      pricing_effect:
        option.pricingEffect,
      qualifiers: serializeQualifiers(
        option.qualifiers,
      ),
      evidence: serializeEvidence(
        option.evidence,
      ),
    };

  if (
    option.qualifierEvidence !== undefined
  ) {
    serialized.qualifier_evidence =
      serializeEvidence(
        option.qualifierEvidence,
      );
  }

  if (option.ambiguity !== undefined) {
    serialized.ambiguity = {
      status: option.ambiguity.status,
      reason: option.ambiguity.reason,
    };
  }

  return serialized;
}

function serializePricing(
  pricing: Pricing,
): SerializedPricing {
  return {
    currency: pricing.currency,
    raw_price_text:
      pricing.rawPriceText,
    options:
      pricing.options.map(
        serializeOption,
      ),
  };
}

function serializeDescriptionPricing(
  pricing: DescriptionPricing,
): SerializedDescriptionPricing {
  return {
    currency: pricing.currency,
    raw_description:
      pricing.rawDescription,
    options:
      pricing.options.map(
        serializeOption,
      ),
  };
}

function serializeMetadataPricing(
  pricing: ParsedMetadataPricing,
): SerializedMetadataPricing {
  return {
    currency: pricing.currency,
    options:
      pricing.options.map(
        serializeOption,
      ),
  };
}

function serializeSectionExtras(
  extras: ParsedSectionExtras,
): SerializedSectionExtras {
  return {
    pricing_options:
      extras.pricingOptions.map(
        serializeOption,
      ),
    non_monetary: {
      ...extras.nonMonetary,
    },
  };
}

function slugifyStableIdPart(
  value: string,
): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    throw new Error(
      `Unable to create stable ID component from: ${value}`,
    );
  }

  return normalized;
}

function createStableItemId(
  sectionName: string,
  itemName: string,
): string {
  return [
    slugifyStableIdPart(sectionName),
    slugifyStableIdPart(itemName),
  ].join("--");
}

function createPrimaryPriceInput(
  section: SourceMenuSection,
  sectionIndex: number,
  item: SourceMenuItem,
  itemIndex: number,
): ParsePrimaryPriceInput {
  const itemPath =
    `/menu/${sectionIndex}/items/${itemIndex}`;

  const input: ParsePrimaryPriceInput = {
    rawPriceText: item.price,
    sourcePath:
      `${itemPath}/price`,
    itemName: item.name,
    itemNameSourcePath:
      `${itemPath}/name`,
    description:
      item.description,
    descriptionSourcePath:
      `${itemPath}/description`,
  };

  if (
    section.price_order !== undefined
  ) {
    input.sectionPriceOrder =
      section.price_order;

    input.sectionPriceOrderSourcePath =
      `/menu/${sectionIndex}/price_order`;
  }

  return input;
}

function transformItem(
  section: SourceMenuSection,
  sectionIndex: number,
  item: SourceMenuItem,
  itemIndex: number,
  seenItemIds: Set<string>,
): NormalizedMenuItem {
  const itemId =
    createStableItemId(
      section.section,
      item.name,
    );

  if (seenItemIds.has(itemId)) {
    throw new Error(
      `Duplicate generated item_id: ${itemId}`,
    );
  }

  seenItemIds.add(itemId);

  const pricing =
    parsePrimaryPrice(
      createPrimaryPriceInput(
        section,
        sectionIndex,
        item,
        itemIndex,
      ),
    );

  const itemPath =
    `/menu/${sectionIndex}/items/${itemIndex}`;

  const descriptionPricing =
    parseDescriptionPricing(
      item.description,
      `${itemPath}/description`,
    );

  return {
    ...item,
    item_id: itemId,
    pricing:
      serializePricing(pricing),
    description_pricing:
      descriptionPricing === null
        ? null
        : serializeDescriptionPricing(
            descriptionPricing,
          ),
  };
}

function transformSection(
  section: SourceMenuSection,
  sectionIndex: number,
  seenItemIds: Set<string>,
): NormalizedMenuSection {
  const transformed:
    NormalizedMenuSection = {
      ...section,
      items: section.items.map(
        (item, itemIndex) =>
          transformItem(
            section,
            sectionIndex,
            item,
            itemIndex,
            seenItemIds,
          ),
      ),
    };

  const sectionPricing =
    parseSectionPricing(
      section.pricing,
      `/menu/${sectionIndex}/pricing`,
    );

  if (sectionPricing !== null) {
    transformed.normalized_pricing =
      serializeMetadataPricing(
        sectionPricing,
      );
  }

  const sectionExtras =
    parseSectionExtras(
      section.extras,
      `/menu/${sectionIndex}/extras`,
    );

  if (sectionExtras !== null) {
    transformed.normalized_extras =
      serializeSectionExtras(
        sectionExtras,
      );
  }

  const miniBottles =
    parseMiniBottles(
      section.mini_bottles,
      `/menu/${sectionIndex}/mini_bottles`,
    );

  if (miniBottles !== null) {
    transformed.normalized_mini_bottles =
      serializeMetadataPricing(
        miniBottles,
      );
  }

  return transformed;
}

export function transformZukiData(
  sourceData: SourceZukiData,
): NormalizedZukiData {
  const seenItemIds =
    new Set<string>();

  const normalizedMenu =
    sourceData.menu.map(
      (
        section,
        sectionIndex,
      ) =>
        transformSection(
          section,
          sectionIndex,
          seenItemIds,
        ),
    );

  const brunchMimosa =
    parseBrunchMimosaAddOn(
      sourceData.menu_service
        .brunch_mimosa_add_on,
      "/menu_service/brunch_mimosa_add_on",
      sourceData.menu_service
        .site_text,
    );

  return {
    ...sourceData,

    menu_service: {
      ...sourceData.menu_service,
      normalized_brunch_mimosa_add_on:
        serializeOption(
          brunchMimosa,
        ),
    },

    menu: normalizedMenu,
  };
}