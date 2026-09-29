import type {
  MenuItemContext,
} from "../context/builder.js";

import {
  buildMenuContext,
} from "../context/builder.js";

import type {
  ClaudeAnswer,
} from "../claude/client.js";

import type {
  NormalizedZukiData,
} from "../data/transformer.js";

import type {
  MatchOptions,
} from "../matching/matcher.js";

import {
  createMenuMatcher,
} from "../matching/matcher.js";

import {
  normalizeMatchText,
} from "../matching/normalize.js";

export type ClaudeResponder = (
  context: MenuItemContext,
) => Promise<ClaudeAnswer>;

export interface AssistantServiceOptions {
  claudeResponder?: ClaudeResponder;
}

export interface AssistantMatchedItem {
  itemId: string;
  itemName: string;
  section: string;
}

export interface AssistantClarificationCandidate {
  itemId: string;
  itemName: string;
  section: string;
}

export interface AssistantAnsweredResult {
  status: "answered";
  query: string;
  source: "claude";
  text: string;
  item: AssistantMatchedItem;
  model: string;
  stopReason: string | null;
}

export interface AssistantClarificationResult {
  status: "clarification_required";
  query: string;
  source: "local";
  text: string;
  candidates: AssistantClarificationCandidate[];
}

export interface AssistantNotFoundResult {
  status: "not_found";
  query: string;
  source: "local";
  text: string;
}

export interface AssistantTransferRequiredResult {
  status: "transfer_required";
  query: string;
  source: "local";
  text: string;
  reason: string;
  item: AssistantMatchedItem;
}
export interface AssistantUnavailableResult {
  status: "unavailable";
  query: string;
  source: "local";
  text: string;
  reason:
    | "claude_not_configured"
    | "claude_request_failed"
    | "claude_response_ungrounded";
  item: AssistantMatchedItem;
}

export type AssistantResult =
  | AssistantAnsweredResult
  | AssistantClarificationResult
  | AssistantNotFoundResult
  | AssistantTransferRequiredResult
  | AssistantUnavailableResult;

export interface AssistantService {
  ask(
    query: string,
    matchOptions?: MatchOptions,
  ): Promise<AssistantResult>;
}

function formatClarificationText(
  candidates: readonly AssistantClarificationCandidate[],
): string {
  const choices = candidates.map(
    (candidate) =>
      `${candidate.itemName} from ${candidate.section}`,
  );

  if (choices.length === 0) {
    return "Could you clarify which menu item you mean?";
  }

  if (choices.length === 1) {
    return `Did you mean ${choices[0]}?`;
  }

  const lastChoice =
    choices[choices.length - 1];

  const earlierChoices =
    choices.slice(0, -1);

  return [
    "I found more than one matching menu item.",
    "Did you mean",
    `${earlierChoices.join(", ")} or ${lastChoice}?`,
  ].join(" ");
}

const QUANTITY_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseRequestedQuantity(
  value: string,
): number | undefined {
  const wordValue =
    QUANTITY_WORDS[value];

  if (wordValue !== undefined) {
    return wordValue;
  }

  if (!/^\d+$/u.test(value)) {
    return undefined;
  }

  const numericValue = Number(value);

  if (
    !Number.isSafeInteger(numericValue) ||
    numericValue < 1
  ) {
    return undefined;
  }

  return numericValue;
}

function extractRequestedQuantities(
  normalizedQuery: string,
): number[] {
  const tokens =
    normalizedQuery.split(" ");
  const quantities =
    new Set<number>();

  for (
    let index = 0;
    index < tokens.length;
    index += 1
  ) {
    const token = tokens[index];

    if (token === undefined) {
      continue;
    }

    const next = tokens[index + 1];
    const previous = tokens[index - 1];

    if (
      token === "person" ||
      token === "people" ||
      token === "persons" ||
      token === "guest" ||
      token === "guests" ||
      token === "portion" ||
      token === "portions"
    ) {
      if (previous !== undefined) {
        const quantity =
          parseRequestedQuantity(
            previous,
          );

        if (quantity !== undefined) {
          quantities.add(quantity);
        }
      }
    }

    if (
      token === "for" &&
      next !== undefined
    ) {
      const quantity =
        parseRequestedQuantity(next);

      if (quantity !== undefined) {
        quantities.add(quantity);
      }
    }
  }

  return [...quantities];
}

