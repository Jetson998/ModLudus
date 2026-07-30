import Link from 'next/link';

const scenarios = [
  { label: '文案生成', hint: '小红书模型测评文案', mark: '✦', tone: 'violet' },
  { label: '代码生成', hint: '武士拔刀动效网页', mark: '</>', tone: 'blue' },
  { label: '内容总结', hint: '政府公告摘要', mark: '≡', tone: 'sand' },
  { label: '数据分析', hint: '经营数据分析', mark: '∿', tone: 'mint' },
];

export default function Home() {
  return <main className="product-page home-page home-page-v2">
    <section id="selection" className="home-hero-v2">
      <div className="home-hero-copy">
        <span className="home-pill"><i /> 基于真实业务任务</span>
        <h1>别再猜哪个模型更好。<br /><em>让它们直接比一场。</em></h1>
        <p>同一道真实任务，多模型匿名并行生成，独立评审比较质量、成本与速度，最后给出可追溯的选型结论。</p>
        <div className="hero-actions"><Link href="/evaluations" className="primary-button">开始一次真实评测 <span>→</span></Link><Link href="/ladder" className="home-secondary-link">先看模型天梯 <span>↗</span></Link></div>
        <div className="home-proof-row"><span><strong>2–6</strong>候选模型</span><span><strong>1</strong>独立自动评审</span><span><strong>0</strong>敏感数据留存</span></div><span className="sr-only">继续浏览</span>
      </div>

      <aside className="home-arena-preview" aria-label="ModLudus 评测结果预览">
        <div className="preview-top"><div><i /> 真实任务竞技</div><span>匿名比较</span></div>
        <div className="preview-task"><small>任务</small><strong>为 AI 产品生成一篇小红书测评文案</strong><span>文案生成 · 单轮文本</span></div>
        <div className="preview-model-list">
          <article><div><b>A</b><span><strong>模型 A</strong><small>质量得分</small></span></div><em>86</em></article>
          <article className="preview-winner"><div><b>B</b><span><strong>模型 B</strong><small>质量得分</small></span></div><em>94</em></article>
          <article><div><b>C</b><span><strong>模型 C</strong><small>质量得分</small></span></div><em>81</em></article>
        </div>
        <div className="preview-recommendation"><div><small>本次综合推荐</small><strong>模型 B</strong></div><p>质量领先，成本与速度仍在可接受范围。</p><span>置信度 87%</span></div>
      </aside>
    </section>

    <section className="home-trust-strip" aria-label="浏览器隐私模式：全程浏览器本地评分，API Key、测评任务仅直连模型厂商 API，不经任何三方服务器、不做任何留存"><div><span className="trust-icon">◇</span><p><strong>Key 只在当前页面使用</strong><small>不上传、不入库</small></p></div><div><span className="trust-icon">◎</span><p><strong>任务与答案不留存</strong><small>刷新页面即清空</small></p></div><div><span className="trust-icon">↗</span><p><strong>浏览器直连模型网关</strong><small>ModLudus 不中转你的业务内容</small></p></div></section>

    <section id="scenarios" className="home-section-v2 home-scenarios-v2">
      <div className="home-section-heading-v2"><div><span>从这里开始</span><h2>选一道你真的会用到的题</h2></div><p>不需要先研究 Rubric 或模型参数。选择场景后，ModLudus 会填入一道可直接运行的示例。</p></div>
      <div className="home-scenario-bento">{scenarios.map((item, index) => <Link className={`home-scenario-v2 ${item.tone}`} href={`/evaluations?scenario=${encodeURIComponent(item.label)}&example=1`} key={item.label}><span className="scenario-mark">{item.mark}</span><span className="scenario-index">0{index + 1}</span><div><strong>{item.label}</strong><p>{item.hint}</p></div><em>使用示例 <span>→</span></em></Link>)}</div>
    </section>

    <section id="modes" className="home-section-v2 home-paths-v2">
      <div className="home-section-heading-v2"><div><span>按你的目标选择</span><h2>快速判断，或者系统选型</h2></div></div>
      <div className="home-path-grid">
        <article className="home-path-featured"><span className="path-number">01</span><div><small>适合第一次使用</small><h3>单次对比</h3><p>一道真实任务，并行比较 2–6 个模型，几分钟得到质量、成本和速度结论。</p><Link href="/evaluations">开始单次对比 <span>→</span></Link></div><div className="path-comparison-preview"><small>3 个模型对比</small><strong>模型 B 胜出</strong><div className="comparison-row"><b>A</b><i><u /></i><em>86</em></div><div className="comparison-row winner"><b>B</b><i><u /></i><em>94</em></div><div className="comparison-row"><b>C</b><i><u /></i><em>81</em></div></div></article>
        <article className="home-path-card"><span className="path-number">02</span><small>适合正式选型</small><h3>批量评测</h3><p>导入真实测试集，按业务类型统计、抽检、复核并导出报告。</p><span className="coming-soon-label">即将上线</span></article>
        <article className="home-path-card ladder-path"><span className="path-number">03</span><small>适合发现模型</small><h3>模型天梯</h3><p>分开查看市场基线与 ModLudus 真实任务证据，不用模糊综合分混在一起。</p><Link href="/ladder">查看模型天梯 <span>→</span></Link></article>
      </div>
    </section>
  </main>;
}
