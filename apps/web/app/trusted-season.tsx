'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type TrustedStatus = {
  ready: boolean;
  environment: string;
  simulated: boolean;
  season_id: string;
  case_count: number;
  categories: string[];
  configuration: null | { candidates: string[]; judge: string; concurrency: number };
  signing: { algorithm: string; public_key: string; fingerprint: string };
  audit_chain_valid: boolean;
  start_auth: { mode: 'admin-token' | 'local-loopback-bypass' | 'misconfigured'; writable: boolean };
  review_auth: { mode: 'reviewer-token' | 'admin-token' | 'misconfigured'; writable: boolean };
  worker: { mode: 'persistent-worker'; ready: boolean; state: string; last_seen_at?: string | null; current_run_id?: string | null };
};

type TrustedRun = {
  id: string;
  season_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  environment: string;
  simulated: number | boolean;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  manifest_hash: string;
  total_cases: number;
  completed_cases: number;
  error?: string | null;
  evidence_id?: string | null;
};

type Evidence = {
  id: string;
  run_id: string;
  evidence_hash: string;
  signature: string;
  public_key: string;
  created_at: string;
  report: {
    manifest: { environment?: string; simulated?: boolean; dataset_hash: string; configuration_hash: string; rubric: { fingerprint: string }; candidates: Array<{ model: string }> };
    ranking: Array<{ model: string; average_score: number | null; wins: number; failures: number; average_latency_ms: number | null; estimated_cost_usd: number }>;
    summary: { total_cases: number; review_required: number; failed_attempts: number };
    results: Array<{ case_id: string; category: string; review_required: boolean }>;
  };
};

type Verification = {
  verified: boolean;
  evidence_hash_valid?: boolean;
  signature_valid?: boolean;
  audit_chain_valid: boolean;
  public_key_fingerprint?: string;
};

type AuditEvent = { seq: number; event_type: string; event_hash: string; created_at: string; payload: Record<string, unknown> };
type ReviewDecision = { id: string; case_id: string; decision: 'confirmed' | 'overturned' | 'needs_followup'; reviewer_hash: string; created_at: string };
type PublicationEligibility = { eligible: boolean; reasons: string[] };
type Publication = { id: string; run_id: string; evidence_hash: string; review_snapshot_hash: string; publication_hash: string; published_at: string; ranking: Evidence['report']['ranking'] };

const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

function shortHash(value?: string | null) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : '—';
}

const publicationReasonText: Record<string, string> = {
  sealed_evidence_required: '需要已封存证据',
  run_not_completed: '运行尚未完成',
  official_environment_required: '仅 official 环境可发布',
  non_simulated_evidence_required: '模拟证据不可发布',
  evidence_verification_failed: '证据验签失败',
  required_reviews_unresolved: '必要人工复核尚未闭环',
  already_published: '该运行已经发布',
};

