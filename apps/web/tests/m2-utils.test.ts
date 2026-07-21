import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJudgeVerdict } from '../app/arena-utils.ts';
import { buildCsvReport, buildHtmlReport, createRubricSnapshot, parseDataset, selectReviewCaseIds, shouldSampleForReview, standardSeasonCases } from '../app/m2-utils.ts';

test('parseDataset reads quoted CSV and preserves commas', () => {
  const rows = parseDataset('id,category,prompt,tags\ncase-1,文案,"写标题,不要夸张",copy|safe', 'cases.csv');
  assert.equal(rows[0].prompt, '写标题,不要夸张');
  assert.deepEqual(rows[0].tags, ['copy', 'safe']);
});

test('parseDataset rejects duplicate ids and invalid JSONL lines', () => {
  assert.throws(() => parseDataset('{"id":"a","prompt":"x"}\n{"id":"a","prompt":"y"}', 'cases.jsonl'), /重复 id/);
  assert.throws(() => parseDataset('{bad json}', 'cases.jsonl'), /第 1 行/);
});

test('standard season contains four categories and unique ids', () => {
  assert.equal(standardSeasonCases.length, 8);
  assert.equal(new Set(standardSeasonCases.map((item) => item.id)).size, 8);
  assert.deepEqual([...new Set(standardSeasonCases.map((item) => item.category))].sort(), ['代码生成', '内容总结', '数据分析', '文案生成'].sort());
});

test('createRubricSnapshot validates weight and creates stable fingerprint', () => {
  const dimensions = [{ name: '正确性', weight: 100, description: '是否正确' }];
  const first = createRubricSnapshot('通用', '1.0', dimensions, '2026-01-01T00:00:00.000Z');
  const second = createRubricSnapshot('通用', '1.0', dimensions, '2026-02-01T00:00:00.000Z');
  assert.equal(first.fingerprint, second.fingerprint);
  assert.throws(() => createRubricSnapshot('通用', '1.0', [{ ...dimensions[0], weight: 90 }]), /合计必须为 100/);
});

test('judge verdict must cover every successful alias and select an allowed winner', () => {
  const valid = '{"winner":"A","confidence":0.8,"summary":"ok","scores":[{"alias":"A","total":90},{"alias":"B","total":80}]}';
  assert.equal(parseJudgeVerdict(valid, ['A', 'B'])?.winner, 'A');
  assert.equal(parseJudgeVerdict(valid, ['A', 'B', 'C']), null);
  assert.equal(parseJudgeVerdict(valid.replace('"winner":"A"', '"winner":"C"'), ['A', 'B']), null);
});

test('review sampling always includes low confidence, failures and invalid judge', () => {
  assert.equal(shouldSampleForReview('a', 0.55, false, true), true);
  assert.equal(shouldSampleForReview('b', 0.9, true, true), true);
  assert.equal(shouldSampleForReview('c', 0.9, false, false), true);
  assert.equal(shouldSampleForReview('stable', 0.9, false, true, 0), false);
});

test('batch review selection targets 20 percent while preserving forced cases', () => {
  const stable = Array.from({ length: 8 }, (_, index) => ({ id: `case-${index}`, confidence: 0.9, hasFailure: false, judgeValid: true }));
  assert.equal(selectReviewCaseIds(stable, 0.2).length, 2);
  const forced = stable.map((item, index) => index < 3 ? { ...item, hasFailure: true } : item);
  assert.equal(selectReviewCaseIds(forced, 0.2).length, 3);
});

test('CSV and HTML reports escape user-controlled values', () => {
  const rows = [{ id: 'a', prompt: 'x,"y"', html: '<script>alert(1)</script>' }];
  assert.match(buildCsvReport(rows), /"x,""y"""/);
  const html = buildHtmlReport('报告', '摘要', rows);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('CSV reports neutralize spreadsheet formula prefixes', () => {
  const prefixes = ['=', '+', '-', '@', '\t', '\r', '\n'];
  const report = buildCsvReport(prefixes.map((prefix) => ({ value: `${prefix}2+2` })));
  const cells = parseDataset(`prompt\n${report.split('\n').slice(1).join('\n')}`, 'cases.csv');
  assert.deepEqual(cells.map((item) => item.prompt), prefixes.map((prefix) => `'${prefix}2+2`));
});
