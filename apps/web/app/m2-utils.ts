export type BatchTestCase = {
  id: string;
  category: string;
  prompt: string;
  expected?: string;
  tags: string[];
};

export type RubricDimension = {
  name: string;
  weight: number;
  description: string;
};

export type RubricSnapshot = {
  name: string;
  version: string;
  dimensions: RubricDimension[];
  capturedAt: string;
  fingerprint: string;
};

export const standardSeasonCases: BatchTestCase[] = [
  { id: 'copy-01', category: '文案生成', prompt: '为一款强调隐私的多模型竞技平台写 3 个小红书标题和 120 字正文，不得使用绝对化宣传。', tags: ['season-2026.1', 'copy'] },
  { id: 'copy-02', category: '文案生成', prompt: '为独立开发者设计一封 180 字以内的产品内测邀请邮件，包含价值、适合人群和明确行动按钮文案。', tags: ['season-2026.1', 'copy'] },
  { id: 'code-01', category: '代码生成', prompt: '用原生 JavaScript 实现一个 debounce(fn, wait) 函数，支持保留 this、参数和 cancel 方法，并给出最小测试示例。', tags: ['season-2026.1', 'code'] },
  { id: 'code-02', category: '代码生成', prompt: '编写一条 PostgreSQL 查询：统计最近 30 天每天成功订单数、GMV 和客单价；表 orders(id, paid_at, amount, status)。解释空值处理。', tags: ['season-2026.1', 'code'] },
  { id: 'summary-01', category: '内容总结', prompt: '将以下通知压缩为 5 条群众办事要点：8 月 1 日至 9 月 30 日，本市居民购买一级能效家电可补贴实付 15%，累计不超过 3000 元，购买后 7 日内提交身份证明、发票、序列号和旧机回收凭证，额度用完即止。', tags: ['season-2026.1', 'summary'] },
  { id: 'summary-02', category: '内容总结', prompt: '把以下会议结论整理成“决定、负责人、截止时间、风险”：9 月发布内测；产品负责报名页，周五完成；研发负责网关兼容，下周三完成；主要风险是 CORS 和价格数据缺失。', tags: ['season-2026.1', 'summary'] },
  { id: 'analysis-01', category: '数据分析', prompt: '模型 A：成功率 99%、延迟 3 秒、成本 0.08 元、质量 92；模型 B：97%、1 秒、0.02 元、质量 84。分别给出质量、成本、速度优先选择，并说明不能只看平均分的原因。', tags: ['season-2026.1', 'analysis'] },
  { id: 'analysis-02', category: '数据分析', prompt: '某功能上线前后转化率从 8.0% 升至 8.6%，样本分别为 1000 和 1100。说明还需要哪些统计检验和业务信息，避免直接宣称功能有效。', tags: ['season-2026.1', 'analysis'] },
];

function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function normalizeCase(item: Record<string, unknown>, index: number): BatchTestCase {
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : String(item.tags ?? '').split(/[|,]/).map((tag) => tag.trim()).filter(Boolean);
  return {
    id: String(item.id ?? `case-${String(index + 1).padStart(3, '0')}`).trim(),
    category: String(item.category ?? item.scenario ?? '未分类').trim(),
    prompt: String(item.prompt ?? item.input ?? '').trim(),
    expected: item.expected ? String(item.expected) : undefined,
    tags,
  };
}

export function parseDataset(content: string, filename = 'dataset.jsonl') {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('测试集为空。');
  let items: BatchTestCase[];
  if (filename.toLowerCase().endsWith('.csv')) {
    const rows = parseCsvRows(trimmed);
    const headers = rows.shift()?.map((header) => header.trim()) ?? [];
    if (!headers.includes('prompt') && !headers.includes('input')) throw new Error('CSV 必须包含 prompt 或 input 列。');
    items = rows.map((row, index) => normalizeCase(Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])), index));
  } else {
    items = trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return normalizeCase(JSON.parse(line), index);
      } catch {
        throw new Error(`JSONL 第 ${index + 1} 行不是有效 JSON。`);
      }
    });
  }
  return validateDataset(items);
}

export function validateDataset(items: BatchTestCase[]) {
  if (!items.length) throw new Error('测试集至少需要 1 道题。');
  if (items.length > 50) throw new Error('浏览器批量模式单次最多 50 道题。');
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (!item.id) throw new Error(`第 ${index + 1} 道题缺少 id。`);
    if (ids.has(item.id)) throw new Error(`测试集存在重复 id：${item.id}`);
    if (!item.prompt) throw new Error(`题目 ${item.id} 缺少 prompt。`);
    ids.add(item.id);
  });
  return items;
}

export function stableFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createRubricSnapshot(name: string, version: string, dimensions: RubricDimension[], capturedAt = new Date().toISOString()): RubricSnapshot {
  if (!name.trim() || !version.trim()) throw new Error('Rubric 名称和版本不能为空。');
  if (!dimensions.length) throw new Error('Rubric 至少需要一个评分维度。');
  const totalWeight = dimensions.reduce((total, item) => total + item.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.001) throw new Error(`Rubric 权重合计必须为 100，当前为 ${totalWeight}。`);
  const normalized = dimensions.map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim() }));
  return { name: name.trim(), version: version.trim(), dimensions: normalized, capturedAt, fingerprint: stableFingerprint(JSON.stringify({ name: name.trim(), version: version.trim(), dimensions: normalized })) };
}

export function shouldSampleForReview(caseId: string, confidence: number | undefined, hasFailure: boolean, judgeValid: boolean, sampleRate = 0.2) {
  if (hasFailure || !judgeValid || confidence === undefined || confidence < 0.7) return true;
  const bucket = Number.parseInt(stableFingerprint(caseId).slice(0, 6), 16) / 0xffffff;
  return bucket < sampleRate;
}

export function selectReviewCaseIds(items: Array<{ id: string; confidence?: number; hasFailure: boolean; judgeValid: boolean }>, sampleRate = 0.2) {
  const selected = new Set(items.filter((item) => item.hasFailure || !item.judgeValid || item.confidence === undefined || item.confidence < 0.7).map((item) => item.id));
  const target = Math.max(selected.size, Math.ceil(items.length * sampleRate));
  const eligible = items.filter((item) => !selected.has(item.id)).sort((a, b) => stableFingerprint(a.id).localeCompare(stableFingerprint(b.id)));
  for (const item of eligible) {
    if (selected.size >= target) break;
    selected.add(item.id);
  }
  return [...selected];
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return /[",\t\n\r]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

export function buildCsvReport(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.map(escapeCsv).join(','), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))].join('\n');
}

export function buildHtmlReport(title: string, summary: string, rows: Array<Record<string, unknown>>) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px system-ui;margin:40px;color:#17231f}table{border-collapse:collapse;width:100%}th,td{border:1px solid #dce4df;padding:8px;text-align:left;vertical-align:top}th{background:#f3f6f2}h1{color:#174d3d}</style><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
}
