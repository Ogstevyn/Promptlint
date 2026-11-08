import {
  CostBreakdown,
  ExtractedPrompt,
  getModelPricing
} from "@promptlint/shared";
import { detectVerboseFiller } from "./tokenizer";

export function calculatePromptCostBreakdown(
  prompt: ExtractedPrompt,
  monthlyCallVolume = 100_000
): CostBreakdown {
  const currentPricing = getModelPricing(prompt.detectedModel);
  const recommendedPricing = getModelPricing(prompt.recommendedModel);

  const currentInputTokens = Math.max(10, prompt.estimatedInputTokens);
  const outputTokens = Math.max(20, prompt.estimatedOutputTokens);

  const fillerAnalysis = detectVerboseFiller(
    `${prompt.systemPrompt || ""}\n${prompt.userPromptTemplate}`
  );
  const compressedTokens = Math.max(
    10,
    currentInputTokens - Math.max(fillerAnalysis.tokensSaved, Math.round(currentInputTokens * 0.15))
  );

  // 1. Current baseline cost (no Otari caching, current model, uncompressed prompt)
  const currentInputCostPerCall =
    (currentInputTokens / 1_000_000) * currentPricing.inputPerMillionUsd;
  const currentOutputCostPerCall =
    (outputTokens / 1_000_000) * currentPricing.outputPerMillionUsd;
  const currentCostPerCallUsd = currentInputCostPerCall + currentOutputCostPerCall;
  const currentMonthlyCostUsd = currentCostPerCallUsd * monthlyCallVolume;

  // 2. Step-by-step savings calculation
  // (a) Prompt compression savings on current model
  const afterCompressionInputCostPerCall =
    (compressedTokens / 1_000_000) * currentPricing.inputPerMillionUsd;
  const promptCompressionMonthlyUsd = Math.max(
    0,
    (currentInputCostPerCall - afterCompressionInputCostPerCall) * monthlyCallVolume
  );

  // (b) Smart model routing via Mozilla Otari (if model tier changed)
  const afterRoutingInputCostPerCall =
    (compressedTokens / 1_000_000) * recommendedPricing.inputPerMillionUsd;
  const afterRoutingOutputCostPerCall =
    (outputTokens / 1_000_000) * recommendedPricing.outputPerMillionUsd;
  const smartModelRoutingMonthlyUsd = Math.max(
    0,
    (afterCompressionInputCostPerCall +
      currentOutputCostPerCall -
      (afterRoutingInputCostPerCall + afterRoutingOutputCostPerCall)) *
      monthlyCallVolume
  );

  // (c) Prefix caching via Mozilla Otari (`cache_control: { type: "ephemeral" }`)
  // Assume 65% of compressed prompt is static system/few-shot prefix and hits cache 75% of the time
  const staticRatio = prompt.dynamicPrefixBeforeStatic || !prompt.hasCacheControl ? 0.65 : 0.25;
  const cacheHitRate = 0.75;
  const cachedPrefixTokens = compressedTokens * staticRatio * cacheHitRate;
  const uncachedTokens = compressedTokens - cachedPrefixTokens;
  const afterPrefixCacheInputCostPerCall =
    (uncachedTokens / 1_000_000) * recommendedPricing.inputPerMillionUsd +
    (cachedPrefixTokens / 1_000_000) * recommendedPricing.cachedInputPerMillionUsd;

  const otariPrefixCachingMonthlyUsd = Math.max(
    0,
    (afterRoutingInputCostPerCall - afterPrefixCacheInputCostPerCall) * monthlyCallVolume
  );

  // (d) Otari Idempotency-Key replay cache (`Otari-Idempotent-Replayed: true`)
  // Typical production retry / duplicate query rate is ~12%
  const idempotencyReplayRate = prompt.hasIdempotencyKey ? 0.02 : 0.12;
  const costBeforeIdempotencyPerCall =
    afterPrefixCacheInputCostPerCall + afterRoutingOutputCostPerCall;
  const optimizedCostPerCallUsd = costBeforeIdempotencyPerCall * (1 - idempotencyReplayRate);
  const otariIdempotencyReplayMonthlyUsd = Math.max(
    0,
    (costBeforeIdempotencyPerCall - optimizedCostPerCallUsd) * monthlyCallVolume
  );

  const optimizedMonthlyCostUsd = optimizedCostPerCallUsd * monthlyCallVolume;
  const monthlySavingsUsd = Math.max(0, currentMonthlyCostUsd - optimizedMonthlyCostUsd);
  const annualSavingsUsd = monthlySavingsUsd * 12;
  const savingsPercentage =
    currentMonthlyCostUsd > 0
      ? Math.min(99, Math.round((monthlySavingsUsd / currentMonthlyCostUsd) * 1000) / 10)
      : 0;

  return {
    monthlyCallVolume,
    currentModel: prompt.detectedModel,
    recommendedModel: prompt.recommendedModel,
    currentInputTokensPerCall: currentInputTokens,
    optimizedInputTokensPerCall: compressedTokens,
    estimatedOutputTokensPerCall: outputTokens,
    currentCostPerCallUsd: Number(currentCostPerCallUsd.toFixed(6)),
    optimizedCostPerCallUsd: Number(optimizedCostPerCallUsd.toFixed(6)),
    currentMonthlyCostUsd: Number(currentMonthlyCostUsd.toFixed(2)),
    optimizedMonthlyCostUsd: Number(optimizedMonthlyCostUsd.toFixed(2)),
    monthlySavingsUsd: Number(monthlySavingsUsd.toFixed(2)),
    annualSavingsUsd: Number(annualSavingsUsd.toFixed(2)),
    savingsPercentage,
    breakdownBySource: {
      promptCompressionUsd: Number(promptCompressionMonthlyUsd.toFixed(2)),
      otariPrefixCachingUsd: Number(otariPrefixCachingMonthlyUsd.toFixed(2)),
      otariIdempotencyReplayUsd: Number(otariIdempotencyReplayMonthlyUsd.toFixed(2)),
      smartModelRoutingUsd: Number(smartModelRoutingMonthlyUsd.toFixed(2))
    }
  };
}

