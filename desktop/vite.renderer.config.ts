import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(desktopDir);

export default defineConfig({
  root: path.join(desktopDir, 'renderer'),
  base: './',
  publicDir: path.join(projectDir, 'public'),
  resolve: {
    alias: {
      '@': projectDir,
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  plugins: [react()],
  build: {
    outDir: path.join(desktopDir, 'renderer-dist'),
    emptyOutDir: true,
  },
});
