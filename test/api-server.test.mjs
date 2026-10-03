import test from "node:test";
import assert from "node:assert/strict";

process.env.VAPI_SECRET_KEY = "test-secret-123";

import { createApiServer } from "../dist/api/server.js";

import { createKnowledgeSafeAssistantService } from "../dist/assistant/knowledge-safe-service.js";

import { loadZukiData } from "../dist/data/loader.js";

import { transformZukiData } from "../dist/data/transformer.js";

async function withServer(service, run) {
  const app = createApiServer(service);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();

    assert.ok(address !== null && typeof address === "object");

    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, options = {}) => {
      if (url.toString().startsWith(`http://127.0.0.1:${address.port}`)) {
        options.headers = {
          ...options.headers,
          "x-vapi-secret": process.env.VAPI_SECRET_KEY,
        };
      }
      return originalFetch(url, options);
    };

    try {
      await run(`http://127.0.0.1:${address.port}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

test("API acceptance: final scenario 44 checks the query length boundary", async () => {
  const data = transformZukiData(await loadZukiData());
  const captured = [];
  const service = createKnowledgeSafeAssistantService(data, {
    claudeResponder: async (context) => {
      captured.push(context.query.raw);
      assert.equal(context.item.name, "Cappuccino");
      return {
        text: "Yes, we serve Cappuccino.",
        model: "fake-model",
        stopReason: "end_turn",
      };
    },
  });

  await withServer(service, async (baseUrl) => {
    for (const length of [2000, 2001]) {
      const query = "Do you have cappuccino?".padEnd(length);
      const before = captured.length;
      const response = await fetch(`${baseUrl}/api/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await response.json();

      assert.equal(query.length, length);
      assert.equal(response.status, length === 2000 ? 200 : 400);
      assert.equal(captured.length - before, length === 2000 ? 1 : 0);
      if (length === 2000) {
        assert.equal(captured.at(-1), query);
        assert.deepEqual(body, {
          status: "answered",
          response: "Yes, we serve Cappuccino.",
        });
      } else {
        assert.equal(body.error, "Invalid request format");
        assert.ok(
          Object.keys(body).every((key) => ["error", "details"].includes(key)),
        );
      }
      assert.doesNotMatch(
        JSON.stringify(body),
        /stack|node_modules|context|prompt|ANTHROPIC|API_KEY|SyntaxError/u,
      );
    }
    assert.equal(captured.length, 1);
  });
});

test("API acceptance: final scenario 45 isolates 100 requests at concurrency 20", async () => {
  const data = transformZukiData(await loadZukiData());
  const cases = [
    {
      query: "Do you have cappuccino?",
      text: "Yes, we serve Cappuccino.",
      status: "answered",
      responder: true,
    },
    {
      query: "How much is cappuccino?",
      text: "Cappuccino costs \u00a33.55.",
      status: "answered",
      responder: true,
    },
    {
      query: "What time do you open on Sunday?",
      text: "On sunday, Zuki's opens at 10 AM.",
      status: "answered",
    },
    {
      query: "Where are you?",
      text: data.business.address,
      status: "answered",
    },
    { query: "Do you have sushi?", status: "transfer_required" },
    { query: "Is cappuccino available now?", status: "transfer_required" },
    { query: "Do you have cappu\u200Bccino?", status: "transfer_required" },
  ];
  const jobs = Array.from({ length: 100 }, (_, index) => {
    const entry = cases[index % cases.length];
    return { ...entry, query: " ".repeat(index + 1) + entry.query };
  });
  const expectedCalls = new Map(
    jobs.filter((job) => job.responder).map((job) => [job.query, job]),
  );
  const captured = new Map();
  const service = createKnowledgeSafeAssistantService(data, {
    claudeResponder: async (context) => {
      const entry = expectedCalls.get(context.query.raw);
      const snapshot = JSON.stringify(context);
      assert.ok(entry, context.query.raw);
      assert.equal(context.item.name, "Cappuccino");
      assert.deepEqual(
        context.item.pricing.options.map((option) => option.amount_minor),
        [355],
      );
      captured.set(
        context.query.raw,
        (captured.get(context.query.raw) ?? 0) + 1,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, context.query.raw.includes("much") ? 1 : 5),
      );
      assert.equal(JSON.stringify(context), snapshot);
      return { text: entry.text, model: "fake-model", stopReason: "end_turn" };
    },
  });
  let active = 0;
  let maximumActive = 0;
  let completed = 0;

  await withServer(service, async (baseUrl) => {
    for (let offset = 0; offset < jobs.length; offset += 20) {
      await Promise.all(
        jobs.slice(offset, offset + 20).map(async (entry) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          try {
            const response = await fetch(`${baseUrl}/api/lookup`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ query: entry.query }),
            });
            const body = await response.json();

            assert.equal(response.status, 200, entry.query);
            assert.deepEqual(body, {
              status: entry.status,
              response:
                entry.text ??
                "I'll put you through to an advisor straight away.",
            });
            completed += 1;
          } finally {
            active -= 1;
          }
        }),
      );
    }
    assert.equal(completed, 100);
    assert.equal(maximumActive, 20);
    assert.equal(active, 0);
    assert.equal(expectedCalls.size, 30);
    assert.equal(captured.size, 30);
    for (const query of expectedCalls.keys()) {
      assert.equal(captured.get(query), 1, query);
    }
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  });
});