export function aggregateCostBreakdowns(
  breakdowns: CostBreakdown[],
  monthlyCallVolume = 100_000
): CostBreakdown {
  if (breakdowns.length === 0) {
    return {
      monthlyCallVolume,
      currentModel: "gpt-4o",
      recommendedModel: "gpt-4o-mini",
      currentInputTokensPerCall: 0,
      optimizedInputTokensPerCall: 0,
      estimatedOutputTokensPerCall: 0,
      currentCostPerCallUsd: 0,
      optimizedCostPerCallUsd: 0,
      currentMonthlyCostUsd: 0,
      optimizedMonthlyCostUsd: 0,
      monthlySavingsUsd: 0,
      annualSavingsUsd: 0,
      savingsPercentage: 0,
      breakdownBySource: {
        promptCompressionUsd: 0,
        otariPrefixCachingUsd: 0,
        otariIdempotencyReplayUsd: 0,
        smartModelRoutingUsd: 0
      }
    };
  }

  const totalCurrentMonthly = breakdowns.reduce((sum, b) => sum + b.currentMonthlyCostUsd, 0);
  const totalOptimizedMonthly = breakdowns.reduce((sum, b) => sum + b.optimizedMonthlyCostUsd, 0);
  const totalSavingsMonthly = Math.max(0, totalCurrentMonthly - totalOptimizedMonthly);
  const savingsPct =
    totalCurrentMonthly > 0
      ? Math.round((totalSavingsMonthly / totalCurrentMonthly) * 1000) / 10
      : 0;

  return {
    monthlyCallVolume,
    currentModel: breakdowns[0].currentModel,
    recommendedModel: breakdowns[0].recommendedModel,
    currentInputTokensPerCall: breakdowns.reduce((s, b) => s + b.currentInputTokensPerCall, 0),
    optimizedInputTokensPerCall: breakdowns.reduce((s, b) => s + b.optimizedInputTokensPerCall, 0),
    estimatedOutputTokensPerCall: breakdowns.reduce((s, b) => s + b.estimatedOutputTokensPerCall, 0),
    currentCostPerCallUsd: Number(
      breakdowns.reduce((s, b) => s + b.currentCostPerCallUsd, 0).toFixed(6)
    ),
    optimizedCostPerCallUsd: Number(
      breakdowns.reduce((s, b) => s + b.optimizedCostPerCallUsd, 0).toFixed(6)
    ),
    currentMonthlyCostUsd: Number(totalCurrentMonthly.toFixed(2)),
    optimizedMonthlyCostUsd: Number(totalOptimizedMonthly.toFixed(2)),
    monthlySavingsUsd: Number(totalSavingsMonthly.toFixed(2)),
    annualSavingsUsd: Number((totalSavingsMonthly * 12).toFixed(2)),
    savingsPercentage: savingsPct,
    breakdownBySource: {
      promptCompressionUsd: Number(
        breakdowns.reduce((s, b) => s + b.breakdownBySource.promptCompressionUsd, 0).toFixed(2)
      ),
      otariPrefixCachingUsd: Number(
        breakdowns.reduce((s, b) => s + b.breakdownBySource.otariPrefixCachingUsd, 0).toFixed(2)
      ),
      otariIdempotencyReplayUsd: Number(
        breakdowns.reduce((s, b) => s + b.breakdownBySource.otariIdempotencyReplayUsd, 0).toFixed(2)
      ),
      smartModelRoutingUsd: Number(
        breakdowns.reduce((s, b) => s + b.breakdownBySource.smartModelRoutingUsd, 0).toFixed(2)
      )
    }
  };
}
