import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PIN = process.env.MDR_ADMIN_PIN || '7264';
const TARGET = process.env.MDR_TEST_ORIGIN || 'http://127.0.0.1:9881';
const USE_LOCAL = TARGET.includes('127.0.0.1') || TARGET.includes('localhost');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let server;
if (USE_LOCAL) {
  const PUBLIC = join(import.meta.dirname, '..', 'public');
  server = createServer((req, res) => {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/admin/index.html';
    const parts = path.replace(/^\//, '').split('/').filter(Boolean);
    const fp = join(PUBLIC, ...parts);
    if (!existsSync(fp)) {
      res.writeHead(404);
      res.end('404 ' + req.url);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(readFileSync(fp));
  });
  await new Promise((r) => server.listen(9881, r));
}

const PIN_BTNS = PIN.split('').map((d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const loginStart = Date.now();
await page.goto(`${TARGET}/admin/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
for (const digit of PIN_BTNS) {
  await page.locator('.num-btn', { hasText: digit }).click();
}
await page.waitForURL('**/admin/madrasa.html', { timeout: 90000 });
const loginMs = Date.now() - loginStart;

await page.waitForFunction(() => document.documentElement.classList.contains('mm-app-ready'), null, { timeout: 120000 });
const madrasaReadyMs = Date.now() - loginStart;

const recentStart = Date.now();
await page.locator('a.main-nav-btn[href="/admin/recent.html"]').click();
await page.waitForURL('**/admin/recent.html', { timeout: 30000 });
await page.waitForFunction(() => document.documentElement.classList.contains('mm-app-ready'), null, { timeout: 120000 });
const recentOverlayMs = Date.now() - recentStart;

await page.waitForSelector('#recent-feed .recent-item, #recent-feed .recent-empty', { timeout: 30000 });
const recentFeedMs = Date.now() - recentStart;

const result = await page.evaluate(() => ({
  status: document.getElementById('recent-sync-status')?.textContent || '',
  feedPreview: (document.getElementById('recent-feed')?.innerHTML || '').slice(0, 200),
  itemCount: document.querySelectorAll('#recent-feed .recent-item').length,
  isAdmin: window.MMSession?.isAdmin?.(),
}));

console.log(JSON.stringify({
  target: TARGET,
  loginMs,
  madrasaReadyMs,
  recentOverlayMs,
  recentFeedMs,
  pass: recentOverlayMs < 5000,
  ...result,
}, null, 2));

await browser.close();
if (server) server.close();