test("API boundary cases reject invalid input without exposing internal data", async () => {
  const data = transformZukiData(await loadZukiData());
  const captured = [];
  const service = createKnowledgeSafeAssistantService(data, {
    claudeResponder: async (context) => {
      captured.push(context.query.raw);
      return {
        text: "Yes, we have Cappuccino.",
        model: "fake-model",
        stopReason: "end_turn",
      };
    },
  });
  const query = "Do you have cappuccino?";
  const cases = [
    { id: 61, body: {}, http: 400 },
    { id: 62, body: { query: null }, http: 400 },
    { id: 63, body: { query: 123 }, http: 400 },
    { id: 64, body: { query: [] }, http: 400 },
    { id: 65, body: { query: {} }, http: 400 },
    { id: 66, body: { query: "" }, http: 400 },
    { id: 67, body: { query: "   " }, http: 400 },
    { id: 68, body: { query: query.padEnd(2000) }, http: 200 },
    { id: 69, body: { query: query.padEnd(2001) }, http: 400 },
    { id: 70, raw: '{"query":', http: 400 },
    { id: 71, body: { query, padding: "x".repeat(102401) }, http: 413 },
    {
      id: 72,
      body: { query },
      headers: { "content-type": "application/json; charset=iso-8859-1" },
      http: 415,
    },
    {
      id: 73,
      body: { query },
      headers: { "content-encoding": "unsupported" },
      http: 415,
    },
    { id: 74, method: "GET", http: 404 },
    { id: 75, method: "PUT", body: { query }, http: 404 },
    {
      id: 76,
      body: { query, internal_context: "private-boundary-sentinel" },
      http: 200,
    },
  ];

  await withServer(service, async (baseUrl) => {
    for (const entry of cases) {
      const before = captured.length;
      const response = await fetch(`${baseUrl}/api/lookup`, {
        method: entry.method ?? "POST",
        headers: { "content-type": "application/json", ...entry.headers },
        ...(entry.method === "GET"
          ? {}
          : { body: entry.raw ?? JSON.stringify(entry.body) }),
      });
      const text = await response.text();

      assert.equal(response.status, entry.http, `request ${entry.id}`);
      assert.equal(
        captured.length - before,
        entry.http === 200 ? 1 : 0,
        `request ${entry.id}`,
      );
      assert.doesNotMatch(
        text,
        /stack|node_modules|internal_context|private-boundary-sentinel|prompt|ANTHROPIC|API_KEY|Error:|SyntaxError/u,
      );
      if (entry.http === 200) {
        assert.equal(captured.at(-1), entry.body.query);
        assert.deepEqual(JSON.parse(text), {
          status: "answered",
          response: "Yes, we have Cappuccino.",
        });
      } else if (entry.http !== 404) {
        const body = JSON.parse(text);
        assert.ok(
          Object.keys(body).every((key) => ["error", "details"].includes(key)),
        );
        assert.equal(
          body.error,
          entry.http === 413
            ? "Payload too large"
            : entry.http === 415
              ? "Unsupported media type"
              : "Invalid request format",
        );
      }
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, "ok");
    }
    assert.equal(captured.length, 2);
  });
});

