// Turns the single-file Vite build (dist/index.html) into the page shape a
// claude.ai artifact expects: title first, then styles, the root and one inline script.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
// The bundle escapes "</script" in its own strings, so the first literal </script> ends it.
const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const rest = html.replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, '');
const styles = [...rest.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
if (styles.length !== 1 || scripts.length !== 1) {
  throw new Error(`Expected one inline style and one inline script, found ${styles.length} and ${scripts.length}.`);
}

// Keep the HTML parser from ending or re-entering the script early.
const js = scripts[0].replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--').replace(/<script/gi, '\\x3Cscript');

const page = `<title>Sahkan e-Invoice Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>${styles[0]}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;

writeFileSync('dist/sahkan-demo.html', page);
console.log(`dist/sahkan-demo.html: ${(page.length / 1024).toFixed(0)} KB`);
