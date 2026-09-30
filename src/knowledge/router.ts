import type {
  NormalizedZukiData,
} from "../data/transformer.js";

export type KnowledgeStatus =
  | "known"
  | "transfer_required"
  | "no_match";

export interface KnowledgeResult {
  status: KnowledgeStatus;
  topic?:
    | "opening_hours"
    | "location"
    | "vegan"
    | "dog"
    | "parking"
    | "card";
  answer?: string;
  reason?: string;
}

type BusinessFacts =
  NonNullable<
    NormalizedZukiData["business_facts"]
  >;

type BusinessFactKey =
  | "dog_policy"
  | "parking"
  | "card_payments";

const VERIFIED_BUSINESS_FACT_STATUSES =
  new Set([
    "verified",
    "verified_third_party",
    "verified_business_managed_listing",
  ]);

function getVerifiedBusinessFact(
  data: NormalizedZukiData,
  key: BusinessFactKey,
): string | undefined {
  const facts =
    data.business_facts;

  if (facts === undefined) {
    return undefined;
  }

  const value = facts[key];
  const provenance =
    facts.provenance[key];

  if (
    value === undefined ||
    provenance === undefined ||
    !VERIFIED_BUSINESS_FACT_STATUSES.has(
      provenance.status,
    )
  ) {
    return undefined;
  }

  return value;
}

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type Day = (typeof DAYS)[number];

function normalizeQuery(
  query: string,
): string {
  return query
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholePhrase(
  query: string,
  phrase: string,
): boolean {
  return ` ${query} `.includes(
    ` ${phrase} `,
  );
}

function formatTime(
  value: string,
): string {
  const [hourText, minuteText] =
    value.split(":");

  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return value;
  }

  const suffix =
    hour >= 12 ? "PM" : "AM";

  const displayHour =
    hour % 12 === 0 ? 12 : hour % 12;

  if (minute === 0) {
    return `${displayHour} ${suffix}`;
  }

  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function findDay(
  query: string,
): Day | undefined {
  const days = DAYS.filter(
    (day) => new RegExp(`\\b${day}s?\\b`, "u").test(query),
  );
  return days.length === 1 ? days[0] : undefined;
}

export type OpeningHoursIntent =
  | "open"
  | "close"
  | "range";

interface OpeningHoursRule {
  intent: OpeningHoursIntent;
  pattern: RegExp;
}

function normalizeOpeningHoursQuery(
  rawQuery: string,
): string {
  let query =
    normalizeQuery(rawQuery)
      .replace(
        /\bwhat s\b/gu,
        "what is",
      )
      .replace(
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s\b/gu,
        "$1",
      )
      .trim();

  // Remove harmless telephone fillers only from the beginning.
  query = query
    .replace(
      /^(?:(?:uh+|um+|erm|er|hey|hi|hello|so|well|okay|ok|yeah|please)\s+)+/u,
      "",
    )
    .replace(
      /^(?:(?:can|could) you tell me|just wondering|i(?: am| m| was)? just wondering)\s+/u,
      "",
    )
    .trim();

  // ASR can duplicate short fragments while finalising a transcript.
  let previous = "";
  while (previous !== query) {
    previous = query;

    query = query
      .replace(
        /^(what time|when)\s+\1\b/u,
        "$1",
      )
      .replace(
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\1\b/u,
        "$1",
      )
      .trim();
  }

  // British/common spoken wording.
  query = query
    .replace(
      /^what are (monday|tuesday|wednesday|thursday|friday|saturday|sunday) opening times\b/u,
      "$1 opening hours",
    )
    .replace(
      /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday) opening times\b/u,
      "$1 opening hours",
    )
    .replace(
      /^what times are you(?: guys)? open\b/u,
      "what hours are you open",
    )
    .replace(
      /^your (monday|tuesday|wednesday|thursday|friday|saturday|sunday) hours\b/u,
      "what are your $1 hours",
    );

  // Dropped auxiliary verbs are a common final-ASR degradation.
  // Apply the most specific closing-time forms before the generic
  // "what time/when you ..." rewrites so they cannot consume them first.
  query = query
    .replace(
      /\btill when you open\b/gu,
      "until when are you open",
    )
    .replace(
      /\buntil when you open\b/gu,
      "until when are you open",
    )
    .replace(
      /\b(?:till|until) what time you open\b/gu,
      "until what time are you open",
    )
    .replace(
      /\bhow late you open\b/gu,
      "how late are you open",
    )
    .replace(
      /\b(what time|when) you (open|close|shut)\b/gu,
      "$1 do you $2",
    )
    .replace(
      /\b(what time|when) (zuki|cafe) (open|close|shut)\b/gu,
      "$1 does $2 $3",
    )
    .trim();

  return query;
}

