import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import '@/app/globals.css';
import Home from '@/app/page';

const root = document.getElementById('root');

if (!root) throw new Error('문항맵 화면을 시작하지 못했습니다.');

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