function requiresUnsupportedQuantityPricing(
  context: MenuItemContext,
): boolean {
  const supportedQuantities =
    context.item.pricing.options
      .map(
        (option) =>
          option.qualifiers.quantity,
      )
      .filter(
        (quantity): quantity is number =>
          quantity !== undefined,
      );

  if (supportedQuantities.length === 0) {
    return false;
  }

  const query =
    context.query.normalized;

  if (
    /\b(?:per person|per head|each|half)\b/u.test(
      query,
    )
  ) {
    return true;
  }

  const supported =
    new Set(supportedQuantities);

  const requestedQuantities =
    extractRequestedQuantities(
      query,
    );

  const mentionsQuantityUnit =
    /\b(?:person|people|persons|guest|guests|portion|portions)\b/u.test(
      query,
    );

  if (
    mentionsQuantityUnit &&
    requestedQuantities.length === 0
  ) {
    return true;
  }

  return requestedQuantities.some(
    (quantity) =>
      !supported.has(quantity),
  );
}
type ContextPricingOption =
  MenuItemContext["item"]["pricing"]["options"][number];

function normalizePricingSelector(
  value: string,
): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function queryHasPricingSelector(
  normalizedQuery: string,
  selector: string,
): boolean {
  const normalizedSelector =
    normalizePricingSelector(selector);

  if (normalizedSelector.length === 0) {
    return false;
  }

  return ` ${normalizedQuery} `.includes(
    ` ${normalizedSelector} `,
  );
}

function selectPricingOptionsForQuery(
  options: readonly ContextPricingOption[],
  normalizedQuery: string,
): ContextPricingOption[] {
  let selected = [...options];

  const qualifierKeys = [
    "variant",
    "size",
    "service_mode",
  ] as const;

  for (const key of qualifierKeys) {
    const mentioned =
      new Set<string>();

    for (const option of options) {
      const value =
        option.qualifiers[key];

      if (
        value !== undefined &&
        queryHasPricingSelector(
          normalizedQuery,
          value,
        )
      ) {
        mentioned.add(
          normalizePricingSelector(
            value,
          ),
        );
      }
    }

    if (mentioned.size > 0) {
      selected =
        selected.filter(
          (option) => {
            const value =
              option.qualifiers[key];

            return (
              value !== undefined &&
              mentioned.has(
                normalizePricingSelector(
                  value,
                ),
              )
            );
          },
        );
    }
  }

  const mentionedQuantities =
    new Set<number>();

  for (const option of options) {
    const quantity =
      option.qualifiers.quantity;
    const unit =
      option.qualifiers.unit;

    if (
      quantity === undefined ||
      unit === undefined
    ) {
      continue;
    }

    const labels = [
      `${quantity} ${unit}`,
      `${quantity} ${unit}s`,
    ];

    if (
      labels.some(
        (label) =>
          queryHasPricingSelector(
            normalizedQuery,
            label,
          ),
      )
    ) {
      mentionedQuantities.add(
        quantity,
      );
    }
  }

  if (mentionedQuantities.size > 0) {
    selected =
      selected.filter(
        (option) =>
          option.qualifiers.quantity !==
            undefined &&
          mentionedQuantities.has(
            option.qualifiers.quantity,
          ),
      );
  }

  const mentionedVolumes =
    new Set<number>();

  for (const option of options) {
    const volume =
      option.qualifiers.volume_ml;

    if (volume === undefined) {
      continue;
    }

    if (
      queryHasPricingSelector(
        normalizedQuery,
        `${volume} ml`,
      ) ||
      queryHasPricingSelector(
        normalizedQuery,
        `${volume}ml`,
      )
    ) {
      mentionedVolumes.add(volume);
    }
  }

  if (mentionedVolumes.size > 0) {
    selected =
      selected.filter(
        (option) =>
          option.qualifiers.volume_ml !==
            undefined &&
          mentionedVolumes.has(
            option.qualifiers.volume_ml,
          ),
      );
  }

  return selected;
}

