import { randomUUID } from "node:crypto";
import { GENERIC_FALLBACK_REASONS, type KnowledgeSafeAssistantService } from "../assistant/knowledge-safe-service.js";
import { CLARIFY_OFFER, CONFIRMATION, DELIBERATE_OFFER, LOOKUP_ERROR_OFFER, PHRASES, REPLIES, RESERVATION_OFFER, TRANSFER_FAILURE } from "./phrases.js";

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

export type Offer = "reservation" | "clarify" | "deliberate" | "error" | "confirmation-1" | "confirmation-2";
type Decision = { action: Action; offer: Offer | null };
const isConfirmation = (text: string) => new RegExp(`^(?:${alternatives(PHRASES.confirmation)})(?: (?:${alternatives(PHRASES.confirmation)}))*$`).test(text);
const nextConfirmation = (offer: Offer): Offer | null =>
  offer === "confirmation-2" ? null : offer === "confirmation-1" ? "confirmation-2" : "confirmation-1";
// null = we answered without an offer; undefined = no record (e.g. first message, server restart).
export interface CallOffers {
  at(userTurn: number): Offer | null | undefined;
  begin(userTurn: number): (offer: Offer | null) => void;
  record(userTurn: number, offer: Offer | null): void;
}

// Vapi replaces spoken assistant turns with a speech transcript of them ("Zuki's" → "Zucchini"),
// so offers are remembered per call and keyed by the user turn they answered, not matched by text.
export function createOfferMemory(ttlMs = 2 * 60 * 60 * 1000, now = () => Date.now()) {
  const calls = new Map<string, { seenAt: number; offers: Map<number, { offer: Offer | null | undefined }> }>();
  const current = (callId: string) => {
    const call = calls.get(callId);
    if (call && now() - call.seenAt > ttlMs) {
      calls.delete(callId);
      return undefined;
    }
    return call;
  };
  return {
    forCall(callId: string): CallOffers {
      const begin = (userTurn: number) => {
          const time = now();
          for (const [id, call] of calls) if (time - call.seenAt > ttlMs) calls.delete(id);
          const call = calls.get(callId) ?? { seenAt: time, offers: new Map() };
          call.seenAt = time;
          const entry = { offer: call.offers.get(userTurn)?.offer };
          call.offers.set(userTurn, entry);
          calls.set(callId, call);
          return (offer: Offer | null) => {
            if (current(callId)?.offers.get(userTurn) === entry) {
              entry.offer = offer;
              call.seenAt = now();
            }
          };
      };
      return {
        at: (userTurn) => current(callId)?.offers.get(userTurn)?.offer,
        begin,
        record: (userTurn, offer) => begin(userTurn)(offer),
      };
    },
  };
}

// Fallback when no record exists: keywords that usually survive the speech transcript.
function offerFromText(text: string): Offer | null {
  const normalized = normalizeForClassification(text);
  if (/\breservations?\b/.test(normalized)) return "reservation";
  if (normalized === normalizeForClassification(CONFIRMATION)) return "confirmation-1";
  if (normalized === normalizeForClassification(DELIBERATE_OFFER)) return "deliberate";
  if (normalized === normalizeForClassification(LOOKUP_ERROR_OFFER)) return "error";
  if (normalized === normalizeForClassification(CLARIFY_OFFER) ||
      /\bnot sure\b|\bfrom our team\b|\btransfer you\b|\brephrase that\b|\bput you through to a team member\b/.test(normalized)) return "clarify";
  return null;
}

const offerOf = (action: Action): Offer | null =>
  action.kind === "speak" && action.text === RESERVATION_OFFER ? "reservation"
    : action.kind === "speak" && action.text === CLARIFY_OFFER ? "clarify"
      : action.kind === "speak" && action.text === DELIBERATE_OFFER ? "deliberate"
        : action.kind === "speak" && action.text === LOOKUP_ERROR_OFFER ? "error"
          : action.kind === "speak" && action.text === CONFIRMATION ? "confirmation-1" : null;

export async function routeConversation(
  messages: readonly Message[], tools: unknown, service: KnowledgeSafeAssistantService, fallback?: string,
  offers?: CallOffers,
): Promise<Action> {
  const userTurn = messages.filter((message) => message.role === "user").length;
  const recordOffer = messages.at(-1)?.role === "user" ? offers?.begin(userTurn) : undefined;
  const decision = await decide(messages, tools, service, fallback, offers);
  recordOffer?.(decision.offer);
  return decision.action;
}

