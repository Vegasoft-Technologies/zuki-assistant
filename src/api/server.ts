import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from "zod";
import type { KnowledgeSafeAssistantService } from "../assistant/knowledge-safe-service.js";

import { buildCompletion, buildSse, createOfferMemory, routeConversation, transferAction, transferToolShape } from "../vapi/custom-llm.js";

const completionRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() })), z.null()]).optional(),
  })),
  tools: z.array(z.unknown()).optional(),
  stream: z.boolean().optional(),
  // Only the id is used; a malformed call object must never reject the turn.
  call: z.object({ id: z.string().min(1) }).optional().catch(undefined),
});

function sendCompletion(res: Response, action: Parameters<typeof buildCompletion>[0], stream = true) {
  if (stream) {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.end(buildSse(action));
  } else {
    res.json(buildCompletion(action));
  }
}

const lookupRequestSchema = z.object({
  query: z
    .string()
    .min(1, "Query is required")
    .max(2000, "Query is too long")
    .refine(
      (value) => value.trim().length > 0,
      "Query is required",
    ),
});

function isMalformedJsonError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    type?: unknown;
  };

  return (
    candidate.status === 400 &&
    candidate.type === "entity.parse.failed"
  );
}

function isPayloadTooLargeError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    type?: unknown;
  };

  return (
    candidate.status === 413 ||
    candidate.type === "entity.too.large"
  );
}

function isUnsupportedMediaError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    type?: unknown;
  };

  return (
    candidate.status === 415 &&
    (candidate.type === "charset.unsupported" ||
      candidate.type === "encoding.unsupported")
  );
}

export function createApiServer(
  assistantService: KnowledgeSafeAssistantService,
) {
  const app = express();

  let loggedTransferShape = false;
  let loggedCallId = false;
  const offerMemory = createOfferMemory();

  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/vapi/chat/completions", async (req: Request, res: Response): Promise<void> => {
    const parsed = completionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request format", details: z.treeifyError(parsed.error) });
      return;
    }
    const { messages, tools, stream, call } = parsed.data;
    try {
      if (!loggedTransferShape) {
        const shape = transferToolShape(tools);
        if (shape) {
          loggedTransferShape = true;
          console.info("Vapi transferCall schema:", shape);
        }
      }
      if (!loggedCallId) {
        loggedCallId = true;
        console.info("Vapi custom LLM request has call id:", call !== undefined);
      }
      const offers = call ? offerMemory.forCall(call.id) : undefined;
      const action = await routeConversation(messages, tools, assistantService, process.env.ZUKI_TEST_TRANSFER_NUMBER, offers);
      sendCompletion(res, action, stream);
    } catch {
      sendCompletion(res, transferAction(tools, process.env.ZUKI_TEST_TRANSFER_NUMBER), stream);
    }
  });

  app.post(
    "/api/lookup",
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const parsed = lookupRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request format",
            details: z.treeifyError(parsed.error),
          });
          return;
        }

        const { query } = parsed.data;

        const result = await assistantService.lookup(query);

        if (
          result.status === "transfer_required" ||
          result.status === "unavailable"
        ) {
          res.json({
            response: "I'll put you through to an advisor straight away.",
            status: result.status,
          });
          return;
        }

        res.json({
          response: result.text,
          status: result.status,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (isMalformedJsonError(err)) {
      res.status(400).json({
        error: "Invalid request format",
      });
      return;
    }

    if (isPayloadTooLargeError(err)) {
      res.status(413).json({
        error: "Payload too large",
      });
      return;
    }

    if (isUnsupportedMediaError(err)) {
      res.status(415).json({
        error: "Unsupported media type",
      });
      return;
    }

    console.error("API Server Error:", err);
    res.status(500).json({
      response: "I'll put you through to an advisor straight away.",
      status: "error",
    });
  });

  return app;
}