function collectSupportedPriceAmounts(
  context: MenuItemContext,
): Set<number> {
  const query =
    context.query.normalized;

  const itemOptions =
    selectPricingOptionsForQuery(
      context.item.pricing.options,
      query,
    );

  const descriptionOptions =
    selectPricingOptionsForQuery(
      context.item.descriptionPricing
        ?.options ?? [],
      query,
    );

  const extraOptions =
    (
      context.section.extras
        ?.pricing_options ?? []
    ).filter(
      (option) => {
        const variant =
          option.qualifiers.variant;

        return (
          variant !== undefined &&
          queryHasPricingSelector(
            query,
            variant,
          )
        );
      },
    );

  return new Set([
    ...itemOptions.map(
      (option) =>
        option.amount_minor,
    ),
    ...descriptionOptions.map(
      (option) =>
        option.amount_minor,
    ),
    ...extraOptions.map(
      (option) =>
        option.amount_minor,
    ),
  ]);
}

// Spoken quantities ("for two") are grounded by the digits in the source data ("for 2").
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

function parseClaimedMajorAmount(
  value: string,
): number | undefined {
  const amount =
    Number(value.replace(",", "."));

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return undefined;
  }

  return Math.round(amount * 100);
}

function extractClaimedPriceAmounts(
  text: string,
  includeBareDecimals: boolean,
): number[] {
  const normalizedText =
    text.normalize("NFKC");

  const amounts = new Set<number>();

  const compoundRanges: Array<{
    start: number;
    end: number;
  }> = [];

  const addMajorAmount = (
    rawAmount: string,
  ): void => {
    const amount =
      parseClaimedMajorAmount(
        rawAmount,
      );

    if (amount !== undefined) {
      amounts.add(amount);
    }
  };

  const compoundPoundsPattern =
    /\b(\d+)\s*pounds?\s*(?:and\s*)?(\d{1,2})(?:\s*(?:p|pence)\b|(?=\s*(?:[.,!?;:]|$|\beach\b|\bper\b|\bfor\b)))/giu;

  for (const match of normalizedText.matchAll(
    compoundPoundsPattern,
  )) {
    const rawPounds = match[1];
    const rawPence = match[2];
    const startIndex = match.index;

    if (
      rawPounds === undefined ||
      rawPence === undefined ||
      startIndex === undefined
    ) {
      continue;
    }

    const pounds = Number(rawPounds);
    const pence = Number(rawPence);

    if (
      Number.isSafeInteger(pounds) &&
      pounds >= 0 &&
      Number.isSafeInteger(pence) &&
      pence >= 0 &&
      pence < 100
    ) {
      amounts.add(
        pounds * 100 + pence,
      );

      compoundRanges.push({
        start: startIndex,
        end:
          startIndex +
          match[0].length,
      });
    }
  }

  const overlapsCompoundRange = (
    match: RegExpMatchArray,
  ): boolean => {
    const startIndex = match.index;

    if (startIndex === undefined) {
      return false;
    }

    const endIndex =
      startIndex + match[0].length;

    return compoundRanges.some(
      (range) =>
        startIndex < range.end &&
        endIndex > range.start,
    );
  };

  const majorPattern =
    /(?:\u00A3\s*|GBP\s*)(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:GBP|pounds?)/giu;

  for (const match of normalizedText.matchAll(
    majorPattern,
  )) {
    if (overlapsCompoundRange(match)) {
      continue;
    }

    const rawAmount =
      match[1] ?? match[2];

    if (rawAmount !== undefined) {
      addMajorAmount(
        rawAmount,
      );
    }
  }

  const pencePattern =
    /\b(\d+)\s*(?:p|pence)\b/giu;

  for (const match of normalizedText.matchAll(
    pencePattern,
  )) {
    if (overlapsCompoundRange(match)) {
      continue;
    }

    const rawPence =
      match[1];

    if (rawPence === undefined) {
      continue;
    }

    const pence =
      Number(rawPence);

    if (
      Number.isSafeInteger(pence) &&
      pence >= 0
    ) {
      amounts.add(pence);
    }
  }

  if (includeBareDecimals) {
    const decimalPattern =
      /\b(\d+[.,]\d{1,2})\b/gu;

    for (const match of normalizedText.matchAll(
      decimalPattern,
    )) {
      const rawAmount =
        match[1];

      if (rawAmount !== undefined) {
        addMajorAmount(
          rawAmount,
        );
      }
    }
  }

  return [...amounts];
}