test("200 concurrent HTTP requests preserve context isolation with 20 workers", async () => {
  const data = transformZukiData(await loadZukiData());
  const cases = [
    {
      query: "Do you have cappuccino?",
      item: "Cappuccino",
      text: "Yes, we have Cappuccino.",
      status: "answered",
    },
    {
      query: "How much is Latte?",
      item: "Latte",
      text: "The Latte is \u00a33.55.",
      status: "answered",
    },
    {
      query: "Do you have Americano?",
      item: "Americano",
      text: "Yes, we have Americano.",
      status: "answered",
    },
    {
      query: "How much is Cappuccino?",
      item: "Cappuccino",
      text: "The Cappuccino is \u00a33.55.",
      status: "answered",
    },
    {
      query: "What time do you close on Sunday?",
      text: "On sunday, Zuki's closes at 4 PM.",
      status: "answered",
    },
    { query: "Do you have sushi?", status: "transfer_required" },
    { query: "Is cappuccino available now?", status: "transfer_required" },
    { query: "Do you have cappu\u200Bccino?", status: "transfer_required" },
    { query: "", http: 400 },
    { raw: '{"query":', http: 400 },
  ];
  const jobs = Array.from({ length: 200 }, (_, index) => {
    const entry = cases[index % cases.length];
    return {
      ...entry,
      query: entry.query ? " ".repeat(index + 1) + entry.query : entry.query,
    };
  });
  const expectedCalls = new Map(
    jobs.filter((job) => job.item).map((job) => [job.query, job]),
  );
  const captured = new Map();
  const service = createKnowledgeSafeAssistantService(data, {
    claudeResponder: async (context) => {
      const entry = expectedCalls.get(context.query.raw);
      const snapshot = JSON.stringify(context);
      assert.ok(entry, context.query.raw);
      assert.equal(context.item.name, entry.item);
      captured.set(
        context.query.raw,
        (captured.get(context.query.raw) ?? 0) + 1,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, context.item.name === "Cappuccino" ? 5 : 1),
      );
      assert.equal(JSON.stringify(context), snapshot);
      assert.equal(context.item.name, entry.item);
      return { text: entry.text, model: "fake-model", stopReason: "end_turn" };
    },
  });
  let active = 0;
  let maximumActive = 0;
  let completed = 0;

  await withServer(service, async (baseUrl) => {
    for (let offset = 0; offset < jobs.length; offset += 20) {
      await Promise.all(
        jobs.slice(offset, offset + 20).map(async (entry) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          try {
            const response = await fetch(`${baseUrl}/api/lookup`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: entry.raw ?? JSON.stringify({ query: entry.query }),
            });
            const body = await response.json();
            assert.equal(response.status, entry.http ?? 200, entry.query);
            if (entry.http === 400) {
              assert.equal(body.error, "Invalid request format");
              assert.ok(
                Object.keys(body).every((key) =>
                  ["error", "details"].includes(key),
                ),
              );
            } else {
              assert.deepEqual(body, {
                status: entry.status,
                response:
                  entry.text ??
                  "I'll put you through to an advisor straight away.",
              });
            }
            completed += 1;
          } finally {
            active -= 1;
          }
        }),
      );
    }
    assert.equal(completed, 200);
    assert.equal(maximumActive, 20);
    assert.equal(active, 0);
    assert.equal(captured.size, 80);
    assert.equal(captured.size, expectedCalls.size);
    for (const query of expectedCalls.keys()) {
      assert.equal(captured.get(query), 1, query);
    }
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  });
});

