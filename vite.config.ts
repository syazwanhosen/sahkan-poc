import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { myinvoisApi } from './server/plugin';

// jsPDF pulls these in for HTML rendering, which the demo never uses.
const stub = fileURLToPath(new URL('./src/lib/empty.ts', import.meta.url));

export default defineConfig(({ mode }) => ({
  base: './',
  // MYINVOIS_* settings stay on the server: only VITE_* variables ever reach the browser.
  plugins: [react(), viteSingleFile(), myinvoisApi(loadEnv(mode, process.cwd(), 'MYINVOIS_'))],
  resolve: { alias: { html2canvas: stub, dompurify: stub, canvg: stub } },
  build: { target: 'es2020', cssCodeSplit: false, chunkSizeWarningLimit: 4000 },
}));
