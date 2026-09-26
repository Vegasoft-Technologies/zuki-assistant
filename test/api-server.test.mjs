import test from "node:test";
import assert from "node:assert/strict";

import {
  createApiServer,
} from "../dist/api/server.js";

async function withServer(
  service,
  run,
) {
  const app = createApiServer(service);

  const server = await new Promise(
    (resolve) => {
      const instance = app.listen(
        0,
        "127.0.0.1",
        () => resolve(instance),
      );
    },
  );

  try {
    const address = server.address();

    assert.ok(
      address !== null &&
      typeof address === "object",
    );

    await run(
      `http://127.0.0.1:${address.port}`,
    );
  } finally {
    await new Promise(
      (resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      },
    );
  }
}

test(
  "API rejects syntactically malformed JSON as a 400 client error",
  async () => {
    let calls = 0;

    const service = {
      async lookup() {
        calls += 1;

        return {
          status: "answered",
          query: "",
          source: "local",
          text: "unused",
          topic: "test",
        };
      },
    };

    await withServer(
      service,
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/lookup`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: '{"query":',
          },
        );

        assert.equal(
          response.status,
          400,
        );

        assert.deepEqual(
          await response.json(),
          {
            error:
              "Invalid request format",
          },
        );

        assert.equal(calls, 0);
      },
    );
  },
);

test(
  "API rejects whitespace-only query before assistant lookup",
  async () => {
    let calls = 0;

    const service = {
      async lookup() {
        calls += 1;

        return {
          status: "transfer_required",
          query: "",
          source: "local",
          text: "unused",
          reason: "unused",
        };
      },
    };

    await withServer(
      service,
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/lookup`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              query: "   ",
            }),
          },
        );

        assert.equal(response.status, 400);
        assert.equal(calls, 0);
      },
    );
  },
);

test(
  "API preserves non-empty query text verbatim",
  async () => {
    let receivedQuery;

    const service = {
      async lookup(query) {
        receivedQuery = query;

        return {
          status: "answered",
          query,
          source: "local",
          text: "ok",
          topic: "test",
        };
      },
    };

    await withServer(
      service,
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/lookup`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              query: "  Cappuccino?  ",
            }),
          },
        );

        assert.equal(response.status, 200);

        assert.equal(
          receivedQuery,
          "  Cappuccino?  ",
        );
      },
    );
  },
);

test(
  "API public responses expose only the approved contract fields",
  async () => {
    const internalFields = {
      reason: "SECRET_INTERNAL_REASON",
      source: "internal-source",
      context: {
        secret: "SECRET_CONTEXT",
      },
      prompt: "SECRET_PROMPT",
      modelOutput: "SECRET_MODEL_OUTPUT",
      originalReason: "SECRET_ORIGINAL_REASON",
    };

    const results = new Map([
      [
        "answered",
        {
          status: "answered",
          query: "answered",
          text: "Grounded answer",
          topic: "menu",
          ...internalFields,
        },
      ],
      [
        "clarify",
        {
          status: "clarification_required",
          query: "clarify",
          text: "Which option do you mean?",
          ...internalFields,
        },
      ],
      [
        "transfer",
        {
          status: "transfer_required",
          query: "transfer",
          text: "SECRET_TRANSFER_TEXT",
          ...internalFields,
        },
      ],
      [
        "unavailable",
        {
          status: "unavailable",
          query: "unavailable",
          text: "SECRET_UNAVAILABLE_TEXT",
          ...internalFields,
        },
      ],
    ]);

    const service = {
      async lookup(query) {
        const result = results.get(query);

        assert.ok(result);
        return result;
      },
    };

    const cases = [
      {
        query: "answered",
        expected: {
          response: "Grounded answer",
          status: "answered",
        },
      },
      {
        query: "clarify",
        expected: {
          response: "Which option do you mean?",
          status: "clarification_required",
        },
      },
      {
        query: "transfer",
        expected: {
          response:
            "I'll put you through to an advisor straight away.",
          status: "transfer_required",
        },
      },
      {
        query: "unavailable",
        expected: {
          response:
            "I'll put you through to an advisor straight away.",
          status: "unavailable",
        },
      },
    ];

    await withServer(
      service,
      async (baseUrl) => {
        for (const entry of cases) {
          const response = await fetch(
            `${baseUrl}/api/lookup`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body: JSON.stringify({
                query: entry.query,
              }),
            },
          );

          assert.equal(
            response.status,
            200,
          );

          assert.deepEqual(
            await response.json(),
            entry.expected,
          );
        }
      },
    );
  },
);
