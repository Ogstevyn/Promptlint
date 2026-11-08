import { ExtractedPrompt, SourceLanguage } from "@promptlint/shared";
import { estimateTokens, recommendOptimalModel } from "./tokenizer";

export function detectLanguage(filePath: string, code: string): SourceLanguage {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) {
    return "javascript";
  }

  // Heuristic detection from code content
  if (/\bdef\s+\w+\s*\(|\bfrom\s+openai\s+import|\bimport\s+anthropic/.test(code)) {
    return "python";
  }
  if (
    /\bconst\s+\w+|\bimport\s+.*from\s+['"]|\.chat\.completions\.create\(|\.messages\.create\(/.test(
      code
    )
  ) {
    return "typescript";
  }
  return "raw-prompt";
}

function extractVariables(template: string): string[] {
  const vars = new Set<string>();

  // JS/TS template literal ${varName}
  const jsMatches = template.matchAll(/\$\{\s*([^}]+?)\s*\}/g);
  for (const m of jsMatches) {
    vars.add(m[1].trim());
  }

  // Python f-string ormustache {varName} / {{varName}}
  const braceMatches = template.matchAll(/(?<!\$)\{\{?\s*([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\s*\}?\}/g);
  for (const m of braceMatches) {
    vars.add(m[1].trim());
  }

  // String concatenation + userInput
  const concatMatches = template.matchAll(/\+\s*([a-zA-Z_][a-zA-Z0-9_.]*)/g);
  for (const m of concatMatches) {
    vars.add(m[1].trim());
  }

  return Array.from(vars);
}

function checkDynamicPrefixBeforeStatic(template: string): boolean {
  const firstVarMatch = template.search(/(\$\{[^}]+\}|\{[a-zA-Z_][a-zA-Z0-9_.]*\})/);
  if (firstVarMatch === -1) return false;
  const textBefore = template.slice(0, firstVarMatch).trim();
  const textAfter = template.slice(firstVarMatch).trim();
  // If dynamic variable appears in the first 35% of a substantial prompt and lots of static context follows
  return textBefore.length < 160 && textAfter.length > 180;
}

function checkHasDelimitersAroundVars(template: string, variables: string[]): boolean {
  if (variables.length === 0) return true;
  const hasXmlGuard = /<(user_input|context|query|document|untrusted_input)>/i.test(template);
  return hasXmlGuard;
}

