import TrustedSeason from '../trusted-season';

export default function AdminPage() {
  return <main className="product-page admin-page"><section className="page-heading compact-heading"><div><span className="eyebrow">标准评测管理</span><h1>标准评测控制台</h1><p>固定规则评测、人工复核和榜单发布。管理员令牌只保存在当前页面内存。</p></div><span className="admin-badge">受保护入口</span></section><TrustedSeason /></main>;
}
