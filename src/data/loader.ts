import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ZodError } from "zod";

import { zukiDataSchema } from "./schema.js";
import type { SourceZukiData } from "./schema.js";

const DEFAULT_ZUKI_DATA_PATH = fileURLToPath(
  new URL("../../data/zuki_data.json", import.meta.url),
);

export class ZukiDataLoadError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ZukiDataLoadError";
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.join(".") : "<root>";

      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function loadZukiData(
  filePath: string = DEFAULT_ZUKI_DATA_PATH,
): Promise<SourceZukiData> {
  let rawJson: string;

  try {
    rawJson = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    throw new ZukiDataLoadError(
      `Unable to read Zuki data file: ${filePath}`,
      { cause: error },
    );
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawJson);
  } catch (error: unknown) {
    throw new ZukiDataLoadError(
      `Zuki data file contains invalid JSON: ${filePath}`,
      { cause: error },
    );
  }

  try {
    return zukiDataSchema.parse(parsedJson);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new ZukiDataLoadError(
        `Zuki data failed schema validation: ${formatZodError(error)}`,
        { cause: error },
      );
    }

    throw error;
  }
}