'use client';

import { useEffect, useState } from 'react';

const sections = [
  ['selection', '真实任务选型'],
  ['scenarios', '业务场景'],
  ['modes', '评测方式'],
] as const;

export default function HomeSectionNav() {
  const [active, setActive] = useState('selection');

  useEffect(() => {
    const elements = sections.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActive(visible.target.id);
    }, { rootMargin: '-18% 0px -58% 0px', threshold: [0, .2, .5, .8] });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return <nav className="home-anchor-nav" aria-label="首页分段导航">
    {sections.map(([id, label]) => <a key={id} href={`#${id}`} aria-label={`跳转到${label}`} aria-current={active === id ? 'location' : undefined} className={active === id ? 'active' : ''}><i aria-hidden="true" /><span>{label}</span></a>)}
  </nav>;
}
