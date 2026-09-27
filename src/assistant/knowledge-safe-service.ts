import type {
  AssistantResult,
  AssistantServiceOptions,
} from "./service.js";

import {
  createAssistantService,
  hasUnsafeQueryCharacters,
  requiresLiveAvailabilityVerification,
} from "./service.js";

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

import type {
  KnowledgeResult,
} from "../knowledge/router.js";

import {
  lookupBusinessKnowledge,
} from "../knowledge/router.js";

type KnowledgeTopic =
  NonNullable<KnowledgeResult["topic"]>;

export interface LocalKnowledgeAnswer {
  status: "answered";
  query: string;
  source: "local";
  text: string;
  topic: KnowledgeTopic;
}

export interface TransferRequiredResult {
  status: "transfer_required";
  query: string;
  source: "local";
  text: string;
  topic?: KnowledgeTopic;
  reason: string;
}

export type KnowledgeSafeResult =
  | Exclude<
      AssistantResult,
      { status: "not_found" }
    >
  | LocalKnowledgeAnswer
  | TransferRequiredResult;

export interface KnowledgeSafeAssistantService {
  lookup(
    query: string,
    matchOptions?: MatchOptions,
  ): Promise<KnowledgeSafeResult>;
}

const TRANSFER_TEXT =
  "I'm not sure about that. Let me transfer you to someone who can help.";

export function createKnowledgeSafeAssistantService(
  data: NormalizedZukiData,
  options: AssistantServiceOptions = {},
): KnowledgeSafeAssistantService {
  const menuMatcher =
    createMenuMatcher(data);

  const menuAssistant =
    createAssistantService(
      data,
      options,
    );

  return {
    async lookup(
      query: string,
      matchOptions: MatchOptions = {},
    ): Promise<KnowledgeSafeResult> {
      if (hasUnsafeQueryCharacters(query)) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text: TRANSFER_TEXT,
          reason:
            "The request contains characters that cannot be interpreted safely.",
        };
      }

      const knowledge =
        lookupBusinessKnowledge(
          data,
          query,
        );

      const menuMatch = menuMatcher(query, matchOptions);
      const normalizedQuery = normalizeMatchText(query);
      const coordinatedRequest = normalizedQuery.match(
        /^(?:do you(?: guys)? (?:have|serve|sell)|how much (?:is|are)) (?:a |an |the )?(.+?) (?:and|or) (.+)$/u,
      );
      const firstProduct = coordinatedRequest?.[1];
      const secondRequest = coordinatedRequest?.[2];
      let unsupportedSecondProduct = false;

      if (
        menuMatch.status === "matched" &&
        firstProduct === menuMatch.candidate.normalizedMatchedPhrase &&
        secondRequest !== undefined
      ) {
        const secondProduct = secondRequest.replace(
          /^(?:do you(?: guys)? (?:have|serve|sell)|how much (?:is|are))\s+/u,
          "",
        ).replace(/^(?:a|an|the)\s+/u, "").replace(/\s+please$/u, "");
        const explicitSecondQuestion = secondProduct !== secondRequest;

        unsupportedSecondProduct =
          (explicitSecondQuestion || /^[a-z]+$/u.test(secondProduct)) &&
          !/^(?:it|this|that|these|those|them|one|please|thanks)$/u.test(secondProduct) &&
          menuMatcher(secondProduct, matchOptions).status === "unknown";
      }

      const explicitMenuQuestion =
        /\band\s+(?:do you(?: guys)? (?:have|serve|sell)|how much (?:is|are)|what(?:s| is) the price)\b/u.test(normalizedQuery);

      if (
        unsupportedSecondProduct ||
        (knowledge.status === "known" &&
          ["location", "card", "parking", "dog", "opening_hours"].includes(knowledge.topic ?? "") &&
          explicitMenuQuestion)
      ) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text: TRANSFER_TEXT,
          reason:
            "The combined requests cannot be answered safely from a single verified fact.",
        };
      }

      if (knowledge.status === "known") {
        if (
          (menuMatch.status === "matched" || knowledge.topic === "vegan") &&
          query.split(/[!?;\n]+|(?<!\d)\.(?!\d)/u).some((clause) => {
            const clauseMatch = menuMatcher(clause, matchOptions);
            let itemPhrase = "";

            if (clauseMatch.status === "matched") {
              itemPhrase = clauseMatch.candidate.matchedPhrase;
            } else if (knowledge.topic === "vegan") {
              itemPhrase = "vegan";
            } else if (
              menuMatch.status === "matched" &&
              lookupBusinessKnowledge(data, clause).status === "no_match"
            ) {
              itemPhrase = menuMatch.candidate.matchedPhrase;
            }

            const normalizedClause = normalizeMatchText(clause);
            const availabilityQuery = knowledge.topic === "opening_hours"
              ? normalizedClause.replace(
                  /^(?:(?:(?:what time|when)\s+)?(?:are|do) you|is the cafe)\s+(?:open|close)\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u,
                  "",
                ).trim()
              : normalizedClause;

            return requiresLiveAvailabilityVerification(
              availabilityQuery,
              itemPhrase,
            );
          })
        ) {
          return {
            status: "transfer_required",
            query,
            source: "local",
            text: TRANSFER_TEXT,
            reason:
              "The request cannot be verified from current menu information.",
          };
        }
      }

      if (
        knowledge.status === "known" &&
        knowledge.topic === "vegan"
      ) {
        if (
          menuMatch.status === "matched" &&
          menuMatch.candidate.item.dietary?.includes("vegan") === true
        ) {
          const menuResult =
            await menuAssistant.ask(
              query,
              matchOptions,
            );

          if (
            menuResult.status === "not_found"
          ) {
            return {
              status: "transfer_required",
              query,
              source: "local",
              text: TRANSFER_TEXT,
              reason:
                "No source-backed answer was found for the request.",
            };
          }

          return menuResult;
        }

        if (
          menuMatch.status !== "unknown"
        ) {
          return {
            status: "transfer_required",
            query,
            source: "local",
            text: TRANSFER_TEXT,
            topic: "vegan",
            reason:
              "The request refers to a specific menu item, so the generic vegan list cannot establish the answer.",
          };
        }
      }

      if (
        knowledge.status === "known"
      ) {
        if (
          knowledge.topic === undefined ||
          knowledge.answer === undefined
        ) {
          return {
            status: "transfer_required",
            query,
            source: "local",
            text: TRANSFER_TEXT,
            reason:
              "Knowledge result was incomplete.",
          };
        }

        return {
          status: "answered",
          query,
          source: "local",
          text: knowledge.answer,
          topic: knowledge.topic,
        };
      }

      if (
        knowledge.status ===
        "transfer_required"
      ) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text: TRANSFER_TEXT,
          ...(knowledge.topic === undefined
            ? {}
            : { topic: knowledge.topic }),
          reason:
            knowledge.reason ??
            "The requested information is not verified.",
        };
      }

      const menuResult =
        await menuAssistant.ask(
          query,
          matchOptions,
        );

      if (
        menuResult.status === "not_found"
      ) {
        return {
          status: "transfer_required",
          query,
          source: "local",
          text: TRANSFER_TEXT,
          reason:
            "No source-backed answer was found for the request.",
        };
      }

      return menuResult;
    },
  };
}
