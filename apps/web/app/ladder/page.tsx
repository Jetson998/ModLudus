'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildRankingScores, eligibleForView } from './ranking';
import type { QualityMode } from './ranking';

type View = 'quality' | 'cost' | 'value' | 'latest';
type SourceName = 'openrouter' | 'artificial-analysis';

type SourceStatus = {
  source: SourceName;
  captured_at: string | null;
  retry_at: string | null;
  item_count: number;
  state: string;
  last_error: string | null;
  source_url?: string;
  license_status?: string;
};

type LadderModel = {
  id: string;
  model: string;
  provider: string;
  created: number;
  context_length?: number | null;
  combined_price_per_million?: number | null;
  quality?: number | null;
  quality_source?: 'artificial-analysis-snapshot' | 'openrouter-aa-benchmark' | null;
  aa_model?: string | null;
  aa_cost_per_task_usd?: number | null;
  speed_tokens_per_second?: number | null;
  latency_first_chunk_seconds?: number | null;
  total_response_seconds?: number | null;
  aa_context_window?: string | null;
  measured_samples: number;
  evidence_version: string;
};

type LadderPayload = {
  models: LadderModel[];
  community_evaluations: {
    baseline: number;
    completed_runs: number;
    display_total: number;
  };
  sources: Record<SourceName, SourceStatus>;
  generated_at: string;
};

type RefreshResult = {
  source: SourceName;
  refreshed: boolean;
  reason?: 'daily_limit' | 'refresh_in_progress' | 'upstream_failed' | 'refresh_superseded';
  retry_at?: string | null;
  item_count?: number;
};

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const PAGE_SIZE = 20;
const views: Array<[View, string]> = [['quality', '质量优先'], ['cost', '低成本'], ['value', '性价比'], ['latest', '新上架']];
const qualityModes: Array<[QualityMode, string]> = [['intelligence', '综合质量'], ['quality-speed', '质量＋速度'], ['quality-latency', '质量＋低延迟']];

