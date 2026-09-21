import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from "zod";
import type { KnowledgeSafeAssistantService } from "../assistant/knowledge-safe-service.js";

const lookupRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
});

export function createApiServer(
  assistantService: KnowledgeSafeAssistantService,
) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
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
            originalReason: result.text,
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
    console.error("API Server Error:", err);
    res.status(500).json({
      response: "I'll put you through to an advisor straight away.",
      status: "error",
    });
  });

  return app;
}