function hasNoncanonicalDecimalDigits(
  value: string,
): boolean {
  return /\p{Nd}/u.test(
    value.normalize("NFKC").replace(/[0-9]/gu, ""),
  );
}

export function hasUnsafeQueryCharacters(
  query: string,
): boolean {
  const letters =
    query.normalize("NFKD").match(/\p{L}/gu) ?? [];

  return (
    /\p{Cf}/u.test(query) ||
    hasNoncanonicalDecimalDigits(query) ||
    letters.some((letter) =>
      !/\p{Script=Latin}/u.test(letter) ||
      normalizeMatchText(letter).length === 0,
    )
  );
}

function hasUnsupportedPriceClaim(
  context: MenuItemContext,
  text: string,
): boolean {
  if (hasNoncanonicalDecimalDigits(text)) {
    return true;
  }

  const supported =
    collectSupportedPriceAmounts(
      context,
    );

  const priceQuery =
    /\b(?:how much|price|cost|costs|priced)\b/u.test(
      context.query.normalized,
    );

  const claimed =
    extractClaimedPriceAmounts(
      text,
      priceQuery,
    );

  if (/^(?:yes(?: it is)?|correct|thats right|that is correct)$/u.test(normalizeMatchText(text))) {
    claimed.push(...extractClaimedPriceAmounts(context.query.raw, true));
  }

  return claimed.some(
    (amount) =>
      !supported.has(amount),
  );
}
const RESPONSE_GLUE_TERMS = new Set([
  "a",
  "an",
  "and",
  "answer",
  "appears",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "come",
  "could",
  "comes",
  "contain",
  "contains",
  "cost",
  "costs",
  "do",
  "find",
  "for",
  "from",
  "has",
  "have",
  "here",
  "in",
  "include",
  "includes",
  "is",
  "it",
  "listed",
  "no",
  "its",
  "of",
  "offer",
  "offers",
  "on",
  "option",
  "options",
  "or",
  "our",
  "per",
  "person",
  "people",
  "pound",
  "pounds",
  "pence",
  "price",
  "priced",
  "plus",
  "serve",
  "served",
  "serves",
  "there",
  "serving",
  "servings",
  "the",
  "this",
  "to",
  "we",
  "with",
  "yes",
  "you",
  "your",
]);

function extractGroundingTerms(
  value: string,
): string[] {
  const normalized =
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/\u2019/gu, "'")
      .toLowerCase();

  return (
    normalized.match(
      /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu,
    ) ?? []
  );
}

function collectGroundingTerms(
  value: unknown,
  terms: Set<string>,
): void {
  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    for (const term of extractGroundingTerms(
      String(value),
    )) {
      terms.add(term);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectGroundingTerms(
        entry,
        terms,
      );
    }

    return;
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    for (const entry of Object.values(
      value as Record<string, unknown>,
    )) {
      collectGroundingTerms(
        entry,
        terms,
      );
    }
  }
}

