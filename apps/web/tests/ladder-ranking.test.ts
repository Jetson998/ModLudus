import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRankingScores, eligibleForView } from '../app/ladder/ranking.ts';

const models = [
  { id: 'sol', quality: 59, combined_price_per_million: 35, speed_tokens_per_second: 63, latency_first_chunk_seconds: 140.72 },
  { id: 'fable', quality: 60, combined_price_per_million: 60, speed_tokens_per_second: 72, latency_first_chunk_seconds: 125.42 },
  { id: 'cheap', quality: 42, combined_price_per_million: 1.3, speed_tokens_per_second: 100, latency_first_chunk_seconds: 2 },
  { id: 'zero', quality: 50, combined_price_per_million: 0, speed_tokens_per_second: 80, latency_first_chunk_seconds: 1 },
];

test('cost and value views reject zero or missing prices', () => {
  assert.equal(eligibleForView(models[3], 'cost', 'intelligence'), false);
  assert.equal(eligibleForView(models[3], 'value', 'intelligence'), false);
  assert.equal(eligibleForView(models[0], 'cost', 'intelligence'), true);
});

test('quality-led value score does not let the cheapest model win automatically', () => {
  const scores = buildRankingScores(models);
  assert.ok(Number(scores.value.get('sol')) > Number(scores.value.get('cheap')));
  assert.equal(scores.value.has('zero'), false);
});

test('quality submodes require their measured secondary metric', () => {
  const incomplete = { id: 'incomplete', quality: 55, combined_price_per_million: 5 };
  assert.equal(eligibleForView(incomplete, 'quality', 'intelligence'), true);
  assert.equal(eligibleForView(incomplete, 'quality', 'quality-speed'), false);
  assert.equal(eligibleForView(incomplete, 'quality', 'quality-latency'), false);
});

test('speed view requires a measured positive output speed', () => {
  assert.equal(eligibleForView(models[0], 'speed', 'intelligence'), true);
  assert.equal(eligibleForView({ id: 'missing-speed', quality: 50 }, 'speed', 'intelligence'), false);
  assert.equal(eligibleForView({ id: 'zero-speed', speed_tokens_per_second: 0 }, 'speed', 'intelligence'), false);
});
