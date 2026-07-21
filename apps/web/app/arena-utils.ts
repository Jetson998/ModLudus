export type CandidateIdentity = {
  connectionId: number;
  model: string;
};

export type JudgeScore = {
  alias: string;
  total: number;
  instruction: number;
  correctness: number;
  completeness: number;
  expression: number;
  actionability: number;
  severeIssues: string[];
};

export type StructuredJudgeVerdict = {
  winner: string;
  confidence: number;
  summary: string;
  scores: JudgeScore[];
};

export type SelectionCandidate = {
  alias: string;
  model: string;
  quality?: number;
  costUsd?: number;
  latencyMs: number;
};

export function uniqueModels(value: string) {
  return [...new Set(value.split(',').map((model) => model.trim()).filter(Boolean))];
}

export function dedupeCandidates<T extends CandidateIdentity>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.connectionId}\u0000${item.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function fisherYatesShuffle<T>(items: T[], random = Math.random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function clampScore(value: unknown, maximum = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(0, parsed));
}

export function parseJudgeVerdict(content: string): StructuredJudgeVerdict | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    if (!parsed || !Array.isArray(parsed.scores) || !parsed.winner) return null;
    const scores = parsed.scores.map((item: Record<string, unknown>) => ({
      alias: String(item.alias ?? ''),
      total: clampScore(item.total),
      instruction: clampScore(item.instruction),
      correctness: clampScore(item.correctness),
      completeness: clampScore(item.completeness),
      expression: clampScore(item.expression),
      actionability: clampScore(item.actionability),
      severeIssues: Array.isArray(item.severeIssues) ? item.severeIssues.map(String) : [],
    })).filter((item: JudgeScore) => item.alias);
    if (!scores.length) return null;
    return {
      winner: String(parsed.winner),
      confidence: clampScore(parsed.confidence, 1),
      summary: String(parsed.summary ?? ''),
      scores,
    };
  } catch {
    return null;
  }
}

export function estimateCostUsd(inputTokens: number | undefined, outputTokens: number | undefined, inputUsdPerToken: number, outputUsdPerToken: number) {
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return inputTokens * inputUsdPerToken + outputTokens * outputUsdPerToken;
}

export function paretoAliases(items: SelectionCandidate[]) {
  const useQuality = items.every((item) => item.quality !== undefined);
  const useCost = items.every((item) => item.costUsd !== undefined);
  return items.filter((candidate) => !items.some((other) => {
    if (other.alias === candidate.alias) return false;
    const qualityBetter = !useQuality || (other.quality as number) >= (candidate.quality as number);
    const costBetter = !useCost || (other.costUsd as number) <= (candidate.costUsd as number);
    const speedBetter = other.latencyMs <= candidate.latencyMs;
    const strictlyBetter = (useQuality && (other.quality as number) > (candidate.quality as number))
      || (useCost && (other.costUsd as number) < (candidate.costUsd as number))
      || other.latencyMs < candidate.latencyMs;
    return qualityBetter && costBetter && speedBetter && strictlyBetter;
  })).map((item) => item.alias);
}

export function selectionRecommendations(items: SelectionCandidate[]) {
  const withQuality = items.filter((item) => item.quality !== undefined).sort((a, b) => (b.quality as number) - (a.quality as number));
  const withCost = items.filter((item) => item.costUsd !== undefined).sort((a, b) => (a.costUsd as number) - (b.costUsd as number));
  const bySpeed = [...items].sort((a, b) => a.latencyMs - b.latencyMs);
  return {
    quality: withQuality[0],
    cost: withCost[0],
    speed: bySpeed[0],
    pareto: paretoAliases(items),
  };
}