function hasSupportedBundlePeopleClaims(
  context: MenuItemContext,
  text: string,
): boolean {
  const normalized = text.normalize("NFKC");
  const peopleTerms = normalized.match(/\b(?:person|people)\b/giu) ?? [];
  const quantity = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;
  const price = "(?:\\u00a3|\\bGBP)\\s*(\\d+(?:[.,]\\d{1,2})?)";
  const pairs = [
    // "\u00a329.95 for 2 people"
    ...[...normalized.matchAll(
      new RegExp(`${price}\\s+for\\s+${quantity}\\s+(?:person|people)\\b`, "giu"),
    )].map((match) => ({ amount: match[1], people: match[2] })),
    // "for two people is \u00a329.95"
    ...[...normalized.matchAll(
      new RegExp(`\\bfor\\s+${quantity}\\s+(?:person|people)\\s+(?:is|are|costs?)\\s+${price}`, "giu"),
    )].map((match) => ({ amount: match[2], people: match[1] })),
  ];

  return (
    peopleTerms.length > 0 &&
    pairs.length === peopleTerms.length &&
    pairs.every((pair) => {
      const people = pair.people?.toLowerCase() ?? "";

      return context.item.pricing.options.some((option) =>
        option.kind === "bundle" &&
        option.qualifiers.quantity === Number(NUMBER_WORDS[people] ?? people) &&
        option.amount_minor === parseClaimedMajorAmount(pair.amount ?? ""),
      );
    })
  );
}

