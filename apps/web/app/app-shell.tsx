'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navigation = [
  { href: '/', label: '首页' },
  { href: '/evaluations', label: '模型评测' },
  { href: '/ladder', label: '模型天梯' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <>
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" aria-label="ModLudus 首页" className="brand app-brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 30 30"><defs><linearGradient id="mark-first-gradient" x1="7" y1="23" x2="7" y2="7" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity=".42" /><stop offset=".05" stopColor="#fff" stopOpacity=".48" /><stop offset=".55" stopColor="#fff" stopOpacity=".7" /><stop offset=".8" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" /></linearGradient><linearGradient id="mark-third-gradient" x1="15" y1="19" x2="23" y2="7" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".2" stopColor="#fff" stopOpacity="0" /><stop offset=".58" stopColor="#fff" stopOpacity=".22" /><stop offset=".78" stopColor="#fff" stopOpacity=".62" /><stop offset="1" stopColor="#fff" /></linearGradient></defs><line className="mark-stroke stroke-one" x1="7" y1="23" x2="7" y2="7" /><line className="mark-stroke stroke-two" x1="7" y1="7" x2="15" y2="19" /><path className="stroke-two-tip" d="M13.45 18.55L15.3 17.32L16.05 20.15Z" /><line className="mark-stroke stroke-three" x1="15" y1="19" x2="23" y2="7" /><line className="mark-stroke stroke-four" x1="23" y1="7" x2="23" y2="23" /></svg></span><span>ModLudus</span></Link>
        <nav className="app-navigation" aria-label="主要导航">
          {navigation.map((item) => { const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)); return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''}>{item.label}</Link>; })}
        </nav>
        <div className="app-tools"><span className="privacy-status"><i />隐私模式 · 不存 Key 与任务</span></div>
      </div>
    </header>
    {children}
  </>;
}
