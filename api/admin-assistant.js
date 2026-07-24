'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const MAX_HISTORY = 8;
const MAX_TOOL_ROUNDS = 6;

// Plain Vercel projects do not always auto-load .env.local during `vercel dev`.
// Load it only when present; production continues to use Vercel environment vars.
try {
  const localEnv = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  localEnv.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
} catch (_error) {}

function send(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function requestJson(url, options, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (_error) { data = { raw }; }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Upstream request timed out')));
    req.on('error', reject);
    if (payload !== undefined) req.write(JSON.stringify(payload));
    req.end();
  });
}

async function rpc(name, body) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase server configuration is missing');
  const response = await requestJson(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }, body);
  if (!response.ok) throw new Error(response.data?.message || 'Database request failed');
  return response.data;
}

async function gemini(contents, catalog) {
  const key = process.env.GEMINI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const dhakaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  if (!key) throw new Error('Gemini API key is missing');
  const response = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    timeout: 45000,
  }, {
      systemInstruction: { parts: [{ text:
        'আপনি মাদ্রাসাতুল মদীনার জিম্মাদার AI সহকারী। কেবল প্রদত্ত database tool-এর live ফলাফলের ভিত্তিতে বাংলায় সংক্ষিপ্ত ও নির্ভুল উত্তর দিন। ' +
        `কোনো তথ্য অনুমান করবেন না। প্রশ্নের জন্য প্রয়োজনীয় এক বা একাধিক query_database call করুন। আজকের বাংলাদেশ তারিখ ${dhakaToday}। ` +
        'প্রশ্নের সঙ্গে প্রাসঙ্গিক mdr_ai_ reporting table থাকলে raw table-এর আগে সেটিই ব্যবহার করুন। ' +
        'ফল না থাকলে স্পষ্ট বলুন। একই entity-এর নাম ও ID মেলাতে প্রয়োজনে আলাদা table query করুন। Database catalog:\n' + JSON.stringify(catalog)
      }] },
      contents,
      tools: [{ functionDeclarations: [{
        name: 'query_database',
        description: 'Read live data from one allowed database table. Call repeatedly to combine related information.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table: { type: 'STRING' },
            columns: { type: 'ARRAY', items: { type: 'STRING' } },
            filters: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              column: { type: 'STRING' }, operator: { type: 'STRING', enum: ['eq','neq','gt','gte','lt','lte','ilike','in','not_in','is_null','not_null'] }, value: { type: 'STRING' }, values: { type: 'ARRAY', items: { type: 'STRING' } }
            }, required: ['column','operator'] } },
            group_by: { type: 'ARRAY', items: { type: 'STRING' } },
            aggregates: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              function: { type: 'STRING', enum: ['count','sum','avg','min','max'] }, column: { type: 'STRING' }, alias: { type: 'STRING' }
            }, required: ['function','column','alias'] } },
            order: { type: 'OBJECT', properties: { column: { type: 'STRING' }, direction: { type: 'STRING', enum: ['asc','desc'] } }, required: ['column','direction'] },
            limit: { type: 'INTEGER' }
          }, required: ['table']
        }
      }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
    }
  );
  if (!response.ok) throw new Error(response.data?.error?.message || 'Gemini request failed');
  return response.data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const actorId = body.actorId || null;
    const pin = String(body.pin || '');
    const message = String(body.message || '').trim().slice(0, 1200);
    if (!pin || !message) return send(res, 400, { ok: false, error: 'missing_required' });

    const catalogResult = await rpc('mdr_rel_admin_ai_query', {
      p_actor_id: actorId, p_pin: pin, p_request: { action: 'catalog' }
    });
    if (!catalogResult?.ok) return send(res, 401, { ok: false, error: 'unauthorized' });

    const prior = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
    const contents = prior.filter(x => x && ['user','model'].includes(x.role) && typeof x.text === 'string')
      .map(x => ({ role: x.role, parts: [{ text: x.text.slice(0, 2000) }] }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await gemini(contents, catalogResult.tables || []);
      const content = result?.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        console.error('[admin-assistant] empty Gemini candidate', JSON.stringify({
          finishReason: result?.candidates?.[0]?.finishReason,
          finishMessage: result?.candidates?.[0]?.finishMessage,
          promptFeedback: result?.promptFeedback,
        }));
        throw new Error('Gemini returned no answer');
      }
      const calls = content.parts.filter(part => part.functionCall?.name === 'query_database');
      if (!calls.length) {
        const answer = content.parts.map(part => part.text || '').join('').trim();
        return send(res, 200, { ok: true, answer, generatedAt: new Date().toISOString() });
      }
      contents.push(content);
      const responseParts = [];
      for (const call of calls.slice(0, 4)) {
        const args = call.functionCall.args || {};
        const queryResult = await rpc('mdr_rel_admin_ai_query', {
          p_actor_id: actorId, p_pin: pin, p_request: { action: 'query', ...args }
        });
        responseParts.push({ functionResponse: { name: 'query_database', response: queryResult } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }
    return send(res, 422, { ok: false, error: 'too_many_database_queries' });
  } catch (error) {
    console.error('[admin-assistant]', error?.message || error);
    return send(res, 500, { ok: false, error: 'assistant_unavailable', message: error?.message || 'Unknown error' });
  }
};
