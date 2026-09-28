import { randomUUID } from "node:crypto";
import type { KnowledgeSafeAssistantService } from "../assistant/knowledge-safe-service.js";
import { PHRASES, REPLIES, RESERVATION_OFFER, TRANSFER_FAILURE } from "./phrases.js";

export type Action = { kind: "speak"; text: string } | { kind: "transfer"; destination: string } | { kind: "silent" };
export type Message = { role: string; content?: string | { type: string; text?: string | undefined }[] | null | undefined };
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function transferTool(tools: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools.map(record).find((tool) => record(tool.function).name === "transferCall");
}

// Return only schema keys, never enum values, descriptions or phone numbers.
export function transferToolShape(tools: unknown) {
  const tool = transferTool(tools);
  if (!tool) return undefined;
  const fn = record(tool.function);
  const parameters = record(fn.parameters);
  const properties = record(parameters.properties);
  return {
    name: "transferCall", keys: Object.keys(tool), functionKeys: Object.keys(fn),
    parameterKeys: Object.keys(parameters), propertyNames: Object.keys(properties),
    destinationKeys: Object.keys(record(properties.destination)),
  };
}

export function transferAction(tools: unknown, fallback?: string): Action {
  const fn = record(transferTool(tools)?.function);
  const values = record(record(record(fn.parameters).properties).destination).enum;
  const candidate = Array.isArray(values) && values.length === 1 ? values[0] : undefined;
  const valid = (value: unknown): value is string => typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
  const destination = valid(candidate) ? candidate : fallback?.trim();
  return valid(destination) ? { kind: "transfer", destination } : { kind: "speak", text: TRANSFER_FAILURE };
}

export function toSpokenPrices(text: string): string {
  return text.replace(/£(\d+)(?:\.(\d{1,2}))?/g, (_amount, whole: string, fraction?: string) => {
    const pounds = Number(whole);
    const pence = Number(fraction?.padEnd(2, "0") ?? 0);
    if (pounds === 0 && pence > 0) return `${pence} ${pence === 1 ? "penny" : "pence"}`;
    return `${pounds} ${pounds === 1 ? "pound" : "pounds"}${pence ? ` ${pence}` : ""}`;
  });
}

function content(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
}
const alternatives = (phrases: readonly string[]) => phrases.join("|");

// Classification may discard punctuation; lookup always receives the untouched turn.
function normalizeForClassification(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N} ']/gu, " ").replace(/\s+/g, " ").trim();
}

function closingAction(normalized: string): Action | undefined {
  if (!normalized) return undefined;
  const phrases = [
    ...PHRASES.goodbye.map((phrase) => ({ phrase, goodbye: true })),
    ...PHRASES.acknowledgement.map((phrase) => ({ phrase, goodbye: false })),
  ].sort((a, b) => b.phrase.length - a.phrase.length);
  let remaining = normalized;
  let hasGoodbye = false;
  let matched = false;
  while (remaining) {
    const entry = phrases.find(({ phrase }) => remaining === phrase || remaining.startsWith(`${phrase} `));
    if (!entry) return undefined;
    matched = true;
    hasGoodbye ||= entry.goodbye;
    remaining = remaining.slice(entry.phrase.length).trimStart();
    if (remaining.startsWith("and ")) remaining = remaining.slice(4);
  }
  if (!matched) return undefined;
  return hasGoodbye ? { kind: "speak", text: REPLIES.goodbye } : { kind: "silent" };
}

export async function routeConversation(
  messages: readonly Message[], tools: unknown, service: KnowledgeSafeAssistantService, fallback?: string,
): Promise<Action> {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return { kind: "silent" };
  const turn = content(last);
  const normalized = normalizeForClassification(turn);
  const speak = (text: string): Action => ({ kind: "speak", text });
  const transfer = () => transferAction(tools, fallback);
  const previous = messages.slice(0, -1).findLast((message) => message.role === "assistant");
  if (previous && normalizeForClassification(content(previous)).includes("can't make reservations")) {
    if (new RegExp(`^(?:${alternatives(PHRASES.yes)})(?:[ ,]+(?:please|thanks))?$`).test(normalized)) return transfer();
    if (PHRASES.no.some((phrase) => phrase === normalized)) return speak(REPLIES.declined);
  }
  if (PHRASES.humanOnly.some((phrase) => phrase === normalized) ||
      new RegExp(`\\b(?:${alternatives(PHRASES.humanRequest)}) (?:a |an |the )?(?:${alternatives(PHRASES.human)})\\b`).test(normalized)) return transfer();
  if (new RegExp(`\\b(?:${alternatives(PHRASES.reservation)})\\b`).test(normalized)) return speak(RESERVATION_OFFER);
  if (new RegExp(`^(?:${alternatives(PHRASES.greeting)})(?: (?:${alternatives(PHRASES.greeting)}))?(?: (?:there|zuki))?(?: how are you)?$`).test(normalized)) return speak(REPLIES.greeting);
  const closer = closingAction(normalized);
  if (closer) return closer;
  if (PHRASES.filler.some((phrase) => phrase === normalized)) return speak(REPLIES.filler);
  try {
    const result = await service.lookup(turn);
    if ((result.status === "answered" || result.status === "clarification_required") && result.text?.trim()) return speak(toSpokenPrices(result.text));
  } catch { /* Lookup failures follow the same transfer path, without exposing errors. */ }
  return transfer();
}

export function buildCompletion(action: Action) {
  const message = action.kind === "transfer"
    ? { role: "assistant", tool_calls: [{ id: `call_${randomUUID()}`, type: "function", function: { name: "transferCall", arguments: JSON.stringify({ destination: action.destination }) } }] }
    : action.kind === "speak" ? { role: "assistant", content: action.text } : { role: "assistant" };
  return {
    id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "zuki-router",
    choices: [{ index: 0, message, finish_reason: action.kind === "transfer" ? "tool_calls" : "stop" }],
  };
}

export function buildSse(action: Action): string {
  const completion = buildCompletion(action);
  const choice = completion.choices[0]!;
  const { tool_calls, ...message } = choice.message;
  const delta = tool_calls ? { ...message, tool_calls: tool_calls.map((tool, index) => ({ index, ...tool })) } : message;
  const chunk = (delta: object, finish_reason: string | null) => ({
    ...completion, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }],
  });
  return [chunk(delta, null), chunk({}, choice.finish_reason)].map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n";
}
