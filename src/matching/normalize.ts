export interface MatchingTextProfile {
  raw: string;
  normalized: string;
  tokens: string[];
}

export interface SourceNameProfile {
  sourceName: string;
  normalizedName: string;
  sourceDerivedPhrases: string[];
  normalizedSourceDerivedPhrases: string[];
  tokens: string[];
}

function uniquePreservingOrder(
  values: readonly string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function normalizeMatchText(
  value: string,
): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .replace(/[’‘`']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeMatchText(
  value: string,
): string[] {
  const normalized = normalizeMatchText(value);

  if (normalized.length === 0) {
    return [];
  }

  return normalized.split(" ");
}

export function deriveSourceNamePhrases(
  sourceName: string,
): string[] {
  const trimmedName = sourceName.trim();

  if (trimmedName.length === 0) {
    return [];
  }

  const delimiterParts = trimmedName
    .split(/\s+\/\s+|\s*·\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return uniquePreservingOrder([
    trimmedName,
    ...delimiterParts,
  ]);
}

export function buildMatchingTextProfile(
  raw: string,
): MatchingTextProfile {
  return {
    raw,
    normalized: normalizeMatchText(raw),
    tokens: tokenizeMatchText(raw),
  };
}

export function buildSourceNameProfile(
  sourceName: string,
): SourceNameProfile {
  const sourceDerivedPhrases =
    deriveSourceNamePhrases(sourceName);

  const normalizedSourceDerivedPhrases =
    uniquePreservingOrder(
      sourceDerivedPhrases
        .map(normalizeMatchText)
        .filter(
          (phrase) => phrase.length > 0,
        ),
    );

  return {
    sourceName,
    normalizedName:
      normalizeMatchText(sourceName),
    sourceDerivedPhrases,
    normalizedSourceDerivedPhrases,
    tokens: tokenizeMatchText(sourceName),
  };
}