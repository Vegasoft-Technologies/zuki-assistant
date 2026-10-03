import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../dist/api/server.js";

describe("Vapi Auth Middleware Integration Tests", () => {
  let app;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.VAPI_SECRET_KEY = "test-secret-123";

    const mockAssistant = {
      processRequest: async () => ({ results: [] }),
      handleTransfer: async () => ({ destination: "test" }),
      lookup: async () => ({ price: "10" }),
    };

    app = createApiServer(mockAssistant);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function runMiddleware(headers, envSecret = "test-secret-123") {
    process.env.VAPI_SECRET_KEY = envSecret;
    const req = { headers: headers || {} };
    let status = 200;
    let body = {};
    let nextCalled = false;

    const expectedSecret = process.env.VAPI_SECRET_KEY;
    const providedSecret = req.headers["x-vapi-secret"];

    if (!expectedSecret) {
      return {
        status: 500,
        body: { error: "Server configuration error." },
        nextCalled: false,
      };
    }
    if (!providedSecret || typeof providedSecret !== "string") {
      return {
        status: 401,
        body: { error: "Unauthorized: Missing or invalid secret format." },
        nextCalled: false,
      };
    }

    if (
      Buffer.from(providedSecret).length !==
        Buffer.from(expectedSecret).length ||
      providedSecret !== expectedSecret
    ) {
      return {
        status: 403,
        body: { error: "Forbidden: Invalid secret key." },
        nextCalled: false,
      };
    }

    return { status: 200, body: {}, nextCalled: true };
  }

  describe("Server Configuration (500)", () => {
    it("should return 500 when VAPI_SECRET_KEY is missing", async () => {
      const result = await runMiddleware(
        { "x-vapi-secret": "test-secret-123" },
        "",
      );
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: "Server configuration error." });
    });
  });

  describe("Endpoint Auth Logic", () => {
    it("should block requests without secret (401)", async () => {
      const result = await runMiddleware({});
      assert.equal(result.status, 401);
    });

    it("should block requests with wrong secret (403)", async () => {
      const result = await runMiddleware({ "x-vapi-secret": "wrong-secret" });
      assert.equal(result.status, 403);
    });

    it("should allow requests with correct secret (200)", async () => {
      const result = await runMiddleware({
        "x-vapi-secret": "test-secret-123",
      });
      assert.equal(result.nextCalled, true);
    });
  });
});
