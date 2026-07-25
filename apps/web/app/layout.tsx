import type { Metadata } from 'next';
import './globals.css';
import AppShell from './app-shell';

export const metadata: Metadata = {
  title: 'ModLudus · 多模型竞技与智能选型',
  description: '基于真实业务任务的多模型竞技与智能选型平台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
