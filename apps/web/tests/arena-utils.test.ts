import assert from 'node:assert/strict';
import test from 'node:test';
import { dedupeCandidates, estimateCostUsd, fisherYatesShuffle, parseJudgeVerdict, paretoAliases, uniqueModels } from '../app/arena-utils.ts';

test('uniqueModels trims and removes repeated model ids', () => {
  assert.deepEqual(uniqueModels('same-model, same-model, other '), ['same-model', 'other']);
});

test('dedupeCandidates uses gateway plus model identity', () => {
  const values = dedupeCandidates([
    { connectionId: 1, model: 'same-model', marker: 'first' },
    { connectionId: 1, model: 'same-model', marker: 'duplicate' },
    { connectionId: 2, model: 'same-model', marker: 'other-gateway' },
  ]);
  assert.deepEqual(values.map((item) => item.marker), ['first', 'other-gateway']);
});

test('fisherYatesShuffle does not mutate input and supports deterministic verification', () => {
  const source = ['A', 'B', 'C', 'D'];
  const randomValues = [0.1, 0.7, 0.4];
  const shuffled = fisherYatesShuffle(source, () => randomValues.shift() ?? 0);
  assert.deepEqual(source, ['A', 'B', 'C', 'D']);
  assert.deepEqual(shuffled, ['B', 'D', 'C', 'A']);
});

test('parseJudgeVerdict extracts JSON and clamps unsafe scores', () => {
  const report = parseJudgeVerdict('```json\n{"winner":"B","confidence":1.4,"summary":"ok","scores":[{"alias":"A","total":88,"instruction":90,"correctness":87,"completeness":86,"expression":89,"actionability":88,"severeIssues":[]},{"alias":"B","total":105,"instruction":99,"correctness":98,"completeness":97,"expression":96,"actionability":95,"severeIssues":["事实错误"]}]}\n```');
  assert.equal(report?.winner, 'B');
  assert.equal(report?.confidence, 1);
  assert.equal(report?.scores[1].total, 100);
});

test('estimateCostUsd uses frozen per-token prices', () => {
  assert.equal(estimateCostUsd(1000, 200, 0.000001, 0.000002), 0.0014);
  assert.equal(estimateCostUsd(undefined, 200, 0.000001, 0.000002), undefined);
});

test('paretoAliases removes a candidate dominated on quality, cost and speed', () => {
  assert.deepEqual(paretoAliases([
    { alias: 'A', model: 'a', quality: 90, costUsd: 0.01, latencyMs: 1000 },
    { alias: 'B', model: 'b', quality: 80, costUsd: 0.02, latencyMs: 1200 },
    { alias: 'C', model: 'c', quality: 95, costUsd: 0.03, latencyMs: 800 },
  ]), ['A', 'C']);
});