test("API validates input lengths types byte limits and recovery", async () => {
  const received = [];
  const service = {
    async lookup(query) {
      received.push(query);
      return {
        status: "answered",
        text: "ok",
      };
    },
  };
  const cases = [
    { body: "{}", status: 400 },
    { body: '{"other":"value"}', status: 400 },
    { body: '{"query":null}', status: 400 },
    { body: '{"query":7}', status: 400 },
    { body: '{"query":[]}', status: 400 },
    { body: '{"query":true}', status: 400 },
    { body: '{"query":""}', status: 400 },
    { body: '{"query":"   \\t\\n"}', status: 400 },
    { body: '{"query":', status: 400 },
    { body: "", status: 400 },
    { body: '"cappuccino"', status: 400 },
    { body: '{"query":"cappuccino"}', type: "text/plain", status: 400 },
    { body: "<query>cappuccino</query>", type: "application/xml", status: 400 },
    {
      body: '{"query":"cappuccino"}',
      type: "application/json; charset=iso-8859-1",
      status: 415,
    },
    {
      body: '{"query":"cappuccino"}',
      headers: { "content-encoding": "unsupported" },
      status: 415,
    },
    {
      body: '{"query":"bad","query":"cappuccino"}',
      status: 200,
      query: "cappuccino",
    },
    { body: '{"query":"cappuccino","query":null}', status: 400 },
    {
      body: '{"query":"cappuccino","unknown":"ignored"}',
      status: 200,
      query: "cappuccino",
    },
    ...[1, 1999, 2000, 2001, 20000].map((length) => ({
      body: JSON.stringify({ query: "x".repeat(length) }),
      status: length <= 2000 ? 200 : 400,
      query: "x".repeat(length),
    })),
    ...["\uFF23appuccino", "Cappuccino\u00A0please", "cappu\u200Bccino"].map(
      (query) => ({
        body: JSON.stringify({ query }),
        status: 200,
        query,
      }),
    ),
    ...[102399, 102400, 102401, 120000].map((bytes) => {
      const body = JSON.stringify({ query: "cappuccino", padding: "" });
      return {
        body: JSON.stringify({
          query: "cappuccino",
          padding: "x".repeat(bytes - Buffer.byteLength(body)),
        }),
        status: bytes <= 102400 ? 200 : 413,
        query: "cappuccino",
      };
    }),
    ...[102400, 102401].map((bytes) => {
      const body = JSON.stringify({ query: "cappuccino", padding: "" });
      const paddingBytes = bytes - Buffer.byteLength(body);
      return {
        body: JSON.stringify({
          query: "cappuccino",
          padding:
            "\u00E9".repeat(Math.floor(paddingBytes / 2)) +
            "x".repeat(paddingBytes % 2),
        }),
        status: bytes <= 102400 ? 200 : 413,
        query: "cappuccino",
      };
    }),
  ];

  await withServer(service, async (baseUrl) => {
    for (const entry of cases) {
      const before = received.length;
      const response = await fetch(`${baseUrl}/api/lookup`, {
        method: "POST",
        headers: {
          "content-type": entry.type ?? "application/json",
          ...entry.headers,
        },
        body: entry.body,
      });
      const body = await response.json();

      assert.equal(
        response.status,
        entry.status,
        entry.type ?? entry.body.slice(0, 80),
      );
      assert.equal(received.length - before, entry.status === 200 ? 1 : 0);
      if (entry.status === 200) {
        assert.equal(received.at(-1), entry.query);
        assert.deepEqual(body, { response: "ok", status: "answered" });
      } else {
        assert.equal(typeof body.error, "string");
        assert.equal(JSON.stringify(body).includes("stack"), false);
      }

      const health = await fetch(`${baseUrl}/health`);
      const healthBody = await health.json();

      assert.equal(health.status, 200);
      assert.equal(healthBody.status, "ok");
      assert.ok(Number.isFinite(Date.parse(healthBody.timestamp)));
    }
  });
});

