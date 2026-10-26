import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// jsPDF pulls these in for HTML rendering, which the demo never uses.
const stub = fileURLToPath(new URL('./src/lib/empty.ts', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { html2canvas: stub, dompurify: stub, canvg: stub } },
  build: { target: 'es2020', cssCodeSplit: false, chunkSizeWarningLimit: 4000 },
});
