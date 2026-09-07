import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const ladder = readFileSync(new URL('../app/ladder/page.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const evaluation = readFileSync(new URL('../app/model-evaluation.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../app/app-shell.tsx', import.meta.url), 'utf8');
const icon = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8');
const homeNav = readFileSync(new URL('../app/home-section-nav.tsx', import.meta.url), 'utf8');
const communityMetrics = readFileSync(new URL('../app/community-metrics.ts', import.meta.url), 'utf8');

test('purple-white design tokens are semantic and legacy theme aliases are removed', () => {
  assert.match(css, /--accent:\s*#7b22f6/);
  assert.match(css, /--accent-hover:\s*#6717d8/);
  assert.match(css, /--accent-soft:\s*#f4edff/);
  assert.doesNotMatch(css, /--(?:green|blue|orange|lime|success)\b/);
  assert.doesNotMatch(css, /#(?:eff7e9|eef7dc|eaf6ee|183f35|afd0ba)\b/i);
  assert.doesNotMatch(css, /rgba\((?:23,\s*77,\s*61|37,\s*99,\s*235),/);
});

test('shared controls use only the documented size tiers', () => {
  assert.match(css, /--control-height:\s*40px/);
  assert.match(css, /--control-height:\s*42px/);
  assert.match(css, /\.compact-button\s*\{[^}]*min-height:\s*34px/s);
  assert.doesNotMatch(css, /min-height:\s*32px/);
});

test('ladder sources use compact expandable cards on desktop and mobile', () => {
  assert.match(ladder, /function SourceCard/);
  assert.match(ladder, /<details open=\{defaultOpen\}>/);
  assert.match(ladder, /<summary>/);
  assert.match(ladder, /source="artificial-analysis"[\s\S]*defaultOpen/);
  assert.match(ladder, /source="openrouter"[\s\S]*defaultOpen/);
  assert.match(css, /\.ladder-sources summary\s*\{/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ladder-sources summary/);
});

test('ladder exposes country filtering, five product sorting categories, and transparent value ranking', () => {
  assert.match(ladder, /\['quality', '质量优先'\], \['cost', '低价'\], \['value', '性价比'\], \['speed', '快速'\], \['latest', '新上架'\]/);
  assert.match(ladder, /\['china', '🇨🇳 中国'\], \['usa', '🇺🇸 美国'\]/);
  assert.match(ladder, /country === 'all' \|\| providerCountry\(item\) === country/);
  assert.match(ladder, /国家仅按模型厂商所属地筛选，不参与评分或排名加权/);
  assert.match(css, /\.country-filters\s*\{/);
  assert.doesNotMatch(ladder, /\['speed', '高速度'\]|\['latency', '低延迟'\]/);
  assert.doesNotMatch(ladder, /综合质量|质量＋速度|质量＋低延迟|quality-modes/);
  assert.match(ladder, /AA Intelligence 归一化占 85%/);
  assert.match(ladder, /排除价格为 0、缺失或无有效质量数据的模型/);
  assert.doesNotMatch(css, /\.quality-modes\s*\{/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.ladder-presets\s*\{\s*grid-template-columns:\s*repeat\(2/);
});

test('ladder shows provider logos, removes the evidence column, and uses the community counter', () => {
  assert.match(ladder, /function ProviderLogo/);
  assert.match(ladder, /<ProviderLogo provider=\{item\.provider\}/);
  assert.match(ladder, /community_evaluations\?\.display_total \?\? 284/);
  assert.doesNotMatch(ladder, /<span>实测证据<\/span>/);
  assert.doesNotMatch(ladder, /<dt>实测证据<\/dt>/);
  assert.match(css, /\.provider-logo\s*\{/);
  assert.match(css, /repeat\(4,minmax\(100px,\.7fr\)\)/);
});

test('ladder reuses the compact evaluation title rhythm', () => {
  assert.match(ladder, /className="evaluation-heading ladder-heading"/);
  assert.match(ladder, /<h1>模型天梯<\/h1><span>智能选型榜<\/span>/);
  assert.match(ladder, /className="ladder-heading-description"/);
  assert.match(css, /\.ladder-heading\s*\{[^}]*align-items:\s*flex-end/s);
  assert.match(css, /\.ladder-heading-description\s*\{[^}]*font-size:\s*13px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.ladder-heading\s*\{[\s\S]*?flex-direction:\s*column/s);
});

test('ladder bounds long lists with pagination and collapsible mobile metrics', () => {
  assert.match(ladder, /const PAGE_SIZE = 20/);
  assert.match(ladder, /sorted\.slice\(pageStart, pageStart \+ PAGE_SIZE\)/);
  assert.match(ladder, /aria-label="模型天梯分页"/);
  assert.match(ladder, /展开全部指标/);
  assert.match(ladder, /正在整理模型榜单与价格快照/);
  assert.match(ladder, /className="ladder-skeleton"/);
  assert.match(css, /\.ladder-toolbar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.ladder-model-card:not\(\.details-open\) dl > div:not\(\.metric-primary\)/);
});

test('home uses optional anchor navigation without mandatory scroll snapping', () => {
  assert.match(home, /id="selection"/);
  assert.match(home, /id="scenarios"/);
  assert.match(home, /id="modes"/);
  assert.match(home, /继续浏览/);
  assert.match(homeNav, /IntersectionObserver/);
  assert.match(homeNav, /aria-current=\{active === id \? 'location'/);
  assert.match(css, /\.home-page > section\s*\{[^}]*scroll-margin-top:/s);
  assert.doesNotMatch(css, /scroll-snap-type:\s*[^;]*mandatory/);
});

test('privacy copy states the local-only boundary and recommends a dedicated test key', () => {
  assert.match(home, /浏览器隐私模式/);
  assert.match(home, /全程浏览器本地评分，API Key、测评任务仅直连模型厂商 API，不经任何三方服务器、不做任何留存/);
  assert.match(evaluation, /<h1>模型评测<\/h1><span>快速选型工作台<\/span>/);
  assert.doesNotMatch(evaluation, /● 当前浏览器隐私模式|Key、任务和答案默认不离开浏览器/);
  assert.match(evaluation, /<strong>🔒 浏览器隐私模式<\/strong>/);
  assert.match(evaluation, /模型编排、评分汇总、结果渲染，全程在您的浏览器本地完成，全程仅加密直连模型厂商/);
  assert.match(evaluation, /建议使用测试专用 Key/);
  assert.match(evaluation, /凭据仅在当前页面内存中用于直连请求，刷新后清空/);
  assert.match(css, /\.credential-safety-note\s*\{/);
  assert.match(communityMetrics, /NEXT_PUBLIC_ENABLE_ANONYMOUS_CONTRIBUTIONS === 'true'/);
  assert.match(communityMetrics, /if \(!anonymousContributionsEnabled\) return false/);
});

test('evaluation page stays focused on the usable quick workflow', () => {
  assert.doesNotMatch(evaluation, /批量评测即将上线|className="mode-coming-soon"/);
  assert.doesNotMatch(evaluation, /import BatchLab/);
  assert.doesNotMatch(evaluation, /setEvaluationMode\('batch'\)/);
  assert.match(home, /coming-soon-label">即将上线/);
});

test('quick evaluation uses a searchable model picker dialog and expandable long answers', () => {
  assert.match(evaluation, /选择候选模型/);
  assert.match(evaluation, /slice\(0, 80\)/);
  assert.match(evaluation, /已选 \{selectedModels\.length\} 个/);
  assert.match(evaluation, /role="dialog" aria-modal="true"/);
  assert.match(evaluation, /openModelPicker\('candidate', connection\.id\)/);
  assert.match(evaluation, /aria-label="搜索可用模型"/);
  assert.match(evaluation, /展开完整答案/);
  assert.match(css, /\.model-picker-options\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.result-card pre\.expanded\s*\{[^}]*max-height:\s*none/s);
});

test('quick evaluation auto-discovers models and gives candidate and judge matching picker controls', () => {
  assert.match(evaluation, /window\.setTimeout\(\(\) => void loadModels\(connection, signature\), 450\)/);
  assert.match(evaluation, /填写 Base URL 和 Key 后自动读取模型/);
  assert.doesNotMatch(evaluation, />发现模型<\/button>/);
  assert.match(evaluation, /className="model-select-trigger"[\s\S]*openModelPicker\('candidate'/);
  assert.match(evaluation, /className="model-select-trigger judge-select-trigger"[\s\S]*openModelPicker\('judge'/);
  assert.doesNotMatch(evaluation, /<select aria-label="评审模型"/);
  assert.doesNotMatch(evaluation, /<input aria-label="评审 Model ID"/);
  assert.match(evaluation, /connection-add-button[\s\S]*添加其他网关/);
  assert.doesNotMatch(evaluation, /添加模型来源/);
});

test('completed candidates open a dedicated result view with judge recovery', () => {
  assert.match(evaluation, /if \(successful\.length\) \{[\s\S]*setEvaluationView\('results'\)/);
  assert.match(evaluation, /setRunPhase\('judging'\)[\s\S]*setStatusMessage\('正在进行独立裁决，请保持页面开启。'\)[\s\S]*setEvaluationView\('results'\)/);
  assert.match(evaluation, /runPhase === 'judging' \? '候选测评完成'/);
  assert.match(evaluation, /所有候选模型均未返回有效结果/);
  assert.match(evaluation, /<h1>测评完成<\/h1>/);
  assert.match(evaluation, /返回修改并重测/);
  assert.match(evaluation, /候选结果已完成，自动裁判暂未完成/);
  assert.match(evaluation, /结果页评审模型/);
  assert.match(evaluation, /void retryJudge\(\)/);
  assert.match(evaluation, /failedCandidates = results\.filter\(\(item\) => item\.failed\)/);
  assert.match(evaluation, /results\.map\(\(item\) => retriedByAlias\.get\(item\.alias\) \?\? item\)/);
  assert.match(evaluation, /成功候选不会重复调用/);
  assert.match(evaluation, /重试未完成候选并重新评审/);
});

test('quick evaluation makes long-running work visible, bounded, and cancellable', () => {
  assert.doesNotMatch(evaluation, /● 运行中 · \$\{runSeconds\} 秒/);
  assert.match(evaluation, /候选生成 \$\{completedCandidates\}\/\$\{candidateCount\}/);
  assert.match(evaluation, /CANDIDATE_REQUEST_TIMEOUT_MS = 180_000/);
  assert.match(evaluation, /JUDGE_REQUEST_TIMEOUT_MS = 180_000/);
  assert.match(evaluation, /RUN_PHASE_TIMEOUT_SECONDS = 180/);
  assert.match(evaluation, /PARTIAL_JUDGE_OFFER_AFTER_SECONDS = 90/);
  assert.match(evaluation, /使用已完成结果立即裁决/);
  assert.match(evaluation, /successfulCandidatesCompleted >= 2/);
  assert.match(evaluation, /candidatePhaseControllerRef\.current\?\.abort\(\)/);
  assert.match(evaluation, /\[runPhase, running\]/);
  assert.match(evaluation, /运行中 · 剩余 \$\{phaseRemainingSeconds\}s/);
  assert.match(evaluation, /候选模型仍在生成；每个候选的硬超时仍为 180 秒/);
  assert.match(evaluation, /裁判正在读取全部候选答案并评分，本阶段最长等待 180 秒/);
  assert.match(evaluation, /取消评测/);
  assert.match(evaluation, /candidate-progress-track/);
  assert.match(evaluation, /参考价读取失败，暂不显示成本。/);
  assert.doesNotMatch(evaluation, /<div className="privacy-panel"><strong>🔒 浏览器隐私模式/);
  assert.match(css, /\.running-status\s*\{/);
  assert.match(css, /\.partial-judge-offer\s*\{/);
  assert.match(css, /\.run-button\.running:disabled/);
  assert.match(css, /@keyframes run-spin/);
});

test('auxiliary requests do not extend the model evaluation critical path', () => {
  assert.match(evaluation, /PRICE_WAIT_TIMEOUT_MS = 2_500/);
  assert.match(evaluation, /const runPricesPromise = loadRunPricesWithinBudget\(\)/);
  assert.match(evaluation, /const runPrices = await runPricesPromise/);
  assert.match(evaluation, /MODEL_DISCOVERY_TIMEOUT_MS = 12_000/);
  assert.match(evaluation, /signal: controller\.signal/);
  assert.match(evaluation, /void recordCommunityEvaluation\(\)\.then/);
  assert.doesNotMatch(evaluation, /await recordCommunityEvaluation\(\)/);
  assert.doesNotMatch(evaluation, /new Promise<void>\(\(resolve\) => window\.setTimeout\(resolve, 600\)\)/);
});

test('model calls omit temperature for providers that reject the parameter', () => {
  assert.match(evaluation, /Claude Opus 5/);
  assert.match(evaluation, /JSON\.stringify\(\{ model, messages: \[\{ role: 'user', content \}\] \}\)/);
  assert.doesNotMatch(evaluation, /JSON\.stringify\(\{ model, messages: \[\{ role: 'user', content \}\], temperature \}\)/);
  assert.doesNotMatch(evaluation, /reasoning_effort:\s*['"]low['"]/);
  assert.match(evaluation, /providerMessage = typeof parsed\.error === 'string'/);
});

test('evaluation reuses the backend OpenRouter price snapshot', () => {
  assert.match(evaluation, /fetch\(`\$\{apiBase\}\/api\/v1\/ladder`, \{ cache: 'no-store'(?:, signal)? \}\)/);
  assert.match(evaluation, /ModLudus OpenRouter 共享快照/);
  assert.match(evaluation, /按实际 Token 用量估算/);
  assert.doesNotMatch(evaluation, /fetch\('https:\/\/openrouter\.ai\/api\/v1\/models'\)/);
});

test('home hero uses the compact desktop type scale', () => {
  assert.match(css, /\.home-hero-v2 h1\s*\{[^}]*font-size:\s*42px[^}]*letter-spacing:\s*0/);
  assert.match(css, /\.product-page \.page-heading h1,[\s\S]*?font-size:\s*32px[^}]*letter-spacing:\s*0/);
  assert.match(css, /\.evaluation-title-line h1\s*\{[^}]*font-size:\s*22px/);
  assert.doesNotMatch(css, /\.home-hero-v2 h1\s*\{[^}]*font-size:\s*clamp/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.product-page \.page-heading h1,[\s\S]*?font-size:\s*28px/);
  assert.match(css, /\.brand-mark\s*\{[^}]*border-radius:\s*50%[^}]*background:\s*linear-gradient/);
  assert.match(css, /\.brand-mark\s*\{[^}]*border:\s*0[^}]*color:\s*#f7ffff[^}]*text-shadow:/);
  assert.doesNotMatch(css, /\.brand-mark\s*\{[^}]*box-shadow:[^}]*inset/);
  assert.doesNotMatch(css, /\.ladder-presets button\.active,\s*\.brand-mark/);
  assert.equal((shell.match(/className="mark-stroke/g) ?? []).length, 4);
  assert.match(shell, /className="stroke-two-tip"[^>]*d="M13\.45 18\.55L15\.3 17\.32L16\.05 20\.15Z"/);
  assert.match(css, /\.stroke-one[^}]*url\(#mark-first-gradient\)[\s\S]*\.stroke-two[^}]*#ffffff[\s\S]*\.stroke-three[^}]*url\(#mark-third-gradient\)[\s\S]*\.stroke-four[^}]*#c9cdd5/);
  assert.match(shell, /id="mark-first-gradient"[\s\S]*offset="0"[^>]*stopOpacity="\.42"[\s\S]*offset="\.55"[^>]*stopOpacity="\.7"/);
  assert.match(shell, /id="mark-third-gradient"[\s\S]*offset="\.2"[^>]*stopOpacity="0"[\s\S]*offset="\.58"[^>]*stopOpacity="\.22"/);
  assert.match(css, /\.mark-stroke[^}]*stroke-linecap:\s*square[^}]*stroke-linejoin:\s*miter[^}]*animation:\s*mark-draw\s+\.55s/);
  assert.match(css, /\.stroke-two[^}]*animation-delay:\s*\.35s[\s\S]*\.stroke-three[^}]*animation-delay:\s*\.7s[\s\S]*\.stroke-four[^}]*animation-delay:\s*1\.05s/);
  assert.match(css, /@keyframes mark-draw-one[\s\S]*5%\s*\{\s*opacity:\s*\.48/);
  assert.match(css, /@keyframes mark-draw-three[\s\S]*20%\s*\{\s*opacity:\s*0/);
  assert.match(css, /\.stroke-two-tip[^}]*animation:\s*mark-tip-in\s+\.16s[^}]*\.82s/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.brand-mark \.mark-stroke[^}]*animation:\s*none/);
  assert.equal((icon.match(/<path d=/g) ?? []).length, 4);
});

test('home hero uses the concise model-evaluation copy', () => {
  assert.match(home, /<h1>模型测评<br \/><em>让模型直接比一场。<\/em><\/h1>/);
  assert.match(home, /同一道真实任务，多模型匿名并行生成，独立评审出可追溯的选型结论。/);
  assert.doesNotMatch(home, /比较质量、成本与速度/);
  assert.doesNotMatch(home, /不需要先研究 Rubric 或模型参数。选择场景后，ModLudus 会填入一道可直接运行的示例。/);
});

test('evaluation workflow headings share a fixed desktop baseline', () => {
  assert.match(css, /\.wizard-sidebar-title,\s*\.evaluation-page \.wizard-title\s*\{[^}]*height:\s*46px[^}]*min-height:\s*46px[^}]*margin:\s*0 0 10px/s);
  assert.match(css, /\.wizard-sidebar-title \.sidebar-kicker,\s*\.evaluation-page \.wizard-title \.section-kicker\s*\{[^}]*font-size:\s*11px[^}]*line-height:\s*1\.2/s);
  assert.match(css, /\.wizard-sidebar-title strong\s*\{[^}]*font-size:\s*16px/);
  assert.match(css, /\.evaluation-page \.wizard-title h2\s*\{[^}]*font-size:\s*18px/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.evaluation-page \.wizard-title\s*\{\s*height:\s*auto;\s*min-height:\s*0;/);
  assert.match(css, /\.evaluation-page \.wizard-layout\s*\{[^}]*min-height:\s*calc\(100dvh - 165px\)[^}]*align-items:\s*stretch/s);
  assert.match(css, /\.evaluation-page \.connections\s*\{[^}]*overflow:\s*visible/s);
  assert.doesNotMatch(css, /\.evaluation-page \.connections\s*\{[^}]*overflow-y:\s*auto/s);
});
