import type {
  AssistantResult,
  AssistantServiceOptions,
} from "./service.js";

import {
  createAssistantService,
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
      const knowledge =
        lookupBusinessKnowledge(
          data,
          query,
        );

      if (
        knowledge.status === "known" &&
        knowledge.topic === "vegan"
      ) {
        const menuMatch =
          menuMatcher(
            query,
            matchOptions,
          );

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
