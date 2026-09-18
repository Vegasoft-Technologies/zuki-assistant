import {
  answerMenuItemWithClaude,
  createClaudeClientFromEnvironment,
} from "./claude/client.js";

import type {
  ClaudeResponder,
} from "./assistant/service.js";

import {
  createKnowledgeSafeAssistantService,
} from "./assistant/knowledge-safe-service.js";

import {
  loadZukiData,
} from "./data/loader.js";

import {
  transformZukiData,
} from "./data/transformer.js";

function createOptionalClaudeResponder():
  | ClaudeResponder
  | undefined {
  const apiKey =
    process.env["ANTHROPIC_API_KEY"]?.trim();

  if (
    apiKey === undefined ||
    apiKey.length === 0
  ) {
    return undefined;
  }

  const configured =
    createClaudeClientFromEnvironment();

  return async (context) =>
    answerMenuItemWithClaude({
      client: configured.client,
      model: configured.model,
      context,
    });
}

function readQueryFromArguments(): string {
  return process.argv
    .slice(2)
    .join(" ")
    .trim();
}

async function main(): Promise<void> {
  const query =
    readQueryFromArguments();

  if (query.length === 0) {
    console.error(
      'Usage: npm run ask -- "How much is a Doppio?"',
    );

    process.exitCode = 1;
    return;
  }

  const sourceData =
    await loadZukiData();

  const normalizedData =
    transformZukiData(sourceData);

  const claudeResponder =
    createOptionalClaudeResponder();

  const assistant =
    createKnowledgeSafeAssistantService(
      normalizedData,
      claudeResponder === undefined
        ? {}
        : {
            claudeResponder,
          },
    );

  const result =
    await assistant.lookup(query);

  switch (result.status) {
    case "answered":
      console.log(result.text);
      return;

    case "clarification_required":
      console.log(result.text);
      return;

    case "transfer_required":
      console.log(result.text);
      return;
    case "unavailable":
      console.log(result.text);

      if (
        result.reason ===
        "claude_not_configured"
      ) {
        console.log(
          "Set ANTHROPIC_API_KEY in .env to enable live Claude answers.",
        );
      }

      return;
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(
      `${error.name}: ${error.message}`,
    );
  } else {
    console.error(
      "Unexpected application error.",
    );
  }

  process.exitCode = 1;
});