function downloadEvidence(evidence: Evidence) {
  const content = JSON.stringify({
    schema_version: 'm3.3-signed-envelope',
    evidence_hash: evidence.evidence_hash,
    signature: evidence.signature,
    public_key: evidence.public_key,
    report: evidence.report,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `modludus-${evidence.run_id}-signed.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function TrustedSeason() {
  const [serverStatus, setServerStatus] = useState<TrustedStatus | null>(null);
  const [runs, setRuns] = useState<TrustedRun[]>([]);
  const [activeRun, setActiveRun] = useState<TrustedRun | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewDecision>>({});
  const [eligibility, setEligibility] = useState<PublicationEligibility | null>(null);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [message, setMessage] = useState('正在检查可信赛季服务…');
  const [starting, setStarting] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [reviewerToken, setReviewerToken] = useState('');
  const [reviewerId, setReviewerId] = useState('reviewer');
  const [publishing, setPublishing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewsLocked = eligibility?.reasons.includes('already_published') ?? false;

  const fetchJson = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `HTTP ${response.status}`);
    }
    return response.json();
  }, []);

  const loadEvidence = useCallback(async (runId: string) => {
    const [nextEvidence, nextVerification, audit, reviewPayload, publicationEligibility] = await Promise.all([
      fetchJson<Evidence>(`/api/v1/trusted-seasons/runs/${runId}/evidence`),
      fetchJson<Verification>(`/api/v1/trusted-seasons/runs/${runId}/verify`, { method: 'POST' }),
      fetchJson<{ events: AuditEvent[] }>(`/api/v1/trusted-seasons/runs/${runId}/audit`),
      fetchJson<{ latest: Record<string, ReviewDecision> }>(`/api/v1/trusted-seasons/runs/${runId}/reviews`),
      fetchJson<PublicationEligibility>(`/api/v1/trusted-seasons/runs/${runId}/publication-eligibility`),
    ]);
    setEvidence(nextEvidence);
    setVerification(nextVerification);
    setAuditEvents(audit.events);
    setReviews(reviewPayload.latest);
    setEligibility(publicationEligibility);
  }, [fetchJson]);

  const pollRun = useCallback(async (runId: string) => {
    try {
      const run = await fetchJson<TrustedRun>(`/api/v1/trusted-seasons/runs/${runId}`);
      setActiveRun(run);
      setRuns((items) => [run, ...items.filter((item) => item.id !== run.id)].slice(0, 5));
      if (run.status === 'completed') {
        await loadEvidence(run.id);
        setMessage('可信赛季完成，签名报告与审计链已生成。');
        return;
      }
      if (run.status === 'failed') {
        setMessage(`可信赛季失败：${run.error || '未知错误'}`);
        return;
      }
      setMessage(`服务端正在执行固定赛季：${run.completed_cases}/${run.total_cases}。`);
      pollTimer.current = setTimeout(() => void pollRun(runId), 1000);
    } catch (error) {
      setMessage(`运行状态读取失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [fetchJson, loadEvidence]);

  const refresh = useCallback(async () => {
    try {
      const [status, runPayload, leaderboard] = await Promise.all([
        fetchJson<TrustedStatus>('/api/v1/trusted-seasons/status'),
        fetchJson<{ runs: TrustedRun[] }>('/api/v1/trusted-seasons/runs?limit=5'),
        fetchJson<{ publications: Publication[] }>('/api/v1/trusted-seasons/leaderboard?limit=5'),
      ]);
      setServerStatus(status);
      setRuns(runPayload.runs);
      setPublications(leaderboard.publications);
      setMessage(status.ready
        ? `可信执行器已就绪：${status.case_count} 道固定题，${status.configuration?.candidates.length ?? 0} 个候选模型。`
        : 'API 已连接，但尚未配置服务器托管的可信赛季模型。');
      const latest = runPayload.runs[0];
      if (latest) {
        setActiveRun(latest);
        if (latest.status === 'queued' || latest.status === 'running') void pollRun(latest.id);
        if (latest.status === 'completed') await loadEvidence(latest.id);
      }
    } catch (error) {
      setServerStatus(null);
      setMessage(`可信赛季 API 未连接：${error instanceof Error ? error.message : '未知错误'}。浏览器隐私模式不受影响。`);
    }
  }, [fetchJson, loadEvidence, pollRun]);

  useEffect(() => {
    void refresh();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [refresh]);

  async function startRun() {
    setStarting(true);
    setEvidence(null);
    setVerification(null);
    setAuditEvents([]);
    setReviews({});
    setEligibility(null);
    try {
      const run = await fetchJson<TrustedRun>('/api/v1/trusted-seasons/runs', {
        method: 'POST',
        headers: adminToken ? { 'X-ModLudus-Admin-Token': adminToken } : {},
      });
      setActiveRun(run);
      setMessage('可信赛季已入队，服务器正在冻结运行清单。');
      void pollRun(run.id);
    } catch (error) {
      setMessage(`无法启动可信赛季：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setStarting(false);
    }
  }

  async function selectRun(run: TrustedRun) {
    setActiveRun(run);
    setEvidence(null);
    setVerification(null);
    setAuditEvents([]);
    setReviews({});
    setEligibility(null);
    if (run.status === 'completed') await loadEvidence(run.id);
    if (run.status === 'queued' || run.status === 'running') void pollRun(run.id);
  }

  async function submitReview(caseId: string, decision: ReviewDecision['decision']) {
    if (!activeRun) return;
    try {
      await fetchJson(`/api/v1/trusted-seasons/runs/${activeRun.id}/reviews`, {
        method: 'POST',
        headers: reviewerToken ? { 'X-ModLudus-Reviewer-Token': reviewerToken } : {},
        body: JSON.stringify({ reviewer_id: reviewerId, decisions: [{ case_id: caseId, decision }] }),
      });
      await loadEvidence(activeRun.id);
      setMessage(`复核决定已追加：${caseId} · ${decision}。`);
    } catch (error) {
      setMessage(`复核提交失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async function publishRun() {
    if (!activeRun) return;
    setPublishing(true);
    try {
      await fetchJson('/api/v1/trusted-seasons/leaderboard', {
        method: 'POST',
        headers: adminToken ? { 'X-ModLudus-Admin-Token': adminToken } : {},
        body: JSON.stringify({ run_id: activeRun.id, publisher_id: reviewerId || 'publisher' }),
      });
      await refresh();
      setMessage('可信赛季榜发布记录已封存。');
    } catch (error) {
      setMessage(`发布失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setPublishing(false);
    }
  }

  return <section id="trusted-season" className="trusted-section">
    <div className="trusted-heading"><div><span className="section-kicker">可信执行与审计</span><h2>可恢复的服务端标准评测</h2><p>固定运行清单进入持久任务队列，由独立任务执行器领取和续租；API 重启不会丢失任务。用户浏览器中的 Base URL、Key 和题目仍不会进入可信链路。</p></div><span className={serverStatus?.ready ? 'trust-pill ready' : 'trust-pill'}>{serverStatus?.ready ? `执行器已就绪 · ${serverStatus.environment}${serverStatus.simulated ? ' · 模拟环境' : ''}` : '等待服务端配置'}</span></div>

    <div className="trust-overview">
      <article><small>固定赛季</small><strong>{serverStatus?.season_id ?? 'standard-2026.1'}</strong><span>{serverStatus?.case_count ?? 8} 题 · 文案 / 代码 / 总结 / 分析</span></article>
      <article><small>签名身份</small><strong>{serverStatus?.signing.algorithm ?? 'Ed25519'}</strong><span>公钥指纹 {serverStatus?.signing.fingerprint ?? '连接 API 后显示'}</span></article>
      <article><small>审计链</small><strong>{serverStatus ? (serverStatus.audit_chain_valid ? '有效' : '异常') : '待检查'}</strong><span>仅追加哈希链与不可变证据表</span></article>
      <article><small>持久任务执行器</small><strong>{serverStatus?.worker.ready ? serverStatus.worker.state : '离线'}</strong><span>{serverStatus?.worker.ready ? `最近心跳 ${serverStatus.worker.last_seen_at?.replace('T', ' ').slice(0, 19)} UTC` : '任务会保留在队列，等待执行器恢复'}</span></article>
    </div>

    <article className="trusted-control">
      <div><strong>可信运行控制台</strong><p>{message}</p>{serverStatus?.configuration && <small>候选：{serverStatus.configuration.candidates.join('、')} · 裁判：{serverStatus.configuration.judge} · 题目并发 {serverStatus.configuration.concurrency} · 持久任务模式 · 写入鉴权 {serverStatus.start_auth.mode}</small>}{serverStatus?.start_auth.mode === 'admin-token' && <input className="admin-token-input" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="管理员启动/发布令牌（仅保存在页面内存）" aria-label="可信赛季管理员启动令牌" />}{serverStatus?.review_auth.writable && <div className="review-auth-row"><input className="admin-token-input" value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} placeholder="复核人标识" aria-label="可信赛季复核人标识" /><input className="admin-token-input" type="password" value={reviewerToken} onChange={(event) => setReviewerToken(event.target.value)} placeholder={`复核令牌 · ${serverStatus.review_auth.mode}`} aria-label="可信赛季复核令牌" /></div>}</div>
      <div className="trusted-actions"><button className="outline-button" onClick={() => void refresh()}>刷新状态</button><button className="run-button" disabled={!serverStatus?.ready || !serverStatus.start_auth.writable || starting || activeRun?.status === 'queued' || activeRun?.status === 'running'} onClick={() => void startRun()}>{starting ? '正在创建…' : '启动标准赛季'} <span>→</span></button></div>
    </article>

    {activeRun && <div className="trusted-progress"><div><span>RUN {activeRun.id.slice(-10)}</span><strong>{activeRun.status === 'completed' ? '已封存' : activeRun.status === 'failed' ? '失败' : '执行中'}</strong></div><div className="progress-track"><i style={{ width: `${activeRun.total_cases ? activeRun.completed_cases / activeRun.total_cases * 100 : 0}%` }} /></div><small>{activeRun.completed_cases}/{activeRun.total_cases} · Manifest {shortHash(activeRun.manifest_hash)}</small></div>}

    <div className="trusted-grid">
      <article className="run-history"><div className="panel-title"><div><strong>运行记录</strong><small>服务器持久化状态；证据一旦封存不可更新或删除</small></div></div>{runs.length ? runs.map((run) => <button key={run.id} className={activeRun?.id === run.id ? 'run-history-item selected' : 'run-history-item'} onClick={() => void selectRun(run)}><span><strong>{run.id.slice(-12)}</strong><small>{run.created_at.replace('T', ' ').slice(0, 19)} UTC · {run.environment}{run.simulated ? ' · 模拟环境' : ''}</small></span><em>{run.status} · {run.completed_cases}/{run.total_cases}</em></button>) : <p className="empty-copy">尚无可信赛季运行。</p>}</article>

      <article className="evidence-panel"><div className="panel-title"><div><strong>签名报告</strong><small>证据哈希、Ed25519 签名、公钥及冻结运行清单</small></div>{verification && <span className={verification.verified ? 'verified-chip' : 'verified-chip invalid'}>{verification.verified ? '✓ 验签通过' : '验签失败'}</span>}</div>{evidence ? <><div className="evidence-origin"><span>签名证据环境</span><strong>{evidence.report.manifest.environment ?? activeRun?.environment ?? '历史未冻结'}{(evidence.report.manifest.simulated ?? Boolean(activeRun?.simulated)) ? ' · 模拟环境' : ''}</strong></div><div className="evidence-hashes"><span>证据 <code>{shortHash(evidence.evidence_hash)}</code></span><span>测试集 <code>{shortHash(evidence.report.manifest.dataset_hash)}</code></span><span>评分规则 <code>{shortHash(evidence.report.manifest.rubric.fingerprint)}</code></span><span>配置 <code>{shortHash(evidence.report.manifest.configuration_hash)}</code></span></div><div className="evidence-summary"><div><small>完成题目</small><strong>{evidence.report.summary.total_cases}</strong></div><div><small>需复核</small><strong>{evidence.report.summary.review_required}</strong></div><div><small>失败调用</small><strong>{evidence.report.summary.failed_attempts}</strong></div></div><button className="outline-button" onClick={() => downloadEvidence(evidence)}>下载签名 JSON 报告</button></> : <p className="empty-copy">运行完成后生成不可变签名报告。</p>}</article>
    </div>

    {evidence && <div className="trusted-grid detail"><article className="ranking-panel"><div className="panel-title"><div><strong>可信赛季结果</strong><small>按固定 Rubric 的平均质量分排序</small></div></div>{evidence.report.ranking.map((item, index) => <div className="trusted-rank" key={item.model}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.model}</strong><small>{item.wins} 胜 · {item.failures} 失败 · {item.average_latency_ms ?? '—'} ms · ${item.estimated_cost_usd.toFixed(6)}</small></div><em>{item.average_score ?? '—'}</em></div>)}</article><article className="audit-panel"><div className="panel-title"><div><strong>审计记录</strong><small>{verification?.audit_chain_valid ? '哈希链完整' : '等待验证'} · 展示当前运行事件</small></div></div>{auditEvents.slice(-8).map((event) => <div className="audit-event" key={event.seq}><span>{event.seq}</span><div><strong>{event.event_type}</strong><small>{event.created_at.replace('T', ' ').slice(0, 19)} UTC · {shortHash(event.event_hash)}</small></div></div>)}</article></div>}

    {evidence && <div className="trusted-grid detail"><article className="review-panel"><div className="panel-title"><div><strong>人工复核队列</strong><small>{reviewsLocked ? '榜单已发布，复核快照已冻结，不再允许追加。' : '“纠正”只记录异议并保持未闭环；本版仅“确认”可解除必要复核门禁。'}</small></div></div>{evidence.report.results.length ? evidence.report.results.map((item) => <div className="review-item" key={item.case_id}><span><strong>{item.case_id}</strong><small>{item.category} · {item.review_required ? '强制复核' : '可选抽检'} · 当前 {reviews[item.case_id]?.decision ?? '未复核'}</small></span><div><button className="outline-button" disabled={reviewsLocked} onClick={() => void submitReview(item.case_id, 'confirmed')}>确认</button><button className="outline-button" disabled={reviewsLocked} onClick={() => void submitReview(item.case_id, 'overturned')}>标记纠正</button><button className="outline-button" disabled={reviewsLocked} onClick={() => void submitReview(item.case_id, 'needs_followup')}>待跟进</button></div></div>) : <p className="empty-copy">没有可复核题目。</p>}</article><article className="publication-panel"><div className="panel-title"><div><strong>赛季榜发布门禁</strong><small>发布时冻结证据、实际排名与 review snapshot hash</small></div></div><div className={eligibility?.eligible ? 'publication-status eligible' : 'publication-status'}><strong>{eligibility?.eligible ? '可发布' : '不可发布'}</strong><span>{eligibility?.reasons.length ? eligibility.reasons.map((reason) => publicationReasonText[reason] ?? reason).join(' · ') : '全部发布门禁已通过'}</span></div><button className="run-button" disabled={!eligibility?.eligible || publishing} onClick={() => void publishRun()}>{publishing ? '正在封存…' : '发布到可信赛季榜'} <span>→</span></button><div className="publication-list">{publications.map((item) => <div key={item.id}><strong>{item.run_id.slice(-12)}</strong><small>{item.published_at.replace('T', ' ').slice(0, 19)} UTC · Pub {shortHash(item.publication_hash)} · Review {shortHash(item.review_snapshot_hash)}</small></div>)}</div></article></div>}
  </section>;
}
