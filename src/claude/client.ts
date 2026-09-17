import Anthropic from "@anthropic-ai/sdk";

import type {
  MenuItemContext,
} from "../context/builder.js";

export interface ClaudeEnvironmentConfig {
  apiKey: string;
  model: string;
}

export interface ConfiguredClaudeClient {
  client: Anthropic;
  model: string;
}

export interface ClaudePromptPayload {
  system: string;
  user: string;
}

export interface ClaudeAnswer {
  text: string;
  model: string;
  stopReason: string | null;
}

export interface AnswerMenuItemInput {
  client: Anthropic;
  model: string;
  context: MenuItemContext;
  maxTokens?: number;
}

export class ClaudeConfigurationError extends Error {
  public constructor(
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClaudeConfigurationError";
  }
}

export class ClaudeRequestError extends Error {
  public constructor(
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClaudeRequestError";
  }
}

export class ClaudeResponseError extends Error {
  public constructor(
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClaudeResponseError";
  }
}

function requireNonEmptyValue(
  value: string | undefined,
  variableName: string,
): string {
  const trimmed = value?.trim();

  if (
    trimmed === undefined ||
    trimmed.length === 0
  ) {
    throw new ClaudeConfigurationError(
      `${variableName} is required but is not configured.`,
    );
  }

  return trimmed;
}

export function readClaudeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeEnvironmentConfig {
  return {
    apiKey: requireNonEmptyValue(
      env["ANTHROPIC_API_KEY"],
      "ANTHROPIC_API_KEY",
    ),

    model: requireNonEmptyValue(
      env["CLAUDE_MODEL"],
      "CLAUDE_MODEL",
    ),
  };
}

export function createClaudeClient(
  apiKey: string,
): Anthropic {
  const normalizedApiKey =
    apiKey.trim();

  if (normalizedApiKey.length === 0) {
    throw new ClaudeConfigurationError(
      "ANTHROPIC_API_KEY must not be empty.",
    );
  }

  return new Anthropic({
    apiKey: normalizedApiKey,
  });
}

export function createClaudeClientFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredClaudeClient {
  const config =
    readClaudeEnvironment(env);

  return {
    client: createClaudeClient(
      config.apiKey,
    ),
    model: config.model,
  };
}

export function buildClaudePromptPayload(
  context: MenuItemContext,
): ClaudePromptPayload {
  const system = [
    "You are the customer-facing assistant for Zuki's Caffetteria.",
    "Answer only from the source-backed context provided in the user message.",
    "Do not invent menu items, prices, ingredients, dietary claims, availability, sizes, service modes, or options.",
    "Treat raw source text and structured pricing as authoritative only for what they explicitly state.",
    "If a pricing option contains unresolved ambiguity, do not infer what an unlabeled price means.",
    "If the supplied context is insufficient to answer the customer's exact question, say that the available source data does not establish the answer.",
    "Keep the answer concise, natural, and suitable for a cafe customer.",
  ].join(" ");

  const user = [
    "CUSTOMER QUERY:",
    context.query.raw,
    "",
    "SOURCE-BACKED CONTEXT:",
    JSON.stringify(context, null, 2),
  ].join("\n");

  return {
    system,
    user,
  };
}

function validateMaxTokens(
  maxTokens: number,
): number {
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens <= 0
  ) {
    throw new ClaudeConfigurationError(
      "maxTokens must be a positive integer.",
    );
  }

  return maxTokens;
}

export async function answerMenuItemWithClaude(
  input: AnswerMenuItemInput,
): Promise<ClaudeAnswer> {
  const model = requireNonEmptyValue(
    input.model,
    "CLAUDE_MODEL",
  );

  const maxTokens =
    validateMaxTokens(
      input.maxTokens ?? 300,
    );

  const prompt =
    buildClaudePromptPayload(
      input.context,
    );

  let response;

  try {
    response =
      await input.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: prompt.system,
        messages: [
          {
            role: "user",
            content: prompt.user,
          },
        ],
      });
  } catch (error: unknown) {
    throw new ClaudeRequestError(
      "Claude API request failed.",
      { cause: error },
    );
  }

  const textParts: string[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    }
  }

  const text =
    textParts.join("\n").trim();

  if (text.length === 0) {
    throw new ClaudeResponseError(
      "Claude returned no text content.",
    );
  }

  return {
    text,
    model,
    stopReason:
      response.stop_reason,
  };
}