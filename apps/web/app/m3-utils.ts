import type { StructuredJudgeVerdict } from './arena-utils';
import type { RubricSnapshot } from './m2-utils';

export const batchCheckpointKey = 'modludus:m3.1:batch-checkpoint';

export type PersistedBatchAttempt = {
  alias: string;
  model: string;
  latencyMs: number;
  failed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export type PersistedJudgeVerdict = {
  winner: string;
  confidence: number;
  scores: Array<Omit<StructuredJudgeVerdict['scores'][number], 'severeIssues'>>;
};

export type PersistedBatchResult = {
  caseFingerprint: string;
  attempts: PersistedBatchAttempt[];
  judge: PersistedJudgeVerdict | null;
  reviewRequired: boolean;
  reviewed: boolean;
};

export type BatchCheckpoint = {
  schemaVersion: 'm3.1';
  datasetFingerprint: string;
  totalCases: number;
  rubric: RubricSnapshot;
  configurationSalt: string;
  configurationFingerprint: string;
  concurrency: number;
  status: 'running' | 'cancelled' | 'completed';
  results: PersistedBatchResult[];
  savedAt: string;
};

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createConfigurationSalt() {
  const values = new Uint32Array(4);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
}

export function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.searchParams.sort();
  return url.toString();
}

export function connectionModelIdentity(connectionId: number, model: string, baseUrl: string, salt: string) {
  const endpointHash = fingerprint(JSON.stringify([salt, 'modludus:m3.1:endpoint', normalizeBaseUrl(baseUrl)]));
  return `${connectionId}:${model.trim()}:${endpointHash}`;
}

export function caseFingerprint(testCase: { id: string; category: string; prompt: string; expected?: string; tags: string[] }) {
  return fingerprint(JSON.stringify([testCase.id, testCase.category, testCase.prompt, testCase.expected ?? '', testCase.tags]));
}

export function datasetFingerprint(testCases: Array<{ id: string; category: string; prompt: string; expected?: string; tags: string[] }>) {
  return fingerprint(JSON.stringify(testCases.map(caseFingerprint)));
}

export function configurationFingerprint(candidateIdentities: string[], judgeIdentity: string, rubricFingerprint: string) {
  return fingerprint(JSON.stringify({ candidates: [...candidateIdentities].sort(), judge: judgeIdentity, rubric: rubricFingerprint }));
}

export function storeBatchCheckpoint(storage: Pick<Storage, 'setItem'>, checkpoint: BatchCheckpoint) {
  try {
    storage.setItem(batchCheckpointKey, JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

export function clampConcurrency(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, Math.floor(value)));
}

export function sanitizeJudgeVerdict(verdict: StructuredJudgeVerdict | null): PersistedJudgeVerdict | null {
  if (!verdict) return null;
  return {
    winner: verdict.winner,
    confidence: verdict.confidence,
    scores: verdict.scores.map(({ severeIssues: _severeIssues, ...score }) => score),
  };
}

export function restoreJudgeVerdict(verdict: PersistedJudgeVerdict | null): StructuredJudgeVerdict | null {
  if (!verdict) return null;
  return {
    ...verdict,
    summary: '已恢复脱敏裁判结论',
    scores: verdict.scores.map((score) => ({ ...score, severeIssues: [] })),
  };
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  onResult: (result: R, index: number) => void | Promise<void>,
  signal: AbortSignal,
) {
  const completed: Array<{ index: number; result: R }> = [];
  let cursor = 0;
  async function runner() {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        const result = await worker(items[index], index, signal);
        if (signal.aborted) return;
        completed.push({ index, result });
        await onResult(result, index);
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(clampConcurrency(concurrency), items.length) }, runner));
  return completed.sort((a, b) => a.index - b.index).map((item) => item.result);
}

export function parseBatchCheckpoint(value: string | null): BatchCheckpoint | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BatchCheckpoint>;
    if (parsed.schemaVersion !== 'm3.1' || typeof parsed.datasetFingerprint !== 'string' || typeof parsed.configurationSalt !== 'string' || !parsed.configurationSalt || typeof parsed.configurationFingerprint !== 'string' || !Array.isArray(parsed.results) || !parsed.rubric) return null;
    return parsed as BatchCheckpoint;
  } catch {
    return null;
  }
}