async function decide(
  messages: readonly Message[], tools: unknown, service: KnowledgeSafeAssistantService, fallback?: string,
  offers?: CallOffers,
): Promise<Decision> {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return { action: { kind: "silent" }, offer: null };
  const turn = content(last);
  const normalized = normalizeForClassification(turn);
  const speak = (text: string): Decision => {
    const action: Action = { kind: "speak", text };
    return { action, offer: offerOf(action) };
  };
  const transfer = (): Decision => ({ action: transferAction(tools, fallback), offer: null });
  const pastOffers: (Offer | null)[] = [];
  let usersBefore = 0;
  for (const message of messages.slice(0, -1)) {
    if (message.role === "user") {
      usersBefore++;
      const recorded = offers?.at(usersBefore);
      if (recorded !== undefined) pastOffers.push(recorded);
      else {
        const pending = pastOffers.at(-1);
        const reply = normalizeForClassification(content(message));
        if (pending && PHRASES.yes.some((phrase) => phrase === reply)) pastOffers.push(null);
        else if (pending && isConfirmation(reply)) pastOffers.push(nextConfirmation(pending));
      }
    }
    if (message.role !== "assistant") continue;
    const recorded = offers?.at(usersBefore);
    const inferred = recorded === undefined ? offerFromText(content(message)) : recorded;
    // The preceding user turn already advanced a text-only confirmation counter.
    if (recorded === undefined && inferred === "confirmation-1" &&
        (pastOffers.at(-1) === "confirmation-1" || pastOffers.at(-1) === "confirmation-2")) continue;
    pastOffers.push(inferred);
  }
  let pending = pastOffers.at(-1) ?? null;
  if (pending) {
    if (PHRASES.yes.some((phrase) => phrase === normalized)) return transfer();
    if (isConfirmation(normalized)) {
      const next = nextConfirmation(pending);
      if (next) return { action: { kind: "speak", text: CONFIRMATION }, offer: next };
      pending = null;
    }
    const asksQuestion = turn.includes("?") ||
      new RegExp(`\\b(?:${alternatives(PHRASES.questionWords)})\\b`).test(normalized);
    const startsDecline = PHRASES.declineStart.some((phrase) =>
      normalized === phrase || normalized.startsWith(`${phrase} `));
    if (!asksQuestion && (startsDecline || PHRASES.no.some((phrase) => phrase === normalized))) {
      return speak(REPLIES.declined);
    }
    if (startsDecline) pending = null;
  }
  if (PHRASES.humanOnly.some((phrase) => phrase === normalized) ||
      new RegExp(`\\b(?:${alternatives(PHRASES.humanRequest)}) (?:a |an |the )?(?:${alternatives(PHRASES.human)})\\b`).test(normalized)) return transfer();
  if (new RegExp(`\\b(?:${alternatives(PHRASES.reservation)})\\b`).test(normalized)) return speak(RESERVATION_OFFER);
  if (new RegExp(`^(?:${alternatives(PHRASES.greeting)})(?: (?:${alternatives(PHRASES.greeting)}))?(?: (?:there|zuki))?(?: how are you)?$`).test(normalized)) return speak(REPLIES.greeting);
  const closer = closingAction(normalized);
  if (closer) return { action: closer, offer: closer.kind === "silent" ? pending : null };
  if (PHRASES.filler.some((phrase) => phrase === normalized)) return speak(REPLIES.filler);
  let result: Awaited<ReturnType<KnowledgeSafeAssistantService["lookup"]>>;
  try {
    result = await service.lookup(turn);
  } catch { return speak(LOOKUP_ERROR_OFFER); }
  if (result.status === "answered" || result.status === "clarification_required") {
    return result.text?.trim() ? speak(toSpokenPrices(result.text)) : speak(LOOKUP_ERROR_OFFER);
  }
  const generic = result.status === "unavailable" ||
    (result.status === "transfer_required" && GENERIC_FALLBACK_REASONS.has(result.reason));
  return speak(generic ? CLARIFY_OFFER : DELIBERATE_OFFER);
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
