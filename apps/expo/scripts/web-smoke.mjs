// apps/expo/scripts/web-smoke.mjs
// Boots the static web export (dist/) in headless Chromium WITHOUT a local
// server: request interception serves files from disk, so it runs inside
// sandboxes that block port binding. Exit 0 = boot OK (no page errors, body
// rendered). Screenshot lands in .expo/web-smoke.png.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOT = path.join(ROOT, '.expo', 'web-smoke.png');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html missing — run `pnpm export:web` first.');
  process.exit(2);
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') {
    // Real external calls (Supabase, thirdweb, RPC) proceed normally.
    try { await route.continue(); } catch { /* page closed */ }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    await route.fulfill({ status: 200, contentType: MIME[ext] || 'application/octet-stream', body: fs.readFileSync(file) });
  } else {
    // SPA fallback
    await route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(DIST, 'index.html')) });
  }
});

await page.goto('http://app.local/', { waitUntil: 'load', timeout: 30_000 });
await page.waitForTimeout(20_000);
const text = (await page.evaluate(() => document.body.innerText || '')).trim();
fs.mkdirSync(path.dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
await browser.close();

const unique = [...new Set(errors)];
console.log(`body text: ${text ? text.slice(0, 200).replace(/\n/g, ' | ') : '(EMPTY)'}`);
console.log(`page errors (${unique.length}):`);
console.log(unique.slice(0, 10).join('\n---\n'));
if (unique.length > 0 || !text) {
  console.error('\nSMOKE FAIL');
  process.exit(1);
}
console.log('\nSMOKE PASS');
