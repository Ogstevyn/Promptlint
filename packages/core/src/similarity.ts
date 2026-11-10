/**
 * Measures how closely two model outputs agree, returning a 0-100 score.
 *
 * - If both outputs parse as JSON objects, the score is the share of top-level
 *   keys (union of both sides) whose values match. Strings compare
 *   case-insensitively after trimming, and numbers match within 5% of each other.
 * - Otherwise the score is the token-set F1 over normalized words.
 */
export function computeOutputAgreement(a: string, b: string): number {
  const jsonA = tryParseJsonObject(a);
  const jsonB = tryParseJsonObject(b);

  if (jsonA && jsonB) {
    const keys = new Set([...Object.keys(jsonA), ...Object.keys(jsonB)]);
    if (keys.size === 0) return 100;
    let matched = 0;
    for (const key of keys) {
      if (key in jsonA && key in jsonB && valuesMatch(jsonA[key], jsonB[key])) {
        matched++;
      }
    }
    return round1((matched / keys.size) * 100);
  }

  const wordsA = wordSet(a);
  const wordsB = wordSet(b);
  if (wordsA.size === 0 && wordsB.size === 0) return 100;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const precision = overlap / wordsB.size;
  const recall = overlap / wordsA.size;
  if (precision + recall === 0) return 0;
  return round1(((2 * precision * recall) / (precision + recall)) * 100);
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  if (!unfenced.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function valuesMatch(x: unknown, y: unknown): boolean {
  if (typeof x === "string" && typeof y === "string") {
    return x.trim().toLowerCase() === y.trim().toLowerCase();
  }
  if (typeof x === "number" && typeof y === "number") {
    return Math.abs(x - y) <= 0.05 * Math.max(Math.abs(x), Math.abs(y), 1e-9);
  }
  return JSON.stringify(x) === JSON.stringify(y);
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0)
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
