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
  assert.match(evaluation, /单次对比用于快速判断，批量评测即将上线。/);
  assert.doesNotMatch(evaluation, /● 当前浏览器隐私模式|Key、任务和答案默认不离开浏览器/);
  assert.match(evaluation, /<strong>🔒 浏览器隐私模式<\/strong>/);
  assert.match(evaluation, /模型编排、评分汇总、结果渲染，全程在您的浏览器本地完成，全程仅加密直连模型厂商/);
  assert.match(evaluation, /建议使用测试专用 Key/);
  assert.match(evaluation, /凭据仅在当前页面内存中用于直连请求，刷新后清空/);
  assert.match(css, /\.credential-safety-note\s*\{/);
  assert.match(communityMetrics, /NEXT_PUBLIC_ENABLE_ANONYMOUS_CONTRIBUTIONS === 'true'/);
  assert.match(communityMetrics, /if \(!anonymousContributionsEnabled\) return false/);
});

test('batch evaluation is marked coming soon while quick evaluation remains usable', () => {
  assert.match(evaluation, /批量评测 <small>即将上线<\/small>/);
  assert.match(evaluation, /className="mode-coming-soon" disabled/);
  assert.doesNotMatch(evaluation, /import BatchLab/);
  assert.doesNotMatch(evaluation, /setEvaluationMode\('batch'\)/);
  assert.match(home, /coming-soon-label">即将上线/);
});

test('quick evaluation supports searchable models and expandable long answers', () => {
  assert.match(evaluation, /搜索发现的模型/);
  assert.match(evaluation, /slice\(0, 50\)/);
  assert.match(evaluation, /已选 \{selectedModels\.length\} 个/);
  assert.match(evaluation, /展开完整答案/);
  assert.match(css, /\.model-picker-list\s*\{[^}]*max-height:/s);
  assert.match(css, /\.result-card pre\.expanded\s*\{[^}]*max-height:\s*none/s);
});

test('quick evaluation makes long-running work visible, bounded, and cancellable', () => {
  assert.match(evaluation, /● 运行中 · \$\{runSeconds\} 秒/);
  assert.match(evaluation, /候选生成 \$\{completedCandidates\}\/\$\{candidateCount\}/);
  assert.match(evaluation, /单个调用超过 120 秒会自动超时/);
  assert.match(evaluation, /取消评测/);
  assert.match(css, /\.running-status\s*\{/);
  assert.match(css, /\.run-button\.running:disabled/);
  assert.match(css, /@keyframes run-spin/);
});

test('model calls omit temperature for providers that reject the parameter', () => {
  assert.match(evaluation, /Claude Opus 5/);
  assert.match(evaluation, /JSON\.stringify\(\{ model, messages: \[\{ role: 'user', content \}\] \}\)/);
  assert.doesNotMatch(evaluation, /JSON\.stringify\(\{ model, messages: \[\{ role: 'user', content \}\], temperature \}\)/);
  assert.match(evaluation, /providerMessage = typeof parsed\.error === 'string'/);
});

test('evaluation reuses the backend OpenRouter price snapshot', () => {
  assert.match(evaluation, /fetch\(`\$\{apiBase\}\/api\/v1\/ladder`, \{ cache: 'no-store' \}\)/);
  assert.match(evaluation, /ModLudus OpenRouter 共享快照/);
  assert.match(evaluation, /运行时估算/);
  assert.doesNotMatch(evaluation, /fetch\('https:\/\/openrouter\.ai\/api\/v1\/models'\)/);
});

test('home hero uses the compact desktop type scale', () => {
  assert.match(css, /\.home-hero h1\s*\{[^}]*font-size:\s*clamp\(50px,6vw,74px\)/);
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
