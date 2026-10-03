import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export function vapiAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expectedSecret = process.env.VAPI_SECRET_KEY;
  const providedSecret = req.headers["x-vapi-secret"];

  if (!expectedSecret) {
    console.error(
      "CRITICAL ERROR: VAPI_SECRET_KEY environment variable is missing!",
    );
    res.status(500).json({ error: "Server configuration error." });
    return;
  }

  if (!providedSecret || typeof providedSecret !== "string") {
    res
      .status(401)
      .json({ error: "Unauthorized: Missing or invalid secret format." });
    return;
  }

  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    res.status(403).json({ error: "Forbidden: Invalid secret key." });
    return;
  }

  next();
}
