import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const ORIGIN = 'http://127.0.0.1:9882';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer((req, res) => {
  const parts = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '').split('/').filter(Boolean);
  const fp = join(PUBLIC, ...parts);
  if (!existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(9882, r));

const storageState = {
  origins: [{
    origin: ORIGIN,
    localStorage: [],
    sessionStorage: [
      { name: 'mm_role', value: 'admin' },
      { name: 'mm_admin_user_id', value: '00000000-0000-4000-8000-000000000099' },
      { name: 'mm_admin_pin', value: '1234' },
      { name: 'mm_name', value: 'Test Admin' },
    ],
  }],
};

function snap(page, label) {
  return page.evaluate((label) => ({
    label,
    path: location.pathname,
    referrer: document.referrer,
    role: sessionStorage.getItem('mm_role'),
    isAdmin: window.MMSession?.isAdmin?.(),
  }), label);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState });
const page = await context.newPage();
await page.route('**/rest/v1/rpc/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, students: [], classes: [], logs: [] }) });
});

console.log('start storageState ok');

await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
console.log('after index', await snap(page, 'index'));

await page.goto(`${ORIGIN}/admin/madrasa.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
console.log('after madrasa', await snap(page, 'madrasa'));

await page.goto(`${ORIGIN}/admin/recent.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
console.log('after recent', await snap(page, 'recent'));

await browser.close();
server.close();
