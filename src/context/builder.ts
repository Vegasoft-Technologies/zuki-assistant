import type {
  NormalizedMenuItem,
  NormalizedMenuSection,
  NormalizedZukiData,
  SerializedDescriptionPricing,
  SerializedMetadataPricing,
  SerializedPricing,
  SerializedSectionExtras,
} from "../data/transformer.js";

import type {
  MenuMatchCandidate,
  MenuMatchResult,
} from "../matching/matcher.js";

export interface MenuContextBusiness {
  name: string;
  currency: string;
}

export interface MenuContextSource {
  url: string;
  verifiedOn: string;
}

export interface MenuContextQuery {
  raw: string;
  normalized: string;
}

export interface MenuContextMatch {
  itemId: string;
  itemName: string;
  section: string;
  matchedPhrase: string;
}

export interface MenuContextItem {
  itemId: string;
  name: string;
  description: string | null;
  dietary: string[];
  options: string[];
  rawPriceText: string;
  pricing: SerializedPricing;
  descriptionPricing:
    | SerializedDescriptionPricing
    | null;
}

export interface MenuContextSection {
  name: string;
  note: string | null;
  siteHeading: string | null;
  pricing: SerializedMetadataPricing | null;
  extras: SerializedSectionExtras | null;
  miniBottles: SerializedMetadataPricing | null;
}

export interface MenuItemContext {
  kind: "menu_item";
  business: MenuContextBusiness;
  source: MenuContextSource;
  query: MenuContextQuery;
  match: MenuContextMatch;
  item: MenuContextItem;
  section: MenuContextSection;
}

export interface ReadyMenuContextResult {
  status: "ready";
  context: MenuItemContext;
}

export interface BlockedMenuCandidate {
  itemId: string;
  itemName: string;
  section: string;
}

export interface BlockedMenuContextResult {
  status: "blocked";
  reason: "unknown" | "ambiguous";
  query: string;
  normalizedQuery: string;
  candidates: BlockedMenuCandidate[];
  guidance: string;
}

export type MenuContextBuildResult =
  | ReadyMenuContextResult
  | BlockedMenuContextResult;

function toBlockedCandidate(
  candidate: MenuMatchCandidate,
): BlockedMenuCandidate {
  return {
    itemId: candidate.itemId,
    itemName: candidate.itemName,
    section: candidate.section,
  };
}

function findMatchedSection(
  data: NormalizedZukiData,
  itemId: string,
): NormalizedMenuSection {
  const matchingSections = data.menu.filter(
    (section) =>
      section.items.some(
        (item) => item.item_id === itemId,
      ),
  );

  if (matchingSections.length !== 1) {
    throw new Error(
      `Expected exactly one section for item_id "${itemId}", found ${matchingSections.length}.`,
    );
  }

  const section = matchingSections[0];

  if (section === undefined) {
    throw new Error(
      `Unable to resolve section for item_id "${itemId}".`,
    );
  }

  return section;
}

function findMatchedItem(
  section: NormalizedMenuSection,
  itemId: string,
): NormalizedMenuItem {
  const matchingItems = section.items.filter(
    (item) => item.item_id === itemId,
  );

  if (matchingItems.length !== 1) {
    throw new Error(
      `Expected exactly one item with item_id "${itemId}" in section "${section.section}", found ${matchingItems.length}.`,
    );
  }

  const item = matchingItems[0];

  if (item === undefined) {
    throw new Error(
      `Unable to resolve item_id "${itemId}" in section "${section.section}".`,
    );
  }

  return item;
}

function verifyMatchedCandidate(
  candidate: MenuMatchCandidate,
  section: NormalizedMenuSection,
  item: NormalizedMenuItem,
): void {
  if (section.section !== candidate.section) {
    throw new Error(
      `Matcher/data section mismatch for item_id "${candidate.itemId}".`,
    );
  }

  if (item.name !== candidate.itemName) {
    throw new Error(
      `Matcher/data item-name mismatch for item_id "${candidate.itemId}".`,
    );
  }
}

export function buildMenuContext(
  data: NormalizedZukiData,
  matchResult: MenuMatchResult,
): MenuContextBuildResult {
  if (matchResult.status === "unknown") {
    return {
      status: "blocked",
      reason: "unknown",
      query: matchResult.query,
      normalizedQuery:
        matchResult.normalizedQuery,
      candidates: [],
      guidance:
        "Do not ask the language model to invent a menu answer. Respond safely that no source-backed menu item was identified.",
    };
  }

  if (matchResult.status === "ambiguous") {
    return {
      status: "blocked",
      reason: "ambiguous",
      query: matchResult.query,
      normalizedQuery:
        matchResult.normalizedQuery,
      candidates:
        matchResult.candidates.map(
          toBlockedCandidate,
        ),
      guidance:
        "Do not choose a candidate automatically. Ask the customer to clarify which source-backed item or section they mean.",
    };
  }

  const candidate =
    matchResult.candidate;

  const section = findMatchedSection(
    data,
    candidate.itemId,
  );

  const item = findMatchedItem(
    section,
    candidate.itemId,
  );

  verifyMatchedCandidate(
    candidate,
    section,
    item,
  );

  return {
    status: "ready",
    context: {
      kind: "menu_item",

      business: {
        name: data.business.name,
        currency: data.business.currency,
      },

      source: {
        url: data.source.url,
        verifiedOn:
          data.source.verified_on,
      },

      query: {
        raw: matchResult.query,
        normalized:
          matchResult.normalizedQuery,
      },

      match: {
        itemId: candidate.itemId,
        itemName: candidate.itemName,
        section: candidate.section,
        matchedPhrase:
          candidate.matchedPhrase,
      },

      item: {
        itemId: item.item_id,
        name: item.name,
        description:
          item.description,
        dietary: [...item.dietary],
        options:
          item.options === undefined
            ? []
            : [...item.options],
        rawPriceText: item.price,
        pricing: item.pricing,
        descriptionPricing:
          item.description_pricing,
      },

      section: {
        name: section.section,
        note:
          section.note ?? null,
        siteHeading:
          section.site_heading ?? null,
        pricing:
          section.normalized_pricing ??
          null,
        extras:
          section.normalized_extras ??
          null,
        miniBottles:
          section.normalized_mini_bottles ??
          null,
      },
    },
  };
}