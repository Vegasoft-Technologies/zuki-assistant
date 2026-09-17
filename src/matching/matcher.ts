import type {
  NormalizedMenuItem,
  NormalizedZukiData,
} from "../data/transformer.js";

import {
  buildSourceNameProfile,
  normalizeMatchText,
  tokenizeMatchText,
} from "./normalize.js";

export interface MatchOptions {
  sectionHint?: string;
}

export interface MenuMatchCandidate {
  itemId: string;
  itemName: string;
  section: string;
  matchedPhrase: string;
  normalizedMatchedPhrase: string;
  matchedTokenCount: number;
  matchedCharacterLength: number;
  item: NormalizedMenuItem;
}

export interface MatchedMenuItemResult {
  status: "matched";
  query: string;
  normalizedQuery: string;
  sectionContext: string | null;
  sectionContextSource:
    | "explicit"
    | "query"
    | null;
  candidate: MenuMatchCandidate;
}

export interface AmbiguousMenuItemResult {
  status: "ambiguous";
  query: string;
  normalizedQuery: string;
  sectionContext: string | null;
  sectionContextSource:
    | "explicit"
    | "query"
    | null;
  candidates: MenuMatchCandidate[];
}

export interface UnknownMenuItemResult {
  status: "unknown";
  query: string;
  normalizedQuery: string;
  sectionContext: string | null;
  sectionContextSource:
    | "explicit"
    | "query"
    | null;
  reason: string;
}

export type MenuMatchResult =
  | MatchedMenuItemResult
  | AmbiguousMenuItemResult
  | UnknownMenuItemResult;

interface IndexedPhrase {
  rawPhrase: string;
  normalizedPhrase: string;
  tokenCount: number;
  characterLength: number;
}

interface IndexedMenuItem {
  item: NormalizedMenuItem;
  section: string;
  normalizedSection: string;
  phrases: IndexedPhrase[];
}

interface SectionContext {
  section: string;
  source: "explicit" | "query";
}

function containsNormalizedPhrase(
  normalizedText: string,
  normalizedPhrase: string,
): boolean {
  if (
    normalizedText.length === 0 ||
    normalizedPhrase.length === 0
  ) {
    return false;
  }

  return ` ${normalizedText} `.includes(
    ` ${normalizedPhrase} `,
  );
}

function compareCandidateSpecificity(
  left: MenuMatchCandidate,
  right: MenuMatchCandidate,
): number {
  if (
    left.matchedTokenCount !==
    right.matchedTokenCount
  ) {
    return (
      right.matchedTokenCount -
      left.matchedTokenCount
    );
  }

  if (
    left.matchedCharacterLength !==
    right.matchedCharacterLength
  ) {
    return (
      right.matchedCharacterLength -
      left.matchedCharacterLength
    );
  }

  const sectionComparison =
    left.section.localeCompare(
      right.section,
      "en",
    );

  if (sectionComparison !== 0) {
    return sectionComparison;
  }

  return left.itemId.localeCompare(
    right.itemId,
    "en",
  );
}

function chooseBestPhraseForItem(
  query: string,
  indexedItem: IndexedMenuItem,
): MenuMatchCandidate | null {
  const matchingPhrases =
    indexedItem.phrases.filter((phrase) =>
      containsNormalizedPhrase(
        query,
        phrase.normalizedPhrase,
      ),
    );

  if (matchingPhrases.length === 0) {
    return null;
  }

  matchingPhrases.sort((left, right) => {
    if (left.tokenCount !== right.tokenCount) {
      return right.tokenCount - left.tokenCount;
    }

    return (
      right.characterLength -
      left.characterLength
    );
  });

  const bestPhrase = matchingPhrases[0];

  if (bestPhrase === undefined) {
    return null;
  }

  return {
    itemId: indexedItem.item.item_id,
    itemName: indexedItem.item.name,
    section: indexedItem.section,
    matchedPhrase: bestPhrase.rawPhrase,
    normalizedMatchedPhrase:
      bestPhrase.normalizedPhrase,
    matchedTokenCount: bestPhrase.tokenCount,
    matchedCharacterLength:
      bestPhrase.characterLength,
    item: indexedItem.item,
  };
}

function keepMostSpecificCandidates(
  candidates: MenuMatchCandidate[],
): MenuMatchCandidate[] {
  if (candidates.length === 0) {
    return [];
  }

  const remaining = candidates.filter(
    (candidate) =>
      !candidates.some((other) => {
        if (other.itemId === candidate.itemId) {
          return false;
        }

        const otherIsMoreSpecific =
          other.matchedTokenCount >
            candidate.matchedTokenCount &&
          containsNormalizedPhrase(
            other.normalizedMatchedPhrase,
            candidate.normalizedMatchedPhrase,
          );

        return otherIsMoreSpecific;
      }),
  );

  return [...remaining].sort(
    compareCandidateSpecificity,
  );
}
function detectExplicitSectionContext(
  sectionHint: string,
  candidateSections: readonly string[],
): SectionContext | null {
  const normalizedHint =
    normalizeMatchText(sectionHint);

  if (normalizedHint.length === 0) {
    return null;
  }

  const matches = candidateSections.filter(
    (section) => {
      const normalizedSection =
        normalizeMatchText(section);

      return (
        normalizedHint === normalizedSection ||
        containsNormalizedPhrase(
          normalizedHint,
          normalizedSection,
        )
      );
    },
  );

  const uniqueMatches = [...new Set(matches)];

  if (uniqueMatches.length !== 1) {
    return null;
  }

  const section = uniqueMatches[0];

  if (section === undefined) {
    return null;
  }

  return {
    section,
    source: "explicit",
  };
}