test("bounded concurrent HTTP requests preserve context responses and call counts", async () => {
  const data = transformZukiData(await loadZukiData());
  const captured = [];
  const service = createKnowledgeSafeAssistantService(data, {
    claudeResponder: async (context) => {
      const snapshot = JSON.stringify(context);
      captured.push(context.query.raw);
      await new Promise((resolve) =>
        setTimeout(resolve, context.item.name === "Cappuccino" ? 10 : 2),
      );
      assert.equal(JSON.stringify(context), snapshot);

      return {
        text: context.query.normalized.includes("much")
          ? `The ${context.item.name} is £${context.item.pricing.options[0].amount.toFixed(2)}.`
          : `Yes, we have ${context.item.name}.`,
        model: "fake-model",
        stopReason: "end_turn",
      };
    },
  });
  const queries = [
    {
      query: "Do you have cappuccino?",
      status: "answered",
      text: "Yes, we have Cappuccino.",
    },
    {
      query: "How much is cappuccino?",
      status: "answered",
      text: "The Cappuccino is £3.55.",
    },
    {
      query: "Do you have Americano?",
      status: "answered",
      text: "Yes, we have Americano.",
    },
    { query: "Do you have cappuccino now?", status: "transfer_required" },
    { query: "Cappuccino, anything left?", status: "transfer_required" },
    { query: "sushi", status: "transfer_required" },
    { query: " ", http: 400 },
    { query: null, http: 400 },
  ];

  await withServer(service, async (baseUrl) => {
    for (let round = 0; round < 6; round += 1) {
      for (let offset = 0; offset < queries.length; offset += 4) {
        await Promise.all(
          queries.slice(offset, offset + 4).map(async (entry) => {
            const response = await fetch(`${baseUrl}/api/lookup`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ query: entry.query }),
            });
            const body = await response.json();

            assert.equal(response.status, entry.http ?? 200);
            if (entry.http === 400) {
              assert.equal(body.error, "Invalid request format");
            } else {
              assert.equal(body.status, entry.status, entry.query);
              assert.equal(
                body.response,
                entry.text ??
                  "I'll put you through to an advisor straight away.",
                entry.query,
              );
            }
          }),
        );
      }
    }

    assert.equal(captured.length, 18);
    for (const entry of queries.filter(
      (entry) => entry.status === "answered",
    )) {
      assert.equal(captured.filter((query) => query === entry.query).length, 6);
    }
    const health = await fetch(`${baseUrl}/health`);

    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
  });
});

test("API rejects syntactically malformed JSON as a 400 client error", async () => {
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

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: '{"query":',
    });

    assert.equal(response.status, 400);

    assert.deepEqual(await response.json(), {
      error: "Invalid request format",
    });

    assert.equal(calls, 0);
  });
});

test("API rejects whitespace-only query before assistant lookup", async () => {
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

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "   ",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test("API preserves non-empty query text verbatim", async () => {
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

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "  Cappuccino?  ",
      }),
    });

    assert.equal(response.status, 200);

    assert.equal(receivedQuery, "  Cappuccino?  ");
  });
});

test("API public responses expose only the approved contract fields", async () => {
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
        response: "I'll put you through to an advisor straight away.",
        status: "transfer_required",
      },
    },
    {
      query: "unavailable",
      expected: {
        response: "I'll put you through to an advisor straight away.",
        status: "unavailable",
      },
    },
  ];

  await withServer(service, async (baseUrl) => {
    for (const entry of cases) {
      const response = await fetch(`${baseUrl}/api/lookup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: entry.query,
        }),
      });

      assert.equal(response.status, 200);

      assert.deepEqual(await response.json(), entry.expected);
    }
  });
});

test("API rejects excessively long queries before assistant lookup", async () => {
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

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "cappuccino " + "x".repeat(20000),
      }),
    });

    assert.equal(response.status, 400);

    const body = await response.json();

    assert.equal(body.error, "Invalid request format");

    assert.equal(calls, 0);
  });
});

test("API returns 413 for JSON bodies above the parser limit", async () => {
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

  await withServer(service, async (baseUrl) => {
    for (const size of [120000, 200000]) {
      const response = await fetch(`${baseUrl}/api/lookup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "cappuccino " + "x".repeat(size),
        }),
      });

      assert.equal(response.status, 413, `size=${size}`);

      assert.deepEqual(
        await response.json(),
        {
          error: "Payload too large",
        },
        `size=${size}`,
      );
    }

    assert.equal(calls, 0);
  });
});
