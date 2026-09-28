import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TIME — 金融人生模擬器',
  description: 'A financial life simulator game exploring liquidity, risk, and long-term asset allocation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
