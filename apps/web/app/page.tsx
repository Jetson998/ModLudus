import Link from 'next/link';
import HomeSectionNav from './home-section-nav';

const scenarios = [
  ['文案生成', '小红书模型测评文案'],
  ['代码生成', '武士拔刀动效网页'],
  ['内容总结', '政府公告摘要'],
  ['数据分析', '经营数据分析'],
];

export default function Home() {
  return <main className="product-page home-page">
    <HomeSectionNav />
    <section id="selection" className="home-hero"><div className="home-main"><span className="eyebrow">真实任务选型</span><h1>用真实任务，<br /><em>选出更适合的模型。</em></h1><p>让多个模型完成同一道业务任务，自动比较质量、成本、速度与稳定性，再给出有证据的选型建议。</p><div className="hero-actions"><Link href="/evaluations" className="primary-button">立即开始模型评测 <span>→</span></Link><Link href="/ladder" className="text-link">浏览模型天梯</Link></div><a className="continue-browsing" href="#scenarios">继续浏览 <span aria-hidden="true">↓</span></a></div><aside className="home-privacy"><strong>浏览器隐私模式</strong><p>全程浏览器本地评分，API Key、测评任务仅直连模型厂商 API，不经任何三方服务器、不做任何留存。</p></aside></section>
    <section id="scenarios" className="home-section"><div className="section-heading"><div><span className="section-kicker">业务场景</span><h2>从一个真实场景开始</h2></div></div><div className="home-scenario-grid">{scenarios.map(([label, hint]) => <Link href={`/evaluations?scenario=${encodeURIComponent(label)}&example=1`} key={label}><strong>{label}</strong><span>{hint}</span><em>开始评测 →</em></Link>)}</div></section>
    <section id="modes" className="home-section mode-cards"><article><span>01</span><h3>单次对比</h3><p>用一道任务快速比较 2–6 个模型，适合第一次使用。</p><Link href="/evaluations">开始单次对比</Link></article><article className="coming-soon-card"><span>02</span><h3>批量评测</h3><p>导入真实测试集，完成分类统计、抽检、复核和报告导出。</p><strong className="coming-soon-label">即将上线</strong></article><article><span>03</span><h3>模型天梯</h3><p>结合市场基线与 ModLudus 实测，按质量、成本和速度选型。</p><Link href="/ladder">查看模型天梯</Link></article></section>
  </main>;
}
