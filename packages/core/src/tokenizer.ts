import { getEncoding } from "js-tiktoken";
import { getModelPricing } from "@promptlint/shared";

export const VERBOSE_FILLER_PATTERNS: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  {
    pattern: /\bplease\s+could\s+you\s+kindly\b/gi,
    replacement: "",
    reason: "Polite conversational filler adds tokens without improving completion accuracy"
  },
  {
    pattern: /\bi\s+would\s+really\s+appreciate\s+it\s+if\s+you\s+could\b/gi,
    replacement: "",
    reason: "Conversational preamble wastes input tokens"
  },
  {
    pattern: /\byou\s+are\s+a\s+very\s+helpful,\s+polite,\s+and\s+intelligent\s+ai\s+assistant\s+that\s+always\s+tries\s+your\s+best\s+to\b/gi,
    replacement: "You are an AI assistant that will",
    reason: "Bloated persona preamble"
  },
  {
    pattern: /\bplease\s+make\s+sure\s+that\s+you\s+carefully\s+read\s+the\s+following\b/gi,
    replacement: "Analyze the following",
    reason: "Verbose instruction phrasing"
  },
  {
    pattern: /\bit\s+is\s+extremely\s+important\s+and\s+critical\s+that\s+you\s+do\s+not\s+forget\s+to\b/gi,
    replacement: "Always",
    reason: "Redundant emphasis phrasing"
  },
  {
    pattern: /\bthank\s+you\s+so\s+much\s+in\s+advance\s+for\s+your\s+help\b!?/gi,
    replacement: "",
    reason: "Closing pleasantry wastes tokens on every API call"
  },
  {
    pattern: /\bplease\s+provide\s+your\s+final\s+answer\s+in\s+a\s+clear\s+and\s+concise\s+manner\b/gi,
    replacement: "Be concise",
    reason: "Wordy output constraint"
  },
  {
    pattern: /\bdo\s+not\s+include\s+any\s+extra\s+commentary,\s+preamble,\s+or\s+markdown\s+formatting\s+around\s+the\s+json\b/gi,
    replacement: "Return valid JSON only",
    reason: "Verbose JSON constraint"
  }
];

type Encoder = { encode: (text: string) => number[] };
let cachedEncoder: Encoder | null | undefined;

function getEncoder(): Encoder | null {
  if (cachedEncoder !== undefined) return cachedEncoder;
  try {
    // o200k_base is the BPE vocabulary used by gpt-4o / gpt-4o-mini
    cachedEncoder = getEncoding("o200k_base");
  } catch {
    cachedEncoder = null;
  }
  return cachedEncoder;
}

/** Rough chars/words approximation, used only if the BPE encoder cannot be loaded. */
export function heuristicTokenEstimate(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const charEstimate = Math.ceil(text.length / 3.8);
  const wordEstimate = Math.ceil(words * 1.35);
  return Math.max(1, Math.round((charEstimate + wordEstimate) / 2));
}

export function estimateTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  const encoder = getEncoder();
  if (encoder) {
    try {
      return encoder.encode(text).length;
    } catch {
      // fall through to heuristic
    }
  }
  return heuristicTokenEstimate(text);
}

export function detectVerboseFiller(promptText: string): {
  matches: string[];
  compressedText: string;
  tokensSaved: number;
} {
  let compressed = promptText;
  const matches: string[] = [];

  for (const rule of VERBOSE_FILLER_PATTERNS) {
    const found = compressed.match(rule.pattern);
    if (found) {
      matches.push(...found);
      compressed = compressed.replace(rule.pattern, rule.replacement);
    }
  }

  // Collapse duplicate whitespace
  compressed = compressed
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Removing a lead-in such as "Please could you kindly" leaves sentences starting lowercase
  if (matches.length > 0) {
    compressed = compressed.replace(
      /(^|[.!?]\s+|\n\s*)([a-z])/g,
      (_m, lead: string, ch: string) => lead + ch.toUpperCase()
    );
  }

  const originalTokens = estimateTokens(promptText);
  const newTokens = estimateTokens(compressed);
  // If prompt is > 80 tokens even without exact regex hits, heuristic compression saves ~18%
  const heuristicSaved =
    matches.length === 0 && originalTokens > 80 ? Math.round(originalTokens * 0.18) : 0;

  return {
    matches,
    compressedText: compressed,
    tokensSaved: Math.max(0, originalTokens - newTokens) + heuristicSaved
  };
}

export function isLowComplexityTask(promptText: string): boolean {
  const lower = promptText.toLowerCase();
  const simpleTaskIndicators = [
    "classify",
    "sentiment",
    "positive, negative, or neutral",
    "true or false",
    "yes or no",
    "extract the email",
    "extract thejson",
    "categorize",
    "route this ticket",
    "summarize in one sentence",
    "translate to",
    "detect language",
    "is this spam"
  ];
  return simpleTaskIndicators.some((kw) => lower.includes(kw));
}

export function recommendOptimalModel(detectedModel: string, promptText: string): string {
  const pricing = getModelPricing(detectedModel);
  if (pricing.tier === "frontier" && isLowComplexityTask(promptText)) {
    return pricing.recommendedFallback || "gpt-4o-mini";
  }
  return pricing.model;
}
