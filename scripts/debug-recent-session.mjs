import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const ORIGIN = 'http://127.0.0.1:9880';
const PORT = 9880;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer((req, res) => {
  const parts = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '').split('/').filter(Boolean);
  const fp = join(PUBLIC, ...parts);
  if (!existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(PORT, r));

const storageState = {
  cookies: [],
  origins: [{
    origin: ORIGIN,
    localStorage: [],
    sessionStorage: [
      { name: 'mm_role', value: 'admin' },
      { name: 'mm_admin_user_id', value: '00000000-0000-4000-8000-000000000099' },
      { name: 'mm_admin_pin', value: '1234' },
      { name: 'mm_name', value: 'Test Admin' },
      { name: 'mm_data_cache_meta', value: JSON.stringify({ v: 1, actor: 'admin:00000000-0000-4000-8000-000000000099:1234', admin_madrasa_boot: true }) },
      { name: 'mm_sc_mm_students', value: JSON.stringify([{ id: 's1', name: 'T', class_id: 'c1', active: true }]) },
      { name: 'mm_sc_mm_classes', value: JSON.stringify([{ id: 'c1', name: 'C', dept: 'kitab' }]) },
      { name: 'mm_sc_mm_logs', value: JSON.stringify([{ id: 'log1', type: 'class', ref_id: 'c1', text: 'cached log', date: '2026-07-04', by: 'T', tag: 'normal' }]) },
    ],
  }],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.goto(`${ORIGIN}/admin/recent.html`, { waitUntil: 'load', timeout: 20000 });
console.log(await page.evaluate(() => ({
  path: location.pathname,
  isAdmin: MMSession.isAdmin(),
  canRecent: MMSession.canAdmin('recent'),
  cls: document.documentElement.className,
  status: document.getElementById('recent-sync-status')?.textContent,
  feed: document.getElementById('recent-feed')?.innerHTML?.slice(0, 150),
})));
await browser.close();
server.close();
