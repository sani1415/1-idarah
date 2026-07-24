const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'app'); // deployable frontend source lives under app/
const OUT = path.join(ROOT, 'public');
const ROOT_CONFIG = path.join(SRC, 'supabase-config.js'); // cache lives with app source (also enables Live Server preview of app/)

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

function createBuildVersion() {
  const raw =
    process.env.APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    '';
  if (raw) return raw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
  ].join('');
}

function readExistingConfig() {
  if (!fs.existsSync(ROOT_CONFIG)) return {};
  const text = fs.readFileSync(ROOT_CONFIG, 'utf8');
  const url = text.match(/url:\s*['"]([^'"]*)['"]|["']url["']:\s*["']([^"']*)["']/);
  const publishableKey = text.match(/publishableKey:\s*['"]([^'"]*)['"]|["']publishableKey["']:\s*["']([^"']*)["']/);
  return {
    url: (url && (url[1] || url[2])) || '',
    publishableKey: (publishableKey && (publishableKey[1] || publishableKey[2])) || '',
  };
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

function isVersionedAsset(url) {
  if (!url || /^(?:https?:)?\/\//i.test(url)) return false;
  if (/^(?:data:|mailto:|tel:|#)/i.test(url)) return false;
  const clean = url.split('#')[0].split('?')[0];
  return /\.(?:css|js)$/i.test(clean);
}

function versionAssetUrl(url, version) {
  if (!isVersionedAsset(url)) return url;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  query.set('v', version);
  return base + '?' + query.toString() + hash;
}

function injectAppUpdate(html, relativeRoot, version) {
  if (html.includes('js/core/app-update.js')) return html;
  const src = `${relativeRoot}js/core/app-update.js?v=${encodeURIComponent(version)}`;
  const tag = `<script src="${src}" defer></script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}

function injectInstallPrompt(html, relativeRoot, version) {
  if (html.includes('js/core/mm-install.js')) return html;
  const src = `${relativeRoot}js/core/mm-install.js?v=${encodeURIComponent(version)}`;
  const tag = `<script src="${src}" defer></script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}

function injectBootScript(html, relativeRoot, version) {
  if (!/mm-session\.js/i.test(html) || /mm-boot\.js/i.test(html)) return html;
  const tag = `<script src="${relativeRoot}js/core/mm-boot.js?v=${encodeURIComponent(version)}"></script>`;
  if (/<meta\s+charset=/i.test(html)) {
    return html.replace(/(<meta\s+charset=[^>]+>)/i, `$1\n${tag}`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${tag}`);
  }
  return html;
}

function injectPushScript(html, relativeRoot, version) {
  if (!/mm-session\.js/i.test(html) || /mm-push\.js/i.test(html)) return html;
  const tag = `<script src="${relativeRoot}js/core/mm-push.js?v=${encodeURIComponent(version)}"></script>`;
  return html.replace(/(<script\b[^>]*\bsrc=["'][^"']*mm-session\.js[^"']*["'][^>]*><\/script>)/i, `$1\n${tag}`);
}

function transformHtml(html, relativeRoot, version) {
  let next = html
    .replace(/(<script\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, function (_, before, url, after) {
      return before + versionAssetUrl(url, version) + after;
    })
    .replace(/(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi, function (match, before, url, after) {
      if (!/\brel=["'][^"']*stylesheet/i.test(match)) return match;
      return before + versionAssetUrl(url, version) + after;
    });
  next = injectBootScript(next, relativeRoot, version);
  next = injectPushScript(next, relativeRoot, version);
  next = injectAppUpdate(next, relativeRoot, version);
  return injectInstallPrompt(next, relativeRoot, version);
}

function transformHtmlFile(file, relativeRoot, version) {
  const html = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, transformHtml(html, relativeRoot, version), 'utf8');
}

const existing = readExistingConfig();
const url = process.env.SUPABASE_URL || existing.url || '';
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || existing.publishableKey || '';
const buildVersion = createBuildVersion();

if (!url || !publishableKey) {
  throw new Error(
    'Missing Supabase config. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) before building.'
  );
}

const configJs = `window.MM_SUPABASE_CONFIG = ${JSON.stringify({ url, publishableKey }, null, 2)};\n`;

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

const dirs = ['css', 'js', 'madrasa', 'dept', 'khedmat', 'admin', 'icons'];
for (const d of dirs) {
  copyDir(path.join(SRC, d), path.join(OUT, d));
}

const hisabTemplateName = 'daftar-hisab-template-v2.xlsx';
const hisabTemplate = path.join(SRC, 'madrasa', 'templates', hisabTemplateName);
const hisabTemplateOut = path.join(OUT, 'madrasa', 'templates', hisabTemplateName);
if (!fs.existsSync(hisabTemplate)) {
  throw new Error(
    `Missing app/madrasa/templates/${hisabTemplateName} — run: python scripts/make-hisab-excel-template.py`
  );
}
if (!fs.existsSync(hisabTemplateOut)) {
  throw new Error(`Build copy failed for ${hisabTemplateName}`);
}

try {
  for (const name of fs.readdirSync(SRC)) {
    if (!name.endsWith('.html')) continue;
    const src = path.join(SRC, name);
    if (!fs.statSync(src).isFile()) continue;
    const dest = path.join(OUT, name);
    fs.copyFileSync(src, dest);
    transformHtmlFile(dest, '', buildVersion);
  }
} catch (e) {
  console.warn('[build] skip root html copy:', e.message);
}

function transformDirHtml(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      transformDirHtml(full);
      continue;
    }
    if (!name.endsWith('.html')) continue;
    const depth = path.relative(OUT, full).split(path.sep).length - 1;
    transformHtmlFile(full, '../'.repeat(depth), buildVersion);
  }
}
for (const d of dirs) {
  const dir = path.join(OUT, d);
  if (!fs.existsSync(dir)) continue;
  transformDirHtml(dir);
}

for (const f of ['supabase-config.example.js', 'manifest.webmanifest', 'sw.js']) {
  const src = path.join(SRC, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
}

fs.writeFileSync(path.join(OUT, 'supabase-config.js'), configJs, 'utf8');
fs.writeFileSync(ROOT_CONFIG, configJs, 'utf8');
fs.writeFileSync(
  path.join(OUT, 'app-version.json'),
  JSON.stringify({ version: buildVersion, builtAt: new Date().toISOString() }, null, 2) + '\n',
  'utf8'
);

console.log('Generated supabase-config.js → public/ + repo root');
console.log('Copied static assets →', OUT);
