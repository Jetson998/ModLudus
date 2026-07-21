import assert from 'node:assert/strict';
import test from 'node:test';
import { batchCheckpointKey, caseFingerprint, clampConcurrency, configurationFingerprint, connectionModelIdentity, datasetFingerprint, normalizeBaseUrl, parseBatchCheckpoint, restoreJudgeVerdict, runWithConcurrency, sanitizeJudgeVerdict, storeBatchCheckpoint } from '../app/m3-utils.ts';

const cases = [
  { id: 'a', category: '文案', prompt: '写标题', tags: ['copy'] },
  { id: 'b', category: '代码', prompt: '写函数', expected: '需要测试', tags: ['code'] },
];

test('dataset fingerprints are stable and change with task content', () => {
  assert.equal(datasetFingerprint(cases), datasetFingerprint(cases.map((item) => ({ ...item }))));
  assert.notEqual(datasetFingerprint(cases), datasetFingerprint([{ ...cases[0], prompt: '改变了' }, cases[1]]));
  assert.notEqual(caseFingerprint(cases[0]), caseFingerprint(cases[1]));
});

test('configuration fingerprint ignores candidate order but includes judge and rubric', () => {
  const first = configurationFingerprint(['1:model-a', '2:model-b'], '3:judge', 'rubric-a');
  assert.equal(first, configurationFingerprint(['2:model-b', '1:model-a'], '3:judge', 'rubric-a'));
  assert.notEqual(first, configurationFingerprint(['2:model-b', '1:model-a'], '3:other-judge', 'rubric-a'));
});

test('configuration fingerprint detects a Base URL change without storing the raw URL', () => {
  const salt = 'test-session-salt';
  const firstIdentity = connectionModelIdentity(1, 'same-model', 'HTTPS://API.EXAMPLE.COM:443/v1/', salt);
  const normalizedIdentity = connectionModelIdentity(1, 'same-model', 'https://api.example.com/v1', salt);
  const changedIdentity = connectionModelIdentity(1, 'same-model', 'https://other.example.com/v1', salt);
  assert.equal(normalizeBaseUrl('HTTPS://API.EXAMPLE.COM:443/v1/'), 'https://api.example.com/v1');
  assert.equal(firstIdentity, normalizedIdentity);
  assert.notEqual(firstIdentity, changedIdentity);
  assert.ok(!firstIdentity.includes('api.example.com'));
  assert.notEqual(configurationFingerprint([firstIdentity], firstIdentity, 'rubric'), configurationFingerprint([changedIdentity], changedIdentity, 'rubric'));
});

test('concurrency is clamped to the supported 1-4 range', () => {
  assert.equal(clampConcurrency(-1), 1);
  assert.equal(clampConcurrency(3.9), 3);
  assert.equal(clampConcurrency(20), 4);
});

test('runWithConcurrency respects the limit and stops scheduling after cancellation', async () => {
  const controller = new AbortController();
  let active = 0;
  let maximumActive = 0;
  const completed: number[] = [];
  await runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item;
  }, (item) => {
    completed.push(item);
    if (completed.length === 2) controller.abort();
  }, controller.signal);
  assert.equal(maximumActive, 2);
  assert.equal(completed.length, 2);
});

test('checkpoint parser rejects invalid versions and keeps sanitized payloads', () => {
  assert.equal(parseBatchCheckpoint(null), null);
  assert.equal(parseBatchCheckpoint('{"schemaVersion":"m2"}'), null);
  const checkpoint = {
    schemaVersion: 'm3.1' as const,
    datasetFingerprint: 'dataset',
    totalCases: 1,
    rubric: { name: '通用', version: '1', dimensions: [], capturedAt: '2026-01-01', fingerprint: 'rubric' },
    configurationSalt: 'session-salt',
    configurationFingerprint: 'config',
    concurrency: 2,
    status: 'cancelled' as const,
    results: [{ caseFingerprint: 'case', attempts: [{ alias: 'A', model: 'model-a', latencyMs: 10 }], judge: null, reviewRequired: true, reviewed: false }],
    savedAt: '2026-01-01',
  };
  const serialized = JSON.stringify(checkpoint);
  assert.equal(parseBatchCheckpoint(serialized)?.status, 'cancelled');
  assert.ok(!/apiKey|endpoint|prompt|expected|content|judgeRaw/.test(serialized));
  assert.match(batchCheckpointKey, /m3\.1/);
});

test('checkpoint storage reports write failures instead of claiming recovery succeeded', () => {
  const checkpoint = {
    schemaVersion: 'm3.1' as const,
    datasetFingerprint: 'dataset',
    totalCases: 0,
    rubric: { name: '通用', version: '1', dimensions: [], capturedAt: '2026-01-01', fingerprint: 'rubric' },
    configurationSalt: 'session-salt',
    configurationFingerprint: 'config',
    concurrency: 1,
    status: 'cancelled' as const,
    results: [],
    savedAt: '2026-01-01',
  };
  assert.equal(storeBatchCheckpoint({ setItem() { throw new Error('quota exceeded'); } }, checkpoint), false);
  let stored = '';
  assert.equal(storeBatchCheckpoint({ setItem(_key, value) { stored = value; } }, checkpoint), true);
  assert.equal(parseBatchCheckpoint(stored)?.configurationSalt, 'session-salt');
});

test('checkpoint judge data removes free text and severe issue excerpts', () => {
  const sanitized = sanitizeJudgeVerdict({ winner: 'A', confidence: 0.8, summary: '可能包含题目原文', scores: [{ alias: 'A', total: 90, severeIssues: ['引用了用户内容'] }] });
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes('可能包含题目原文'));
  assert.ok(!serialized.includes('引用了用户内容'));
  assert.equal(restoreJudgeVerdict(sanitized)?.summary, '已恢复脱敏裁判结论');
});