function formatTime(value?: string | null) {
  if (!value) return '尚未更新';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function formatContext(model: LadderModel) {
  if (model.aa_context_window) return model.aa_context_window;
  const value = model.context_length;
  if (!value) return '未知上下文';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  return `${Math.round(value / 1000)}k`;
}

function valueOrDash(value?: number | null, digits = 0) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function compareNullable(a?: number | null, b?: number | null, direction: 'asc' | 'desc' = 'desc') {
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === 'asc' ? Number(a) - Number(b) : Number(b) - Number(a);
}

const providerLogos: Record<string, string> = {
  openai: 'openai.svg', anthropic: 'anthropic.svg', google: 'google-color.svg', xai: 'xai.svg', meta: 'meta-color.svg',
  qwen: 'qwen-color.svg', alibaba: 'alibaba-color.svg', deepseek: 'deepseek-color.svg', moonshotai: 'kimi-color.svg',
  moonshot: 'moonshot.svg', mistral: 'mistral-color.svg', mistralai: 'mistral-color.svg', microsoft: 'microsoft-color.svg',
  amazon: 'aws-color.svg', aws: 'aws-color.svg', nvidia: 'nvidia-color.svg', cohere: 'cohere-color.svg', minimax: 'minimax-color.svg',
  tencent: 'tencent-color.svg', xiaomi: 'xiaomimimo.svg', zai: 'zai.svg', arceeai: 'arcee-color.svg', inception: 'inception.svg',
  poolside: 'poolside-color.svg', openrouter: 'openrouter-color.svg',
};

function ProviderLogo({ provider }: { provider: string }) {
  const key = provider.toLowerCase().replace(/[^a-z0-9]/g, '');
  const filename = providerLogos[key];
  return <span className="provider-logo" aria-label={`${provider} logo`} title={provider}>
    {filename ? <img src={`/provider-logos/${filename}`} alt="" /> : <span>{provider.trim().slice(0, 2).toUpperCase() || '?'}</span>}
  </span>;
}

function SourceCard({ source, tone, title, meta, defaultOpen = false, children }: { source: SourceName | 'measured'; tone: 'external' | 'pricing' | 'measured'; title: string; meta: string; defaultOpen?: boolean; children: ReactNode }) {
  return <article data-source={source}>
    <details open={defaultOpen}>
      <summary><span className={`source-dot ${tone}`} /><strong>{title}</strong><small>{meta}</small><span className="source-toggle" aria-hidden="true">＋</span></summary>
      <div className="source-body">{children}</div>
    </details>
  </article>;
}

export default function LadderPage() {
  const [view, setView] = useState<View>('quality');
  const [qualityMode, setQualityMode] = useState<QualityMode>('intelligence');
  const [payload, setPayload] = useState<LadderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedModels, setExpandedModels] = useState<string[]>([]);
  const [updating, setUpdating] = useState<SourceName | null>(null);
  const [statusMessage, setStatusMessage] = useState('正在读取共享模型快照…');

  const loadLadder = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/v1/ladder`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nextPayload = await response.json() as LadderPayload;
    setPayload(nextPayload);
    setStatusMessage(nextPayload.models.length
      ? `已载入 ${nextPayload.models.length} 个 OpenRouter 当前模型；外部数据按共享快照展示。`
      : '尚无模型快照，请先点击“更新 OpenRouter”。');
  }, []);

  useEffect(() => {
    setLoading(true);
    loadLadder().catch(() => setStatusMessage('模型数据服务暂不可用，请确认 ModLudus API 已启动。')).finally(() => setLoading(false));
  }, [loadLadder]);

  useEffect(() => {
    setPage(1);
    setExpandedModels([]);
  }, [qualityMode, search, view]);

  async function refreshSource(source: SourceName) {
    setUpdating(source);
    const label = source === 'openrouter' ? 'OpenRouter' : 'Artificial Analysis';
    setStatusMessage(`正在更新 ${label} 共享快照…`);
    try {
      const response = await fetch(`${apiBase}/api/v1/ladder/refresh/${source}`, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { refresh: RefreshResult; ladder: LadderPayload };
      setPayload(result.ladder);
      if (result.refresh.refreshed) {
        setStatusMessage(`${label} 已更新 ${result.refresh.item_count ?? 0} 个模型；${formatTime(result.refresh.retry_at)} 后可再次更新。`);
      } else if (result.refresh.reason === 'daily_limit') {
        setStatusMessage(`${label} 今日已更新；当前直接使用共享快照，${formatTime(result.refresh.retry_at)} 后可再次更新。`);
      } else if (result.refresh.reason === 'refresh_in_progress') {
        setStatusMessage(`其他用户正在更新 ${label}，请稍后刷新；预计 ${formatTime(result.refresh.retry_at)} 前完成。`);
      } else if (result.refresh.reason === 'upstream_failed') {
        setStatusMessage(`${label} 本次更新失败，已保留上一份有效快照；${formatTime(result.refresh.retry_at)} 后可重试。`);
      } else {
        setStatusMessage(`${label} 更新未生效，已保留现有共享快照。`);
      }
    } catch {
      setStatusMessage(`${label} 更新请求失败，现有快照未受影响。`);
    } finally {
      setUpdating(null);
    }
  }

  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase();
    const allModels = payload?.models ?? [];
    const scores = buildRankingScores(allModels);
    const models = allModels.filter((item) => eligibleForView(item, view, qualityMode) && (!query || `${item.model} ${item.provider} ${item.id}`.toLowerCase().includes(query)));
    return models.sort((a, b) => {
      if (view === 'latest') return b.created - a.created;
      if (view === 'quality' && qualityMode === 'quality-speed') return compareNullable(scores.qualitySpeed.get(a.id), scores.qualitySpeed.get(b.id));
      if (view === 'quality' && qualityMode === 'quality-latency') return compareNullable(scores.qualityLatency.get(a.id), scores.qualityLatency.get(b.id));
      if (view === 'quality') return compareNullable(a.quality, b.quality);
      if (view === 'cost') return compareNullable(a.combined_price_per_million, b.combined_price_per_million, 'asc');
      return compareNullable(scores.value.get(a.id), scores.value.get(b.id));
    });
  }, [payload, qualityMode, search, view]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const displayed = sorted.slice(pageStart, pageStart + PAGE_SIZE);
  const openrouterStatus = payload?.sources.openrouter;
  const artificialStatus = payload?.sources['artificial-analysis'];

  function changePage(nextPage: number) {
    setPage(Math.min(totalPages, Math.max(1, nextPage)));
    setExpandedModels([]);
    window.requestAnimationFrame(() => document.getElementById('ladder-results')?.scrollIntoView({ block: 'start' }));
  }

  function toggleModelDetails(id: string) {
    setExpandedModels((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  return <main className="product-page ladder-page">
    <section className="page-heading"><div><span className="eyebrow">智能选型榜</span><h1>模型天梯</h1><p>OpenRouter 提供当前模型目录与价格，Artificial Analysis 提供横向质量和性能快照，ModLudus 标准评测补充真实业务证据。</p></div><Link href="/evaluations" className="primary-button">用真实任务评测 <span>→</span></Link></section>

    <section className="ladder-sources" aria-label="天梯数据来源">
      <SourceCard source="artificial-analysis" tone="external" title="Artificial Analysis" meta={`快照 ${formatTime(artificialStatus?.captured_at)} · ${artificialStatus?.item_count ?? 0} 个模型`} defaultOpen>
        <p>Intelligence、Cost per Task、输出速度、TTFT 与总响应时间。全站每日最多更新一次。</p>
        <div className="source-actions"><a href="https://artificialanalysis.ai/leaderboards/models" target="_blank" rel="noreferrer">查看原始榜单</a><button className="outline-button compact-button" disabled={updating !== null} onClick={() => refreshSource('artificial-analysis')}>{updating === 'artificial-analysis' ? '更新中…' : '手动更新'}</button></div>
      </SourceCard>
      <SourceCard source="openrouter" tone="pricing" title="OpenRouter Models" meta={`快照 ${formatTime(openrouterStatus?.captured_at)} · ${openrouterStatus?.item_count ?? 0} 个模型`} defaultOpen>
        <p>当前模型目录、Model ID、上下文、上架时间及输入/输出公开参考价。全站每日最多更新一次。</p>
        <div className="source-actions"><a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">查看价格来源</a><button className="outline-button compact-button" disabled={updating !== null} onClick={() => refreshSource('openrouter')}>{updating === 'openrouter' ? '更新中…' : '手动更新'}</button></div>
      </SourceCard>
      <SourceCard source="measured" tone="measured" title="ModLudus 实测" meta={`当前覆盖 ${payload?.community_evaluations?.display_total ?? 284} 个有效样本`} defaultOpen>
        <p>固定数据集、Rubric 版本和签名报告，与外部市场指标分开展示。</p>
        <Link href="/admin">查看标准评测</Link>
      </SourceCard>
    </section>

    <p className="status-message ladder-status" aria-live="polite">{loading ? '正在整理模型榜单与价格快照…' : statusMessage}</p>

    <section id="ladder-results" className="ladder-workbench">
      <div className="ladder-toolbar"><div className="ladder-controls"><div className="ladder-presets" role="group" aria-label="天梯排序方式">{views.map(([value, label]) => <button key={value} aria-pressed={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{label}</button>)}</div><input aria-label="搜索模型" className="ladder-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模型、厂商或 Model ID" /></div><span>{sorted.length ? `显示 ${pageStart + 1}–${pageStart + displayed.length}/${sorted.length}` : '显示 0/0'} · 当前排序：{view === 'quality' ? qualityModes.find(([value]) => value === qualityMode)?.[1] : views.find(([value]) => value === view)?.[1]}</span></div>
      {view === 'quality' && <div className="quality-modes" role="group" aria-label="质量优先细分">{qualityModes.map(([value, label]) => <button key={value} aria-pressed={qualityMode === value} className={qualityMode === value ? 'active' : ''} onClick={() => setQualityMode(value)}>{label}</button>)}</div>}
      {loading ? <div className="ladder-skeleton" aria-label="正在加载模型榜单">{Array.from({ length: 6 }, (_, index) => <div key={index}><span /><span /><span /><span /></div>)}</div> : displayed.length ? <>
        <div className="ladder-list-head" aria-hidden="true"><span>模型</span><span>AA Intelligence</span><span>OpenRouter 价格</span><span>输出速度</span><span>首字延迟</span></div>
        <div className="ladder-list">{displayed.map((item, index) => {
          const isExpanded = expandedModels.includes(item.id);
          const qualityPrimary = true;
          const pricePrimary = view === 'cost' || view === 'value' || view === 'latest' || (view === 'quality' && qualityMode === 'intelligence');
          const speedPrimary = view === 'quality' && qualityMode === 'quality-speed';
          const latencyPrimary = view === 'quality' && qualityMode === 'quality-latency';
          return <article key={item.id} className={`ladder-model-card${isExpanded ? ' details-open' : ''}`}><div className="ladder-model-name"><span className="rank">{String(pageStart + index + 1).padStart(2, '0')}</span><ProviderLogo provider={item.provider} /><div><strong>{item.model}</strong><small>{item.provider} · {formatContext(item)} · {item.id}</small></div></div><dl><div className={`${view === 'quality' || view === 'value' ? 'active ' : ''}${qualityPrimary ? 'metric-primary' : ''}`}><dt>AA Intelligence</dt><dd>{valueOrDash(item.quality, 1)}</dd><small>{item.aa_model ? `${item.aa_model}${Number.isFinite(item.aa_cost_per_task_usd) ? ` · $${Number(item.aa_cost_per_task_usd).toFixed(2)}/任务` : ''}` : item.quality_source === 'openrouter-aa-benchmark' ? 'OpenRouter 目录内含 AA Intelligence' : '暂无 AA 匹配指标'}</small></div><div className={`${view === 'cost' || view === 'value' ? 'active ' : ''}${pricePrimary ? 'metric-primary' : ''}`}><dt>OpenRouter 价格</dt><dd>{Number.isFinite(item.combined_price_per_million) ? `$${Number(item.combined_price_per_million).toFixed(2)}` : '—'}</dd><small>输入＋输出 / 百万 tokens</small></div><div className={speedPrimary ? 'metric-primary' : ''}><dt>输出速度</dt><dd>{Number.isFinite(item.speed_tokens_per_second) ? `${valueOrDash(item.speed_tokens_per_second)} t/s` : '—'}</dd><small>Artificial Analysis 快照</small></div><div className={latencyPrimary ? 'metric-primary' : ''}><dt>首字延迟</dt><dd>{Number.isFinite(item.latency_first_chunk_seconds) ? `${valueOrDash(item.latency_first_chunk_seconds, 2)}s` : '—'}</dd><small>{Number.isFinite(item.total_response_seconds) ? `总响应 ${valueOrDash(item.total_response_seconds, 2)}s` : '暂无总响应数据'}</small></div></dl><button className="model-detail-toggle" onClick={() => toggleModelDetails(item.id)} aria-expanded={isExpanded}>{isExpanded ? '收起指标' : '展开全部指标'}</button></article>;
        })}</div>
        {totalPages > 1 && <nav className="ladder-pagination" aria-label="模型天梯分页"><button className="outline-button" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1}>上一页</button><div>{Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => <button key={item} className={item === currentPage ? 'active' : ''} aria-current={item === currentPage ? 'page' : undefined} onClick={() => changePage(item)}>{item}</button>)}</div><button className="outline-button" onClick={() => changePage(currentPage + 1)} disabled={currentPage === totalPages}>下一页</button></nav>}
      </> : <div className="ladder-empty"><strong>暂无可展示模型</strong><p>请先更新 OpenRouter 模型目录；Artificial Analysis 更新用于补充质量、速度和延迟指标。</p></div>}
      <p className="ladder-disclaimer">性价比采用质量优先型综合分：AA Intelligence 归一化占 85%，OpenRouter 输入＋输出参考价的对数归一化占 15%；不会按厂商或国家加分。低成本与性价比均排除价格为 0、缺失或无有效质量数据的模型。质量优先可按综合质量、质量＋速度、质量＋低延迟拆分；外部指标不与 ModLudus 真实业务分数直接平均。</p>
    </section>
  </main>;
}
