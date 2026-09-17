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

export interface AssistantUnavailableResult {
  status: "unavailable";
  query: string;
  source: "local";
  text: string;
  reason:
    | "claude_not_configured"
    | "claude_request_failed";
  item: AssistantMatchedItem;
}

export type AssistantResult =
  | AssistantAnsweredResult
  | AssistantClarificationResult
  | AssistantNotFoundResult
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