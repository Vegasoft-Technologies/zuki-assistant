import { pathToFileURL } from "node:url";
import { createAssistantConfig, createLookupTool } from "./assistant-config.js";

type Environment = Record<string, string | undefined>;
type Fetch = typeof fetch;
const API = "https://api.vapi.ai";

function resourceId(value: string | undefined, name: string): string | undefined {
  const id = value?.trim();
  if (!id) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${name} must be a Vapi UUID or empty.`);
  }
  return id;
}

export async function provision(
  env: Environment,
  options: { dryRun?: boolean; fetch?: Fetch; log?: (message: string) => void } = {},
) {
  const log = options.log ?? console.log;
  const tool = createLookupTool(env.ZUKI_API_BASE_URL?.trim() || "https://zuki-api.example.com");
  const toolId = resourceId(env.VAPI_LOOKUP_TOOL_ID, "VAPI_LOOKUP_TOOL_ID");
  const assistantId = resourceId(env.VAPI_ASSISTANT_ID, "VAPI_ASSISTANT_ID");
  const number = env.ZUKI_TEST_TRANSFER_NUMBER?.trim() || (options.dryRun ? "+12025550100" : "");
  // Validate all config before creating any remote resource.
  const preview = createAssistantConfig(toolId ?? "LOOKUP_TOOL_ID_FROM_POST", number);
  if (options.dryRun) {
    const plan = { tool: { method: toolId ? "PATCH" : "POST", body: tool }, assistant: { method: assistantId ? "PATCH" : "POST", body: preview } };
    log(JSON.stringify(plan, null, 2));
    return plan;
  }
  const key = env.VAPI_API_KEY?.trim();
  if (!key || key.startsWith("replace_")) throw new Error("Set VAPI_API_KEY to your private Vapi API key.");
  const request = options.fetch ?? fetch;
  async function save(kind: "tool" | "assistant", id: string | undefined, body: unknown): Promise<string> {
    let response: Response;
    try {
      response = await request(`${API}/${kind}${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch {
      throw new Error(`Vapi ${kind} request failed or timed out. Check dashboard before retrying: creation may have succeeded. Save any created ID in .env to avoid duplicates.`);
    }
    if (!response.ok) {
      // Do not print remote bodies: they can echo secrets or caller data.
      throw new Error(`Vapi ${kind}: HTTP ${response.status}. Check Vapi API logs; retain previously printed IDs before retrying.`);
    }
    let result: { id?: string };
    try {
      result = await response.json() as { id?: string };
      const savedId = resourceId(result?.id, `Vapi ${kind} response id`);
      if (savedId) return savedId;
    } catch { /* fall through to recovery instructions */ }
    throw new Error(`Vapi ${kind} returned an invalid resource ID. Check dashboard and save its ID before retrying.`);
  }
  const savedToolId = await save("tool", toolId, tool);
  log(`VAPI_LOOKUP_TOOL_ID=${savedToolId}`);
  const savedAssistantId = await save("assistant", assistantId, createAssistantConfig(savedToolId, number));
  log(`VAPI_ASSISTANT_ID=${savedAssistantId}`);
  log("Save both IDs in .env before rerunning. No phone number was created, changed or called.");
  return { toolId: savedToolId, assistantId: savedAssistantId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    console.error("Usage: npm run vapi:provision -- [--dry-run]");
    process.exitCode = 1;
  } else {
    provision(process.env, { dryRun: args.includes("--dry-run") }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Vapi provisioning failed.");
      process.exitCode = 1;
    });
  }
}
