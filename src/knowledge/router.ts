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
  return DAYS.find(
    (day) => query.includes(day),
  );
}

function buildHoursAnswer(
  data: NormalizedZukiData,
  query: string,
): KnowledgeResult | undefined {
  const asksHours =
    query.includes("open") ||
    query.includes("close") ||
    query.includes("opening hour") ||
    query.includes("closing hour");

  if (!asksHours) {
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

  if (
    query.includes("close") &&
    !query.includes("open")
  ) {
    return {
      status: "known",
      topic: "opening_hours",
      answer:
        `On ${day}, Zuki's closes at ${formatTime(hours.close)}.`,
    };
  }

  if (
    query.includes("open") &&
    !query.includes("close")
  ) {
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

  const businessIntents = [
    query.includes("open") ||
      query.includes("close") ||
      query.includes("opening hour") ||
      query.includes("closing hour"),
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
