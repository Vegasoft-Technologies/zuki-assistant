import {
  answerMenuItemWithClaude,
  createClaudeClientFromEnvironment,
} from "./claude/client.js";

import type { ClaudeResponder } from "./assistant/service.js";

import { createKnowledgeSafeAssistantService } from "./assistant/knowledge-safe-service.js";

import { loadZukiData } from "./data/loader.js";

import { transformZukiData } from "./data/transformer.js";

import { createApiServer } from "./api/server.js";

function createOptionalClaudeResponder(): ClaudeResponder | undefined {
  const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    return undefined;
  }

  const configured = createClaudeClientFromEnvironment();

  return async (context) =>
    answerMenuItemWithClaude({
      client: configured.client,
      model: configured.model,
      context,
    });
}

async function main(): Promise<void> {
  console.log("Starting server...");

  const sourceData = await loadZukiData();
  const normalizedData = transformZukiData(sourceData);
  const claudeResponder = createOptionalClaudeResponder();

  const assistant = createKnowledgeSafeAssistantService(
    normalizedData,
    claudeResponder === undefined ? {} : { claudeResponder },
  );

  const app = createApiServer(assistant);

  const portStr = process.env.PORT || "3000";
  const port = parseInt(portStr, 10);

  app.listen(port, "0.0.0.0", () => {
    console.log(`API Server is running on port ${port}`);
    console.log(`Health check: /health`);
  });
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`);
  } else {
    console.error("Unexpected application error.");
  }
  process.exitCode = 1;
});
