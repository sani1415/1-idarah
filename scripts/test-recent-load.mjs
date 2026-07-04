import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const ORIGIN = 'http://127.0.0.1:9881';
const PORT = 9881;
const SLOW_RPC_MS = 4000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const parts = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\//, '').split('/').filter(Boolean);
  const fp = join(PUBLIC, ...parts);
  if (!existsSync(fp)) { res.writeHead(404); res.end('404 ' + req.url); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise((r) => server.listen(PORT, r));

async function bootContext(playwright) {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    sessionStorage.setItem('mm_role', 'admin');
    sessionStorage.setItem('mm_admin_user_id', '00000000-0000-4000-8000-000000000099');
    sessionStorage.setItem('mm_admin_pin', '1234');
    sessionStorage.setItem('mm_name', 'Test Admin');
    sessionStorage.setItem('mm_data_cache_meta', JSON.stringify({ v: 1, actor: 'admin:00000000-0000-4000-8000-000000000099:1234', admin_madrasa_boot: true }));
    sessionStorage.setItem('mm_sc_mm_students', JSON.stringify([{ id: 's1', name: 'T', class_id: 'c1', active: true }]));
    sessionStorage.setItem('mm_sc_mm_classes', JSON.stringify([{ id: 'c1', name: 'C', dept: 'kitab' }]));
    sessionStorage.setItem('mm_sc_mm_logs', JSON.stringify([{ id: 'log1', type: 'class', ref_id: 'c1', text: 'cached log', date: '2026-07-04', by: 'T', tag: 'normal' }]));
  });
  const page = await context.newPage();
  await page.route('**/rest/v1/rpc/**', async (route) => {
    await new Promise((r) => setTimeout(r, SLOW_RPC_MS));
    const name = route.request().url().split('/rpc/')[1] || '';
    let body = { ok: true };
    if (name.includes('admin_madrasa_bootstrap') || name.includes('admin_users')) {
      body = { ok: true, students: [], classes: [], logs: [], users: [] };
    } else if (name.includes('admin_departments') || name.includes('dept_bootstrap')) {
      body = { ok: true, departments: [], products: [], inventory: [], transactions: [], edit_requests: [], extra_fields: [], settings: {} };
    } else if (name.includes('programs_bootstrap')) {
      body = { ok: true, programs: [], income: {}, expense: {} };
    } else if (name.includes('khedmat_bootstrap')) {
      body = { ok: true, beneficiaries: [], activities: [], activity_types: [], daily_logs: [], finance: [] };
    } else if (name.includes('chat_bootstrap')) {
      body = { ok: true, messages: [] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  // Same-origin chain so clearStaleSessionOnFreshEntry keeps session (referer header alone is not enough).
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${ORIGIN}/admin/madrasa.html`, { waitUntil: 'commit' });
  return { browser, context, page };
}

async function measureRecentOpen(page) {
  page.on('pageerror', (e) => console.error('PAGEERR:', e.message));
  const t0 = Date.now();
  await page.goto(`${ORIGIN}/admin/recent.html`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.documentElement.classList.contains('mm-app-ready'), null, { timeout: 8000 });
  } catch (e) {
    const snap = await page.evaluate(() => ({
      path: location.pathname,
      cls: document.documentElement.className,
      overlayHidden: !document.getElementById('mm-app-load-screen') || document.getElementById('mm-app-load-screen').classList.contains('is-hidden'),
      status: document.getElementById('recent-sync-status')?.textContent,
      feed: document.getElementById('recent-feed')?.innerHTML?.slice(0, 120),
      isAdmin: window.MMSession?.isAdmin?.(),
    }));
    console.error('SNAP', snap);
    throw e;
  }
  const overlayMs = Date.now() - t0;
  await page.waitForSelector('#recent-feed .recent-item, #recent-feed .recent-empty', { timeout: 5000 });
  const feedMs = Date.now() - t0;
  const feedHtml = await page.locator('#recent-feed').innerHTML();
  return { overlayMs, feedMs, hasCachedLog: feedHtml.includes('cached log') };
}

const playwright = await import('playwright');

// NEW (local working tree)
const live = await bootContext(playwright);
const newMetrics = await measureRecentOpen(live.page);
await live.browser.close();

// OLD (committed HEAD) — checkout files temporarily via reading from git not practical; compare behavior description only

console.log(JSON.stringify({ scenario: 'in-app-nav with warm cache + 4s RPC mock', newMetrics, pass: newMetrics.overlayMs < 2500 && newMetrics.feedMs < 2500 && newMetrics.hasCachedLog }, null, 2));
server.close();
