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
  const amounts = new Set<number>();

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

  const majorPattern =
    /(?:\u00A3\s*|GBP\s*)(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:GBP|pounds?)/giu;

  for (const match of text.matchAll(
    majorPattern,
  )) {
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

  for (const match of text.matchAll(
    pencePattern,
  )) {
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

    for (const match of text.matchAll(
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

function hasUnsupportedPriceClaim(
  context: MenuItemContext,
  text: string,
): boolean {
  const supported =
    collectSupportedPriceAmounts(
      context,
    );

  const priceQuery =
    /\b(?:how much|price|cost|costs|priced)\b/u.test(
      context.query.normalized,
    );

  return extractClaimedPriceAmounts(
    text,
    priceQuery,
  ).some(
    (amount) =>
      !supported.has(amount),
  );
}
const RESPONSE_GLUE_TERMS = new Set([
  "a",
  "an",
  "and",
  "answer",
  "are",
  "as",
  "at",
  "be",
  "by",
  "come",
  "comes",
  "contain",
  "contains",
  "cost",
  "costs",
  "for",
  "from",
  "has",
  "have",
  "in",
  "include",
  "includes",
  "is",
  "it",
  "its",
  "of",
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
  "price",
  "priced",
  "serve",
  "served",
  "serves",
  "serving",
  "servings",
  "the",
  "this",
  "to",
  "with",
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

function hasUnsupportedResponseTerm(
  context: MenuItemContext,
  text: string,
): boolean {
  const grounded =
    new Set<string>();

  collectGroundingTerms(
    context.business,
    grounded,
  );
  collectGroundingTerms(
    context.item,
    grounded,
  );
  collectGroundingTerms(
    context.section,
    grounded,
  );

  return extractGroundingTerms(
    text,
  ).some(
    (term) =>
      !grounded.has(term) &&
      !RESPONSE_GLUE_TERMS.has(term),
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