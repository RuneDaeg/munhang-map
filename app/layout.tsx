import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '문항맵 · 성취기준 분류 작업실',
  description: '모의고사 PDF를 문항별로 문서화하고 교육과정 성취기준에 맞춰 분류합니다.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