function hasUnsupportedResponseTerm(
  context: MenuItemContext,
  text: string,
): boolean {
  const confirmationLeadIn =
    /^\s*yes\s*,?\s+(?:that['\u2019]s|that is)\s+correct\b/iu;
  let groundingText = text;

  if (confirmationLeadIn.test(text.normalize("NFKC"))) {
    const queryPrices = extractClaimedPriceAmounts(context.query.raw, true);
    const supportedPrices = collectSupportedPriceAmounts(context);
    const asksConfirmation =
      /\b(?:right|correct)$|^(?:is|does)\b/u.test(context.query.normalized);

    if (
      !asksConfirmation ||
      queryPrices.length === 0 ||
      queryPrices.some((amount) => !supportedPrices.has(amount))
    ) {
      return true;
    }

    groundingText = text.normalize("NFKC").replace(confirmationLeadIn, "");
  }

  const grounded =
    new Set<string>();
  const response = normalizeMatchText(text);

  collectGroundingTerms(
    context.business,
    grounded,
  );
  collectGroundingTerms(
    context.item,
    grounded,
  );
  collectGroundingTerms(
    {
      name: context.section.name,
      note: context.section.note,
      siteHeading: context.section.siteHeading,
      pricing: context.section.pricing,
      extras: context.section.extras?.pricing_options.filter(
        (option) =>
          !/\b(?:contains?|includes?|has|comes? with)\b/u.test(response) &&
          option.qualifiers.variant !== undefined &&
          queryHasPricingSelector(
            context.query.normalized,
            option.qualifiers.variant,
          ),
      ),
    },
    grounded,
  );

  const responseWithoutConfirmation =
    normalizeMatchText(
      text.normalize("NFKC").replace(
        /^\s*no\s*[,.:;!?]\s*/iu,
        "",
      ),
    );
  const itemTerms = new Set<string>();

  collectGroundingTerms(context.item, itemTerms);

  if (
    /\bno\b/u.test(responseWithoutConfirmation) ||
    (/\bfor here\b/u.test(response) &&
      !context.item.pricing.options.some(
        (option) => option.qualifiers.service_mode !== undefined,
      )) ||
    (/\bper\s+(?:person|head)\b/u.test(response) &&
      !/\bper\s+(?:person|head)\b/u.test(
        normalizeMatchText(context.item.rawPriceText),
      )) ||
    (/\b(?:person|people)\b/u.test(response) &&
      !itemTerms.has("person") &&
      !itemTerms.has("people") &&
      !hasSupportedBundlePeopleClaims(context, text))
  ) {
    return true;
  }

  return extractGroundingTerms(
    groundingText,
  ).some(
    (term) =>
      !/^\d+p$/u.test(term) &&
      !grounded.has(term) &&
      !itemTerms.has(NUMBER_WORDS[term] ?? "") &&
      !RESPONSE_GLUE_TERMS.has(term),
  );
}
function hasUnsupportedResponseFormatting(
  text: string,
): boolean {
  const normalized =
    text.normalize("NFKC");

  return (
    /[`*_~<>\[\]\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized) ||
    /^\s*(?:#+|[-+]\s|\d+[.)]\s)/mu.test(
      normalized,
    ) ||
    /^\s*(?:=+|-+)\s*$/mu.test(
      normalized,
    ) ||
    /[\p{So}\p{Emoji_Modifier}\u00B7\u200D\u20E3\uFE0E\uFE0F\u2022\u2023\u2027\u2043\u204C\u204D\u2218\u2219]/u.test(
      normalized,
    )
  );
}

export function requiresLiveAvailabilityVerification(
  normalizedQuery: string,
  itemName: string = "",
  staticOptionKinds: readonly string[] = [],
): boolean {
  const query =
    normalizedQuery.replace(
      /\b(?:available|left|remaining)\s+(?:on|in)\s+(?:the\s+)?menu\b/gu,
      "on the menu",
    ).replace(
      /\b(options|sizes|variants)\s+are\s+available\b/gu,
      (phrase, kind: string) =>
        staticOptionKinds.includes(kind) ? `${kind} on the menu` : phrase,
    );

  const explicitLiveStock =
    /\b(?:in stock|out of stock|stock level|sold out|run out)\b/u.test(
      query,
    );

  const currentTimeCue =
    /\b(?:right now|now|today|currently|at (?:the|this) moment|at present|presently|this minute|immediately|straight away|on hand)\b/u.test(query);

  const temporalAvailability =
    currentTimeCue &&
    /\b(?:available|availability)\b/u.test(
      query,
    );

  const temporalAcquisition =
    currentTimeCue &&
    /\b(?:have|got|serve|serving|get|order|buy)\b/u.test(
      query,
    );

  const stillAvailable =
    /\bstill\s+(?:have|got)\b/u.test(
      query,
    );

  const bareAvailability =
    /\bavailable\b/u.test(
      query,
    );

  const remainingStock =
    (
      /\b(?:have|got|any|anything|enough|plenty|there)\b.{0,64}\b(?:left|remaining)\b/u.test(
        query,
      ) ||
      /\bremaining\b/u.test(query) ||
      /\b(?:left|remaining)\b.{0,64}\b(?:have|got|any|there)\b/u.test(
        query,
      )
    ) &&
    !/\b(?:left|remaining)\s+(?:on|in)\s+(?:the\s+)?menu\b/u.test(
      query,
    );

  const depletedStock =
    /\b(?:are|is)\s+(?:you|there)\b.{0,24}\b(?:(?:completely|almost|nearly)\s+)?out of\b/u.test(
      query,
    ) &&
    !/\bout of\s+(?:curiosity|interest)\b/u.test(
      query,
    );

  const depletingStock =
    /\b(?:running|getting)\s+low\b/u.test(
      query,
    ) ||
    /\blow\s+on\b/u.test(
      query,
    ) ||
    /\b(?:selling|running)\s+out\b/u.test(
      query,
    ) ||
    /\bsells?\s+out\b/u.test(
      query,
    ) ||
    /\b(?:nearly|almost)\s+gone\b/u.test(
      query,
    ) ||
    /\b(?:nearly|almost)\s+out\b/u.test(query) ||
    /\b(?:is|are)\b.{0,48}\blow(?:\s+on\s+stock)?$/u.test(
      query,
    );

  const stillLiveAvailability =
    /\bstill\s+available\b/u.test(
      query,
    ) &&
    !/\bstill\s+available\s+(?:on|in)\s+(?:the\s+)?menu\b/u.test(
      query,
    );

  const abbreviatedCurrentAvailability =
    /\brn\b/u.test(query) &&
    /\b(?:have|got|available|stock|get|order|serve|serving)\b/u.test(
      query,
    );

  const futureTimeCue =
    /\b(?:tonight|later(?:\s+today)?|tomorrow)\b/u.test(query) ||
    /\bwhen\s+(?:i|we)\s+(?:arrive|get\s+there|come\s+in|stop\s+by|visit)\b/u.test(
      query,
    ) ||
    /\bin\s+(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+|half\s+an?|a\s+couple\s+of)\s+(?:min(?:ute)?s?|hours?)\b/u.test(
      query,
    ) ||
    /\b(?:this|next)\s+(?:morning|afternoon|evening|weekend|week|month)\b/u.test(
      query,
    ) ||
    /\b(?:on|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u.test(
      query,
    ) ||
    /\b(?:at|around|by|before|after)\s+(?:\d{1,2}(?:\s+\d{2})?(?:\s*(?:am|pm))?|noon|lunchtime|midnight)\b/u.test(
      query,
    );

  const futureAvailability =
    futureTimeCue &&
    /\b(?:have|got|available|get|order|buy|serve|serving)\b/u.test(
      query,
    );

  const futureAcquisition =
    /\bwill\s+(?:you|we|i)\s+(?:have|get|serve|buy)\b/u.test(query) ||
    /\b(?:will|would|could)\b.{0,64}\bbe\s+(?:available|on\s+(?:the\s+)?menu)\b/u.test(query) ||
    /\b(?:will|would|could)\s+there\s+be\b/u.test(query) ||
    /\b(?:going|expect(?:ing)?|plan(?:ning)?)\s+to\s+(?:have|serve|stock|offer)\b/u.test(query);

  const historicalMenuClaim =
    /\bdid\s+you\s+(?:have|serve|sell|offer|stock)\b/u.test(query) ||
    /\b(?:was|were)\b.{0,64}\b(?:on the menu|available)\b/u.test(query);

  const temporalPriceClaim =
    /\b(?:price|cost|costs|much|\d+)\b/u.test(query) &&
    (
      /\b(?:will|would|was|were|did)\b.{0,64}\b(?:cost|price|priced|\d+)\b/u.test(query) ||
      /\b(?:yesterday|last (?:week|month|year))\b/u.test(query) ||
      (futureTimeCue && !/\bfor later\b/u.test(query))
    );

  const temporalOptionAvailability =
    (futureTimeCue || currentTimeCue) &&
    /\b(?:options|sizes|variants)\s+are\s+available\b/u.test(normalizedQuery);

  const abbreviatedTimeAvailability =
    itemName.length > 0 &&
    (futureTimeCue || currentTimeCue) &&
    !/\b(?:had|was|were|did|price|cost|costs|much|menu)\b/u.test(query);

  const availabilityCommitment =
    /\bguarantee\b/u.test(query) ||
    /\bmake\s+sure\b.{0,64}\bavailable\b/u.test(
      query,
    ) ||
    /\bdefinitely\s+(?:get|have|order)\b/u.test(
      query,
    );

  const operationalHoldRequest =
    /\b(?:save|hold|reserve)\b/u.test(
      query,
    ) ||
    /\b(?:put|set)\b.{0,64}\baside\b/u.test(
      query,
    ) ||
    /\bkeep\b.{0,64}\bfor\s+(?:me|us)\b/u.test(
      query,
    );

  const explicitRemainingQuantity =
    /\b(?:only|just)\s+(?:one|two|three|\d+)\b.{0,48}\bleft\b/u.test(
      query,
    ) ||
    /\bhow\s+much\b.{0,64}\bleft\b/u.test(
      query,
    ) ||
    /\bhow\s+many\b.{0,64}\b(?:left|remaining|have)\b/u.test(query) ||
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|a\s+few|some)\s+left\b/u.test(
      query,
    );

  const lastUnitStock =
    /\b(?:is|are)\s+(?:this|that|it)\s+(?:the\s+)?last\b/u.test(
      query,
    ) ||
    /\b(?:the\s+)?last\b.{0,48}\bleft\b/u.test(
      query,
    ) ||
    /\blast\s+one\b/u.test(query) ||
    (itemName.length > 0 &&
      query.includes(`last ${normalizeMatchText(itemName)}`) &&
      !/\b(?:had|was|time)\b/u.test(query)
    );

  return (
    historicalMenuClaim ||
    temporalPriceClaim ||
    explicitLiveStock ||
    temporalAvailability ||
    temporalAcquisition ||
    stillAvailable ||
    bareAvailability ||
    remainingStock ||
    depletedStock ||
    depletingStock ||
    stillLiveAvailability ||
    abbreviatedCurrentAvailability ||
    futureAvailability ||
    temporalOptionAvailability ||
    futureAcquisition ||
    abbreviatedTimeAvailability ||
    availabilityCommitment ||
    operationalHoldRequest ||
    explicitRemainingQuantity ||
    lastUnitStock
  );
}

function createMatchedItem(
  context: MenuItemContext,
): AssistantMatchedItem {
  return {
    itemId: context.item.itemId,
    itemName: context.item.name,
    section: context.section.name,
  };
}

export function createAssistantService(
  data: NormalizedZukiData,
  options: AssistantServiceOptions = {},
): AssistantService {
  const match =
    createMenuMatcher(data);

  return {
    async ask(
      query: string,
      matchOptions: MatchOptions = {},
    ): Promise<AssistantResult> {
      const matchResult =
        match(query, matchOptions);

      const contextResult =
        buildMenuContext(
          data,
          matchResult,
        );

      if (
        contextResult.status === "blocked"
      ) {
        if (
          contextResult.reason === "unknown"
        ) {
          return {
            status: "not_found",
            query,
            source: "local",
            text:
              "I couldn't identify a source-backed menu item matching that request.",
          };
        }

        const candidates =
          contextResult.candidates.map(
            (candidate) => ({
              itemId:
                candidate.itemId,
              itemName:
                candidate.itemName,
              section:
                candidate.section,
            }),
          );

        return {
          status:
            "clarification_required",
          query,
          source: "local",
          text:
            formatClarificationText(
              candidates,
            ),
          candidates,
        };
      }

      const context =
        contextResult.context;

      const item =
        createMatchedItem(
          context,
        );

      if (
        hasUnsafeQueryCharacters(query) ||
        requiresLiveAvailabilityVerification(
          context.query.normalized,
          context.item.name,
          [
            "options",
            ...(context.item.pricing.options.some((option) =>
              option.qualifiers.size !== undefined,
            ) ? ["sizes"] : []),
            ...(context.item.pricing.options.some((option) =>
              option.qualifiers.variant !== undefined,
            ) ? ["variants"] : []),
          ],
        )
      ) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text:
            "The current menu does not establish the requested availability or time-specific menu facts.",
          reason:
            "The request cannot be verified from current menu information.",
          item,
        };
      }

      if (
        requiresUnsupportedQuantityPricing(
          context,
        )
      ) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text:
            "The available menu data does not establish a price or serving option for that requested quantity.",
          reason:
            "The requested quantity or derived price is not explicitly supported by the source pricing.",
          item,
        };
      }

      if (
        options.claudeResponder ===
        undefined
      ) {
        return {
          status: "unavailable",
          query,
          source: "local",
          text:
            "The menu item was identified, but the Claude API is not configured yet.",
          reason:
            "claude_not_configured",
          item,
        };
      }

      let claudeAnswer: ClaudeAnswer;

      try {
        claudeAnswer =
          await options.claudeResponder(
            context,
          );
      } catch {
        return {
          status: "unavailable",
          query,
          source: "local",
          text:
            "The menu item was identified, but the assistant service is temporarily unavailable.",
          reason:
            "claude_request_failed",
          item,
        };
      }

      if (
        hasUnsupportedPriceClaim(
          context,
          claudeAnswer.text,
        )
      ) {
        return {
          status: "unavailable",
          query,
          source: "local",
          text:
            "I could not verify that price against the current menu data.",
          reason:
            "claude_response_ungrounded",
          item,
        };
      }
      if (
        hasUnsupportedResponseTerm(
          context,
          claudeAnswer.text,
        ) ||
        hasUnsupportedResponseFormatting(
          claudeAnswer.text,
        )
      ) {
        return {
          status: "unavailable",
          query,
          source: "local",
          text:
            "I could not verify that response against the current menu data.",
          reason:
            "claude_response_ungrounded",
          item,
        };
      }
      return {
        status: "answered",
        query,
        source: "claude",
        text: claudeAnswer.text,
        item,
        model: claudeAnswer.model,
        stopReason:
          claudeAnswer.stopReason,
      };
    },
  };
}
