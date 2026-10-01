import { FIRST_MESSAGE } from "./phrases.js";
import type { KnowledgeSafeResult } from "../assistant/knowledge-safe-service.js";

// Same sentence src/api/server.ts returns as `response` for transfer_required,
// unavailable and 500 errors, so the caller hears one consistent transfer line.
export const TRANSFER_MESSAGE =
  "I'll put you through to an advisor straight away.";

// Deployed HTTP contract (src/api/server.ts, Railway 2026-09-26): /api/lookup wraps
// knowledge-safe-service.ts and answers { response, status }.
// not_found is folded into transfer_required; a 500 answers status "error".
export type LookupHttpResponse = {
  response: string;
  status: KnowledgeSafeResult["status"] | "error";
};

export const SYSTEM_PROMPT = "Routing happens server-side. Speak only the server response; use transferCall when instructed.";

export function createLookupTool(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("ZUKI_API_BASE_URL must be an HTTPS base URL without credentials, query or fragment.");
  }
  return {
    type: "apiRequest",
    name: "lookup_zuki_info",
    description: "Required for every factual Zuki question. Read the returned text verbatim and follow the four status rules in the system prompt.",
    method: "POST",
    url: `${url.href.replace(/\/+$/, "")}/api/lookup`,
    headers: {
      type: "object",
      properties: {
        "Content-Type": { type: "string", value: "application/json" },
      },
    },
    body: {
      type: "object",
      properties: {
        query: { type: "string", description: "The caller's question or clarification reply verbatim; do not rewrite or append context." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    timeoutSeconds: 20,
    // No extraction/boolean conversion: Vapi exposes the full JSON result.
  };
}

export function createAssistantConfig(baseUrl: string, transferNumber: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(transferNumber)) {
    throw new Error("ZUKI_TEST_TRANSFER_NUMBER must be a human test number in E.164 format.");
  }
  const url = createLookupTool(baseUrl).url.replace(/\/lookup$/, "/vapi");
  return {
    name: "Zuki - Sude test",
    firstMessage: FIRST_MESSAGE,
    model: {
      provider: "custom-llm",
      url,
      model: "zuki-router",
      // Vapi rejects metadataSendMode when starting a call (2026-09-28 web test), so keep the default.
      temperature: 0,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: [{
        type: "transferCall",
        destinations: [{
          type: "number",
          number: transferNumber,
          description: "Human test recipient only. Use after transfer_required/unavailable, lookup failure, or an explicit/accepted human transfer request. Never for clarification_required alone.",
          message: TRANSFER_MESSAGE,
          transferPlan: { mode: "blind-transfer" },
        }],
      }],
    },
    // 2026-09-28 web tests: Deepgram nova-2 and nova-3 (with keyterms) kept hearing "How much is a
    // cappuccino?" as "March is / Which is / Is a cup of tea". gpt-4o-transcribe handles accented
    // speech better; Deepgram stays as fallback if OpenAI transcription fails.
    transcriber: {
      provider: "openai",
      model: "gpt-4o-transcribe",
      language: "en",
      fallbackPlan: { transcribers: [{
        provider: "deepgram",
        model: "nova-3",
        language: "en",
        keyterm: ["Zuki's", "cappuccino", "Turkish breakfast", "vegan breakfast", "sushi", "How much is"],
      }] },
    },
    // Vapi native voice: the 2026-09-26 web test measured OpenAI gpt-4o-mini-tts at 2.5-5.6 s voice latency per turn.
    // Elliot read "Zuki's" as "Zuppies"; respell it before TTS. Transcripts keep the real spelling.
    voice: {
      provider: "vapi",
      voiceId: "Elliot",
      chunkPlan: { formatPlan: { replacements: [
        { type: "exact", key: "Zuki's", value: "Zookee's" },
        { type: "exact", key: "Zuki", value: "Zookee" },
        // Elliot drops "£" and says "3.55"; say the currency.
        { type: "regex", regex: "£(\\d+)\\.(\\d{2})", value: "$1 pounds $2" },
        { type: "regex", regex: "£(\\d+)", value: "$1 pounds" },
      ] } },
    },
    // Post-call summary and success evaluation for test/error tracking (team decision 2026-10-01).
    // Managed here, not in the dashboard, so the live assistant matches this script.
    analysisPlan: {
      summaryPlan: { enabled: true },
      successEvaluationPlan: { enabled: true },
    },
  };
}