function detectQuerySectionContext(
  normalizedQuery: string,
  candidateSections: readonly string[],
): SectionContext | null {
  const matches = candidateSections.filter(
    (section) =>
      containsNormalizedPhrase(
        normalizedQuery,
        normalizeMatchText(section),
      ),
  );

  const uniqueMatches = [...new Set(matches)];

  if (uniqueMatches.length !== 1) {
    return null;
  }

  const section = uniqueMatches[0];

  if (section === undefined) {
    return null;
  }

  return {
    section,
    source: "query",
  };
}

function buildIndex(
  data: NormalizedZukiData,
): IndexedMenuItem[] {
  return data.menu.flatMap((section) =>
    section.items.map((item) => {
      const profile =
        buildSourceNameProfile(item.name);

      const phrases: IndexedPhrase[] =
        profile.sourceDerivedPhrases
          .map((rawPhrase) => {
            const normalizedPhrase =
              normalizeMatchText(rawPhrase);

            return {
              rawPhrase,
              normalizedPhrase,
              tokenCount:
                tokenizeMatchText(
                  normalizedPhrase,
                ).length,
              characterLength:
                normalizedPhrase.length,
            };
          })
          .filter(
            (phrase) =>
              phrase.normalizedPhrase.length > 0,
          );

      return {
        item,
        section: section.section,
        normalizedSection:
          normalizeMatchText(
            section.section,
          ),
        phrases,
      };
    }),
  );
}

export function createMenuMatcher(
  data: NormalizedZukiData,
): (
  query: string,
  options?: MatchOptions,
) => MenuMatchResult {
  const index = buildIndex(data);

  return (
    query: string,
    options: MatchOptions = {},
  ): MenuMatchResult => {
    const normalizedQuery =
      normalizeMatchText(query);

    if (normalizedQuery.length === 0) {
      return {
        status: "unknown",
        query,
        normalizedQuery,
        sectionContext: null,
        sectionContextSource: null,
        reason:
          "The query contains no matchable text.",
      };
    }

    let candidates = index
      .map((indexedItem) =>
        chooseBestPhraseForItem(
          normalizedQuery,
          indexedItem,
        ),
      )
      .filter(
        (
          candidate,
        ): candidate is MenuMatchCandidate =>
          candidate !== null,
      );

    if (candidates.length === 0) {
      return {
        status: "unknown",
        query,
        normalizedQuery,
        sectionContext: null,
        sectionContextSource: null,
        reason:
          "No source-backed menu item phrase matched the query.",
      };
    }

    const candidateSections = [
      ...new Set(
        candidates.map(
          (candidate) => candidate.section,
        ),
      ),
    ];

    let sectionContext: SectionContext | null =
      null;

    if (options.sectionHint !== undefined) {
      sectionContext =
        detectExplicitSectionContext(
          options.sectionHint,
          candidateSections,
        );

      if (sectionContext === null) {
        return {
          status: "unknown",
          query,
          normalizedQuery,
          sectionContext: null,
          sectionContextSource: null,
          reason:
            "The provided section hint does not uniquely match a source section containing the candidate item.",
        };
      }
    } else {
      sectionContext =
        detectQuerySectionContext(
          normalizedQuery,
          candidateSections,
        );
    }

    if (sectionContext !== null) {
      candidates = candidates.filter(
        (candidate) =>
          candidate.section ===
          sectionContext.section,
      );

      if (candidates.length === 0) {
        return {
          status: "unknown",
          query,
          normalizedQuery,
          sectionContext:
            sectionContext.section,
          sectionContextSource:
            sectionContext.source,
          reason:
            "No candidate remains after applying the source-backed section context.",
        };
      }
    }

    candidates =
      keepMostSpecificCandidates(
        candidates,
      );

    if (candidates.length === 1) {
      const candidate = candidates[0];

      if (candidate === undefined) {
        throw new Error(
          "Matcher reached an invalid single-candidate state.",
        );
      }

      return {
        status: "matched",
        query,
        normalizedQuery,
        sectionContext:
          sectionContext?.section ?? null,
        sectionContextSource:
          sectionContext?.source ?? null,
        candidate,
      };
    }

    return {
      status: "ambiguous",
      query,
      normalizedQuery,
      sectionContext:
        sectionContext?.section ?? null,
      sectionContextSource:
        sectionContext?.source ?? null,
      candidates,
    };
  };
}