function isScopedNonBusinessHoursQuery(
  query: string,
): boolean {
  return /\b(?:delivery|kitchen)\b/u.test(
    query,
  ) || /\bfor\s+(?:breakfast|brunch|lunch|dinner)\b/u.test(
    query.split(/\b(?:i|we)\b/u)[0] ?? "",
  );
}

const OPENING_HOURS_RULES:
  readonly OpeningHoursRule[] = [
    // Full opening-hours range.
    {
      intent: "range",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?what are your (?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) )?(?:(?:opening|business) )?hours(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|thanks?|i|we|and)\b)/u,
    },
    {
      intent: "range",
      pattern:
        /^what are (?:the )?(?:cafe|cafe s|zuki|zuki s) (?:(?:opening|business) )?hours(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|thanks?|i|we|and)\b)/u,
    },
    {
      intent: "range",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what are )?(?:the )?(?:opening|business) hours(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|thanks?|i|we|and)\b)/u,
    },
    {
      intent: "range",
      pattern:
        /^(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) (?:(?:opening|business) )?hours(?=$|\s+(?:please|thanks?|i|we|and)\b)/u,
    },
    {
      intent: "range",
      pattern:
        /^what hours are you(?: guys)? open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|thanks?|i|we|and)\b)/u,
    },
    {
      intent: "range",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what time|when|at what time) (?:do you(?: guys)? open(?:ing)? and (?:close|shut)|are you(?: guys)? opening and (?:closing|shutting)|will you(?: guys)? open and (?:close|shut))(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },

    // Closing time.
    {
      intent: "close",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what time|when|at what time) (?:do you(?: guys)? (?:close|shut)|are you(?: guys)? (?:closing|closed|shutting)|will you(?: guys)? (?:close|shut))(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:do you(?: guys)? (?:close|shut)|are you(?: guys)? (?:closing|closed|shutting)|will you(?: guys)? (?:close|shut))(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what time|when|at what time) does (?:the )?(?:cafe|zuki(?: s)?) (?:close|shut)(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^what is (?:your|(?:the )?cafe(?: s)?|zuki(?: s)?) closing time(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^how late (?:are you(?: guys)? open|do you(?: guys)? stay open|is (?:the )?(?:cafe|zuki(?: s)?) open)(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^(?:until|till) what time are you(?: guys)? open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^until when are you(?: guys)? open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "close",
      pattern:
        /^what time are you(?: guys)? open (?:until|till)(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },

    // Opening time / open status.
    {
      intent: "open",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what time|when|at what time) (?:do you(?: guys)? open|are you(?: guys)? (?:open|opening)|will you(?: guys)? open)(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "open",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:do|are) you(?: guys)? open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:right now|please|i|we|and)\b)/u,
    },
    {
      intent: "open",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?will you(?: guys)? be open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "open",
      pattern:
        /^are you(?: guys)? still open\b/u,
    },
    {
      intent: "open",
      pattern:
        /^is (?:the )?(?:cafe|zuki(?: s)?) open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "open",
      pattern:
        /^(?:(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(?:what time|when|at what time) does (?:the )?(?:cafe|zuki(?: s)?) open(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b|\s+(?:please|i|we|and)\b)/u,
    },
    {
      intent: "open",
      pattern:
        /^what is (?:your|(?:the )?cafe(?: s)?|zuki(?: s)?) opening time(?=$|\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\s+(?:please|i|we|and)\b)/u,
    },
  ];

interface OpeningHoursMatch {
  query: string;
  intent: OpeningHoursIntent;
  matchedText: string;
}

function matchOpeningHoursIntent(
  rawQuery: string,
): OpeningHoursMatch | undefined {
  const query =
    normalizeOpeningHoursQuery(rawQuery);

  if (
    isScopedNonBusinessHoursQuery(query)
  ) {
    return undefined;
  }

  for (const rule of OPENING_HOURS_RULES) {
    const match =
      rule.pattern.exec(query);

    if (match !== null) {
      let matchedText =
        match[0];

      const trailingDay =
        query
          .slice(matchedText.length)
          .match(
            /^\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u,
          );

      if (trailingDay !== null) {
        matchedText += trailingDay[0];
      }

      return {
        query,
        intent: rule.intent,
        matchedText,
      };
    }
  }

  return undefined;
}

export function classifyOpeningHoursIntent(
  rawQuery: string,
): OpeningHoursIntent | undefined {
  return matchOpeningHoursIntent(
    rawQuery,
  )?.intent;
}

export function stripOpeningHoursIntentPrefix(
  rawQuery: string,
): string {
  const query =
    normalizeOpeningHoursQuery(rawQuery);

  const match =
    matchOpeningHoursIntent(query);

  if (match === undefined) {
    return query;
  }

  return match.query
    .slice(match.matchedText.length)
    .trim();
}

function buildHoursAnswer(
  data: NormalizedZukiData,
  query: string,
): KnowledgeResult | undefined {
  const intent =
    classifyOpeningHoursIntent(query);

  if (intent === undefined) {
    return undefined;
  }

  const day =
    findDay(query);

  if (day === undefined) {
    return {
      status: "transfer_required",
      topic: "opening_hours",
      reason:
        "A specific day was not identified.",
    };
  }

  const hours =
    data.opening_hours[day];

  if (hours === undefined) {
    return {
      status: "transfer_required",
      topic: "opening_hours",
      reason:
        `No verified opening hours were found for ${day}.`,
    };
  }

  if (intent === "close") {
    return {
      status: "known",
      topic: "opening_hours",
      answer:
        `On ${day}, Zuki's closes at ${formatTime(hours.close)}.`,
    };
  }

  if (intent === "open") {
    return {
      status: "known",
      topic: "opening_hours",
      answer:
        `On ${day}, Zuki's opens at ${formatTime(hours.open)}.`,
    };
  }

  return {
    status: "known",
    topic: "opening_hours",
    answer:
      `On ${day}, Zuki's is open from ${formatTime(hours.open)} to ${formatTime(hours.close)}.`,
  };
}

function buildVeganAnswer(
  data: NormalizedZukiData,
  query: string,
): KnowledgeResult | undefined {
  if (!query.includes("vegan")) {
    return undefined;
  }

  const asksUnsupportedDietaryDetail =
    /\b(?:allerg\w*|gluten|coeliac|celiac|soy|nuts?|cross contamination)\b/u.test(
      query,
    );

  if (asksUnsupportedDietaryDetail) {
    return {
      status: "transfer_required",
      topic: "vegan",
      reason:
        "The requested dietary or allergy detail is not verified in the current source data.",
    };
  }

  const veganItems =
    data.menu.flatMap(
      (section) =>
        section.items.filter(
          (item) =>
            item.dietary?.includes(
              "vegan",
            ) === true,
        ),
    );

  if (veganItems.length === 0) {
    return {
      status: "transfer_required",
      topic: "vegan",
      reason:
        "No verified vegan items were found.",
    };
  }

  const examples =
    veganItems
      .slice(0, 5)
      .map((item) => item.name);

  return {
    status: "known",
    topic: "vegan",
    answer:
      `Yes. Zuki's has vegan options including ${examples.join(", ")}.`,
  };
}

function buildPolicyAnswer(
  data: NormalizedZukiData,
  query: string,
): KnowledgeResult | undefined {
  const asksDog =
    hasWholePhrase(query, "dog") ||
    hasWholePhrase(query, "dogs");

  const asksSpecificDogPolicy =
    query.includes("inside") ||
    query.includes("indoor") ||
    query.includes("outside") ||
    query.includes("outdoor") ||
    query.includes("kitchen") ||
    query.includes("water bowl") ||
    query.includes("water bowls") ||
    query.includes("patio") ||
    query.includes("terrace") ||
    query.includes("leash") ||
    query.includes("lead") ||
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+dogs?\b/u.test(query);

  if (
    asksDog &&
    asksSpecificDogPolicy
  ) {
    return {
      status: "transfer_required",
      topic: "dog",
      reason:
        "Specific dog-policy details are not verified in the current source data.",
    };
  }

  if (asksDog) {
    const dogPolicy =
      getVerifiedBusinessFact(
        data,
        "dog_policy",
      );

    if (dogPolicy === undefined) {
      return {
        status: "transfer_required",
        topic: "dog",
        reason:
          "Dog policy is not verified in the current source data.",
      };
    }

    return {
      status: "known",
      topic: "dog",
      answer: dogPolicy,
    };
  }

  const asksParking =
    query.includes("parking") ||
    query.includes("park my car") ||
    query.includes("car park") ||
    /\bpark\b/u.test(query);

  const asksSpecificParkingPolicy =
    /\bown\b|\bfree\b|\bdisabled\b|\baccessible\b|\bon[- ]?site\b|\bdirectly outside\b/u.test(query);

  if (
    asksParking &&
    asksSpecificParkingPolicy
  ) {
    return {
      status: "transfer_required",
      topic: "parking",
      reason:
        "Specific parking details are not verified in the current source data.",
    };
  }

  if (asksParking) {
    const parking =
      getVerifiedBusinessFact(
        data,
        "parking",
      );

    if (parking === undefined) {
      return {
        status: "transfer_required",
        topic: "parking",
        reason:
          "Parking information is not verified in the current source data.",
      };
    }

    return {
      status: "known",
      topic: "parking",
      answer: parking,
    };
  }

  if (hasWholePhrase(query, "contactless")) {
    return {
      status: "transfer_required",
      topic: "card",
      reason:
        "Contactless payment support is not verified in the current source data.",
    };
  }

  const asksMinimumCardSpend =
    /\b(?:minimum|min)\b.*\b(?:card|spend)\b|\bcard\b.*\b(?:minimum|min)\b/u.test(query);

  if (asksMinimumCardSpend) {
    return {
      status: "transfer_required",
      topic: "card",
      reason:
        "Minimum card-spend requirements are not verified in the current source data.",
    };
  }
  const asksCard =
    hasWholePhrase(query, "card") ||
    hasWholePhrase(query, "credit card") ||
    hasWholePhrase(query, "debit card") ||
    hasWholePhrase(query, "payment");

  if (asksCard) {
    const cardPayments =
      getVerifiedBusinessFact(
        data,
        "card_payments",
      );

    if (cardPayments === undefined) {
      return {
        status: "transfer_required",
        topic: "card",
        reason:
          "Card payment information is not verified in the current source data.",
      };
    }

    return {
      status: "known",
      topic: "card",
      answer: cardPayments,
    };
  }

  return undefined;
}

export function lookupBusinessKnowledge(
  data: NormalizedZukiData,
  rawQuery: string,
): KnowledgeResult {
  const query =
    normalizeQuery(rawQuery);

  const asksLocation =
    /\b(?:where are you located|your (?:address|location))\b|\bwhere are you(?=$|\s+(?:and|i|we)\b)/u.test(query);

  const businessIntents = [
    classifyOpeningHoursIntent(query) !== undefined,
    asksLocation,
    query.includes("vegan"),
    hasWholePhrase(query, "dog") ||
      hasWholePhrase(query, "dogs"),
    query.includes("parking") ||
      query.includes("park my car") ||
      query.includes("car park") ||
      /\bpark\b/u.test(query),
    hasWholePhrase(query, "card") ||
      hasWholePhrase(query, "credit card") ||
      hasWholePhrase(query, "debit card") ||
      hasWholePhrase(query, "payment") ||
      hasWholePhrase(query, "contactless"),
  ].filter(Boolean).length;

  if (businessIntents > 1) {
    return {
      status: "transfer_required",
      reason:
        "The request combines multiple intents that cannot be answered safely from a single verified fact.",
    };
  }

  if (asksLocation) {
    return {
      status: "known",
      topic: "location",
      answer: data.business.address,
    };
  }

  const hours =
    buildHoursAnswer(
      data,
      query,
    );

  if (hours !== undefined) {
    return hours;
  }

  const vegan =
    buildVeganAnswer(
      data,
      query,
    );

  if (vegan !== undefined) {
    return vegan;
  }

  const policy =
    buildPolicyAnswer(
      data,
      query,
    );

  if (policy !== undefined) {
    return policy;
  }

  return {
    status: "no_match",
  };
}
