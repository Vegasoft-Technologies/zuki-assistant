import assert from "node:assert/strict";
import test from "node:test";

import {
  ClaudeConfigurationError,
  ClaudeRequestError,
  ClaudeResponseError,
  answerMenuItemWithClaude,
  buildClaudePromptPayload,
  readClaudeEnvironment,
} from "../dist/claude/client.js";

import {
  buildMenuContext,
} from "../dist/context/builder.js";

import {
  loadZukiData,
} from "../dist/data/loader.js";

import {
  transformZukiData,
} from "../dist/data/transformer.js";

import {
  createMenuMatcher,
} from "../dist/matching/matcher.js";

const sourceData =
  await loadZukiData();

const normalizedData =
  transformZukiData(sourceData);

const match =
  createMenuMatcher(normalizedData);

const contextResult =
  buildMenuContext(
    normalizedData,
    match(
      "How much is a Doppio?",
    ),
  );

assert.equal(
  contextResult.status,
  "ready",
);

if (
  contextResult.status !== "ready"
) {
  throw new Error(
    "Expected a ready Doppio context for Claude tests.",
  );
}

const doppioContext =
  contextResult.context;

test(
  "missing Anthropic API key fails configuration validation",
  () => {
    assert.throws(
      () =>
        readClaudeEnvironment({
          CLAUDE_MODEL:
            "test-model",
        }),
      (error) => {
        assert.ok(
          error instanceof
            ClaudeConfigurationError,
        );

        assert.match(
          error.message,
          /ANTHROPIC_API_KEY/,
        );

        return true;
      },
    );
  },
);

test(
  "missing Claude model fails configuration validation",
  () => {
    assert.throws(
      () =>
        readClaudeEnvironment({
          ANTHROPIC_API_KEY:
            "dummy-key",
        }),
      (error) => {
        assert.ok(
          error instanceof
            ClaudeConfigurationError,
        );

        assert.match(
          error.message,
          /CLAUDE_MODEL/,
        );

        return true;
      },
    );
  },
);

test(
  "Claude prompt contains only source-backed selected context",
  () => {
    const prompt =
      buildClaudePromptPayload(
        doppioContext,
      );

    assert.match(
      prompt.system,
      /Answer only from the source-backed context/,
    );

    assert.match(
      prompt.system,
      /Do not invent/,
    );

    assert.match(
      prompt.user,
      /How much is a Doppio\?/,
    );

    assert.match(
      prompt.user,
      /Espresso \/ Doppio/,
    );

    assert.match(
      prompt.user,
      /£2\.45 \/ £2\.75/,
    );

    assert.match(
      prompt.user,
      /2026-09-14/,
    );

    assert.equal(
      prompt.user.includes(
        "Affogato",
      ),
      false,
    );

    assert.equal(
      prompt.user.includes(
        "Turkish Breakfast Spread",
      ),
      false,
    );
  },
);

test(
  "Claude API failure becomes ClaudeRequestError",
  async () => {
    const fakeClient = {
      messages: {
        create: async () => {
          throw new Error(
            "simulated network failure",
          );
        },
      },
    };

    await assert.rejects(
      () =>
        answerMenuItemWithClaude({
          client: fakeClient,
          model: "test-model",
          context:
            doppioContext,
        }),
      (error) => {
        assert.ok(
          error instanceof
            ClaudeRequestError,
        );

        assert.equal(
          error.message,
          "Claude API request failed.",
        );

        return true;
      },
    );
  },
);

test(
  "empty Claude response becomes ClaudeResponseError",
  async () => {
    const fakeClient = {
      messages: {
        create: async () => ({
          content: [],
          stop_reason:
            "end_turn",
        }),
      },
    };

    await assert.rejects(
      () =>
        answerMenuItemWithClaude({
          client: fakeClient,
          model: "test-model",
          context:
            doppioContext,
        }),
      (error) => {
        assert.ok(
          error instanceof
            ClaudeResponseError,
        );

        assert.equal(
          error.message,
          "Claude returned no text content.",
        );

        return true;
      },
    );
  },
);

test(
  "successful fake Claude response is returned correctly",
  async () => {
    let capturedRequest = null;

    const fakeClient = {
      messages: {
        create: async (
          request,
        ) => {
          capturedRequest =
            request;

          return {
            content: [
              {
                type: "text",
                text:
                  "The Doppio is £2.75.",
              },
            ],
            stop_reason:
              "end_turn",
          };
        },
      },
    };

    const result =
      await answerMenuItemWithClaude({
        client: fakeClient,
        model: "test-model",
        context:
          doppioContext,
        maxTokens: 123,
      });

    assert.equal(
      result.text,
      "The Doppio is £2.75.",
    );

    assert.equal(
      result.model,
      "test-model",
    );

    assert.equal(
      result.stopReason,
      "end_turn",
    );

    assert.ok(
      capturedRequest,
    );

    assert.equal(
      capturedRequest.model,
      "test-model",
    );

    assert.equal(
      capturedRequest.max_tokens,
      123,
    );

    assert.equal(
      capturedRequest.messages.length,
      1,
    );

    assert.equal(
      capturedRequest.messages[0]
        .role,
      "user",
    );
  },
);