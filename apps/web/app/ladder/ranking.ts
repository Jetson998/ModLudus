export type RankingModel = {
  id: string;
  quality?: number | null;
  combined_price_per_million?: number | null;
  speed_tokens_per_second?: number | null;
  latency_first_chunk_seconds?: number | null;
};

export type QualityMode = 'intelligence' | 'quality-speed' | 'quality-latency';
export type RankingView = 'quality' | 'cost' | 'value' | 'speed' | 'latest';

const positive = (value?: number | null) => Number.isFinite(value) && Number(value) > 0;

function range(values: number[]) {
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function normalize(value: number, minimum: number, maximum: number) {
  return maximum === minimum ? 1 : (value - minimum) / (maximum - minimum);
}

export function eligibleForView(model: RankingModel, view: RankingView, qualityMode: QualityMode) {
  if (view === 'cost') return positive(model.combined_price_per_million);
  if (view === 'value') return positive(model.quality) && positive(model.combined_price_per_million);
  if (view === 'speed') return positive(model.speed_tokens_per_second);
  if (view !== 'quality') return true;
  if (!positive(model.quality)) return false;
  if (qualityMode === 'quality-speed') return positive(model.speed_tokens_per_second);
  if (qualityMode === 'quality-latency') return positive(model.latency_first_chunk_seconds);
  return true;
}

export function buildRankingScores(models: RankingModel[]) {
  const qualityModels = models.filter((item) => positive(item.quality));
  const qualityRange = range(qualityModels.map((item) => Number(item.quality)));
  const qualityScore = (item: RankingModel) => normalize(Number(item.quality), qualityRange.minimum, qualityRange.maximum);

  const valueModels = qualityModels.filter((item) => positive(item.combined_price_per_million));
  const loggedPrices = valueModels.map((item) => Math.log1p(Number(item.combined_price_per_million)));
  const priceRange = range(loggedPrices);
  const value = new Map(valueModels.map((item) => {
    const affordability = 1 - normalize(Math.log1p(Number(item.combined_price_per_million)), priceRange.minimum, priceRange.maximum);
    return [item.id, qualityScore(item) * 0.85 + affordability * 0.15];
  }));

  const speedModels = qualityModels.filter((item) => positive(item.speed_tokens_per_second));
  const speedRange = range(speedModels.map((item) => Number(item.speed_tokens_per_second)));
  const qualitySpeed = new Map(speedModels.map((item) => [
    item.id,
    qualityScore(item) * 0.8 + normalize(Number(item.speed_tokens_per_second), speedRange.minimum, speedRange.maximum) * 0.2,
  ]));

  const latencyModels = qualityModels.filter((item) => positive(item.latency_first_chunk_seconds));
  const latencyRange = range(latencyModels.map((item) => Number(item.latency_first_chunk_seconds)));
  const qualityLatency = new Map(latencyModels.map((item) => [
    item.id,
    qualityScore(item) * 0.8 + (1 - normalize(Number(item.latency_first_chunk_seconds), latencyRange.minimum, latencyRange.maximum)) * 0.2,
  ]));

  return { value, qualitySpeed, qualityLatency };
}