export function extractPromptsFromCode(
  code: string,
  filePath = "playground.ts",
  explicitLanguage?: SourceLanguage
): ExtractedPrompt[] {
  const language = explicitLanguage || detectLanguage(filePath, code);
  const lines = code.split(/\r?\n/);

  const fileUsesOtari =
    /otari\.ai|OTARI_BASE_URL|Otari-Key/i.test(code);
  const fileHasIdempotency = /Idempotency-Key/i.test(code);
  const fileHasCacheControl = /cache_control/i.test(code);

  // Locate LLM SDK call blocks (`completions.create`, `messages.create`, `responses.create`)
  const callRegex =
    /(?:chat\.completions\.create|messages\.create|responses\.create|generateText)\s*\(/g;
  const prompts: ExtractedPrompt[] = [];

  let match: RegExpExecArray | null;
  let callIndex = 0;

  while ((match = callRegex.exec(code)) !== null) {
    callIndex++;
    const startOffset = match.index;
    const startLine = code.slice(0, startOffset).split(/\r?\n/).length;

    // Find balanced closing parenthesis for the call block
    let depth = 0;
    let endOffset = startOffset;
    let foundOpen = false;
    for (let i = startOffset; i < code.length; i++) {
      if (code[i] === "(") {
        depth++;
        foundOpen = true;
      } else if (code[i] === ")") {
        depth--;
        if (foundOpen && depth === 0) {
          endOffset = i + 1;
          break;
        }
      }
    }
    if (endOffset <= startOffset) {
      endOffset = Math.min(code.length, startOffset + 1200);
    }

    const rawCallBlock = code.slice(startOffset, endOffset);
    const endLine = code.slice(0, endOffset).split(/\r?\n/).length;

    // Detect model inside call block
    const modelMatch = rawCallBlock.match(/model\s*[:=]\s*['"`]([^'"`]+)['"`]/);
    const detectedModel = modelMatch ? modelMatch[1] : "gpt-4o";

    // Extract string literals / template literals inside the call block
    const stringBlocks: string[] = [];
    const backtickMatches = rawCallBlock.matchAll(/`([\s\S]*?)`/g);
    for (const bm of backtickMatches) {
      if (bm[1].length > 15) stringBlocks.push(bm[1]);
    }
    const tripleQuoteMatches = rawCallBlock.matchAll(/(?:f?"""([\s\S]*?)"""|f?'''([\s\S]*?)''')/g);
    for (const tm of tripleQuoteMatches) {
      const content = tm[1] || tm[2];
      if (content && content.length > 15) stringBlocks.push(content);
    }
    const singleLineMatches = rawCallBlock.matchAll(/f?["']([^"'\n]{25,})["']/g);
    for (const sm of singleLineMatches) {
      stringBlocks.push(sm[1]);
    }

    const combinedPromptText =
      stringBlocks.length > 0 ? stringBlocks.join("\n\n") : rawCallBlock;

    // Extract system vs user prompt if distinguishable
    const systemMatch = rawCallBlock.match(
      /role\s*[:=]\s*['"]system['"][\s\S]*?content\s*[:=]\s*(`[\s\S]*?`|f?"""[\s\S]*?"""|['"][^'"]+['"])/
    );
    const systemPrompt = systemMatch
      ? systemMatch[1].replace(/^(`|f?"""|['"])|(`|"""|['"])$/g, "")
      : undefined;

    const variables = extractVariables(combinedPromptText);
    const hasUnsanitizedInterpolation =
      variables.length > 0 && !checkHasDelimitersAroundVars(combinedPromptText, variables);
    const dynamicPrefixBeforeStatic = checkDynamicPrefixBeforeStatic(combinedPromptText);
    const hasMaxTokens = /max_tokens|max_completion_tokens/i.test(rawCallBlock);
    const hasCacheControl = fileHasCacheControl || /cache_control/i.test(rawCallBlock);
    const hasIdempotencyKey = fileHasIdempotency || /Idempotency-Key/i.test(rawCallBlock);

    const tempMatch = rawCallBlock.match(/temperature\s*[:=]\s*([0-9.]+)/);
    const temperature = tempMatch ? parseFloat(tempMatch[1]) : undefined;

    const estimatedInputTokens = Math.max(45, estimateTokens(combinedPromptText));
    const maxTokensMatch = rawCallBlock.match(
      /(?:max_tokens|max_completion_tokens)\s*[:=]\s*(\d+)/
    );
    const estimatedOutputTokens = maxTokensMatch ? parseInt(maxTokensMatch[1], 10) : 350;

    const provider = fileUsesOtari
      ? "otari"
      : /messages\.create|claude/i.test(rawCallBlock)
      ? "anthropic"
      : "openai";

    prompts.push({
      id: `${filePath}#L${startLine}-${callIndex}`,
      filePath,
      language,
      line: startLine,
      endLine,
      provider,
      detectedModel,
      recommendedModel: recommendOptimalModel(detectedModel, combinedPromptText),
      rawCode: rawCallBlock,
      systemPrompt,
      userPromptTemplate: combinedPromptText,
      interpolatedVariables: variables,
      hasUnsanitizedInterpolation,
      dynamicPrefixBeforeStatic,
      usesOtariGateway: fileUsesOtari,
      hasIdempotencyKey,
      hasCacheControl,
      hasMaxTokens,
      temperature,
      estimatedInputTokens,
      estimatedOutputTokens
    });
  }

  // Fallback: if no SDK call was matched, treat the input as a raw prompt or standalone prompt variable
  if (prompts.length === 0 && code.trim().length > 0) {
    const variables = extractVariables(code);
    const hasUnsanitizedInterpolation =
      variables.length > 0 && !checkHasDelimitersAroundVars(code, variables);
    const dynamicPrefixBeforeStatic = checkDynamicPrefixBeforeStatic(code);
    const detectedModel = "gpt-4o";

    prompts.push({
      id: `${filePath}#L1-1`,
      filePath,
      language: language === "raw-prompt" ? "raw-prompt" : language,
      line: 1,
      endLine: lines.length,
      provider: fileUsesOtari ? "otari" : "generic",
      detectedModel,
      recommendedModel: recommendOptimalModel(detectedModel, code),
      rawCode: code,
      userPromptTemplate: code,
      interpolatedVariables: variables,
      hasUnsanitizedInterpolation,
      dynamicPrefixBeforeStatic,
      usesOtariGateway: fileUsesOtari,
      hasIdempotencyKey: fileHasIdempotency,
      hasCacheControl: fileHasCacheControl,
      hasMaxTokens: /max_tokens|max_completion_tokens/i.test(code),
      estimatedInputTokens: Math.max(30, estimateTokens(code)),
      estimatedOutputTokens: 300
    });
  }

  return prompts;
}
