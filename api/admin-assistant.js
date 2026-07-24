'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const MAX_HISTORY = 8;
// Natural-language questions can require schema discovery, label resolution,
// aggregation and one independent scope check. Keep this bounded, but leave
// enough room for that final verification instead of failing after useful work.
const MAX_TOOL_ROUNDS = 14;

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

function sanitizeAnswer(answer) {
  return String(answer || '')
    .replace(/\s*\(?\s*ID\s*:\s*[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*\)?/gi, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[গোপন আইডি]')
    .trim();
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

async function gemini(contents, schema, allowTools = true) {
  const key = process.env.GEMINI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const dhakaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  if (!key) throw new Error('Gemini API key is missing');
  const payload = {
      systemInstruction: { parts: [{ text:
        'আপনি মাদ্রাসাতুল মদীনার জিম্মাদারের বুদ্ধিমান read-only database analyst। স্বাভাবিক বাংলা, বানানভেদ, বাংলা/আরবি সংখ্যা এবং কথ্য শ্রেণিনাম বুঝুন। ' +
        `আজকের বাংলাদেশ তারিখ ${dhakaToday}। কেবল live database tool-এর ফলের ভিত্তিতে বাংলায় নির্ভুল উত্তর দিন; কোনো সংখ্যা অনুমান করবেন না। ` +
        'প্রথমে schema ও relationships দেখে পরিকল্পনা করুন। প্রয়োজনমতো বহু table join, filter, group, aggregate, rank এবং একাধিক tool call করুন। ' +
        'যেমন “সপ্তম বর্ষ” database-এ “৭ম বর্ষ” হতে পারে—প্রথম exact search ব্যর্থ হলে বিস্তৃত search, code, related table ও বিকল্প বানান চেষ্টা করুন। ' +
        'একটি query খালি বা error হলে পরিকল্পনা সংশোধন করে অন্য query করুন। যথেষ্ট অনুসন্ধান ছাড়া “তথ্য নেই”, “উত্তর পাওয়া যায়নি” বা “পারি না” বলবেন না। ' +
        'ব্যবহারকারী যে শ্রেণি, বিভাগ, ব্যক্তি বা সময়সীমা বলেছেন সেটি final aggregate/ranking query-তে অবশ্যই exact ID/code filter হিসেবে থাকতে হবে; scope বাদ দিয়ে কখনো পুরো table-এর ফলকে উত্তর হিসেবে দেবেন না। ' +
        'কোনো label-এর matching row না পেলে scope বাদ দেবেন না—বিকল্প বানান/সংখ্যা খুঁজুন, না পেলে clarification চান। Ranking-এর winner-এর সঙ্গে তার requested scope-ও final verification query-তে ফেরত আনুন। ' +
        'প্রশ্নের অর্থ সত্যিই একাধিকভাবে হতে পারে এবং উত্তর বদলে যায়—শুধু তখন একটি সংক্ষিপ্ত পাল্টা প্রশ্ন করুন। সময়সীমা না থাকলে চলতি/উপলভ্য পূর্ণ রেকর্ড ব্যবহার করে উত্তরে সময়সীমা উল্লেখ করুন। ' +
        'সংখ্যাগত ফল সম্ভব হলে অন্য query বা summary দিয়ে cross-check করুন। প্রাসঙ্গিক mdr_ai_ reporting view থাকলে ব্যবহার করতে পারেন, কিন্তু তাতে সীমাবদ্ধ নন। ' +
        'প্রশ্নটি সংখ্যা, মোট, কত দিন, সর্বোচ্চ/সর্বনিম্ন বা ranking সম্পর্কিত হলে final উত্তরে সংশ্লিষ্ট নামের সঙ্গে যাচাইকৃত সংখ্যাটিও অবশ্যই স্পষ্টভাবে লিখবেন। ' +
        'ব্যবহারকারী না চাইলে internal UUID, table name বা query plan উত্তরে দেখাবেন না। ' +
        'Database schema and foreign-key relationships:\n' + JSON.stringify(schema)
      }] },
      contents,
      tools: [{ functionDeclarations: [{
        name: 'query_relational_database',
        description: 'Read live data using one base table plus up to five validated joins. Supports filtering, grouping, aggregation, ranking and sorting. Never writes data.',
        parameters: {
          type: 'OBJECT',
          properties: {
            table: { type: 'STRING' },
            alias: { type: 'STRING' },
            joins: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              table: { type: 'STRING' }, alias: { type: 'STRING' }, type: { type: 'STRING', enum: ['inner','left'] },
              left: { type: 'STRING', description: 'Qualified reference such as s.current_class_id' },
              right: { type: 'STRING', description: 'Qualified reference such as c.id' }
            }, required: ['table','alias','left','right'] } },
            columns: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              ref: { type: 'STRING', description: 'Qualified reference such as s.name' }, alias: { type: 'STRING' }
            }, required: ['ref','alias'] } },
            filters: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              ref: { type: 'STRING' }, operator: { type: 'STRING', enum: ['eq','neq','gt','gte','lt','lte','ilike','in','not_in','is_null','not_null'] }, value: { type: 'STRING' }, values: { type: 'ARRAY', items: { type: 'STRING' } }
            }, required: ['ref','operator'] } },
            group_by: { type: 'ARRAY', items: { type: 'STRING', description: 'Qualified reference' } },
            aggregates: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              function: { type: 'STRING', enum: ['count','sum','avg','min','max'] }, ref: { type: 'STRING', description: 'Qualified reference or * for count' }, alias: { type: 'STRING' }
            }, required: ['function','ref','alias'] } },
            order_by: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              ref: { type: 'STRING', description: 'Selected alias, aggregate alias, or qualified reference' }, direction: { type: 'STRING', enum: ['asc','desc'] }
            }, required: ['ref','direction'] } },
            limit: { type: 'INTEGER' }
          }, required: ['table','alias']
        }
      }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: 'high' }
      }
    };
  if (!allowTools) delete payload.tools;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      timeout: 45000,
    }, payload);
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
  }
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

    const schemaResult = await rpc('mdr_rel_admin_ai_schema', {
      p_actor_id: actorId, p_pin: pin
    });
    if (!schemaResult?.ok) return send(res, 401, { ok: false, error: 'unauthorized' });

    const prior = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
    const contents = prior.filter(x => x && ['user','model'].includes(x.role) && typeof x.text === 'string')
      .map(x => ({ role: x.role, parts: [{ text: x.text.slice(0, 2000) }] }));
    contents.push({ role: 'user', parts: [{ text: message }] });
    let successfulQueries = 0;
    let finalCheckRequested = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await gemini(contents, {
        tables: schemaResult.tables || [], relationships: schemaResult.relationships || []
      });
      const content = result?.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        console.error('[admin-assistant] empty Gemini candidate', JSON.stringify({
          finishReason: result?.candidates?.[0]?.finishReason,
          finishMessage: result?.candidates?.[0]?.finishMessage,
          promptFeedback: result?.promptFeedback,
        }));
        if (round < MAX_TOOL_ROUNDS - 1) continue;
        throw new Error('Gemini returned no answer');
      }
      const calls = content.parts.filter(part => part.functionCall?.name === 'query_relational_database');
      if (!calls.length) {
        const answer = content.parts.map(part => part.text || '').join('').trim();
        if (!answer) {
          console.warn(JSON.stringify({
            level: 'warning',
            message: 'admin assistant received content without answer text',
            round,
            successfulQueries
          }));
          if (round < MAX_TOOL_ROUNDS - 1) continue;
          break;
        }
        if (successfulQueries > 0 && !finalCheckRequested) {
          contents.push(content);
          contents.push({ role: 'user', parts: [{ text:
            'চূড়ান্ত উত্তর দেওয়ার আগে database tool দিয়ে একবার স্বাধীনভাবে যাচাই করুন। ব্যবহারকারীর চাওয়া শ্রেণি/বিভাগ/ব্যক্তি/সময় scope final query-তে exact ID বা code filter হিসেবে আছে কি না নিশ্চিত করুন এবং winner-এর scope field-ও ফলাফলে আনুন। scope বাদ দিয়ে পুরো table-এর ranking গ্রহণ করবেন না। এরপর ব্যবহারকারীকে সম্পূর্ণ standalone চূড়ান্ত উত্তরটি আবার লিখুন—শুধু “আগের উত্তর সঠিক” বলবেন না এবং internal UUID/table/query plan দেখাবেন না।'
          }] });
          finalCheckRequested = true;
          continue;
        }
        return send(res, 200, { ok: true, answer: sanitizeAnswer(answer), generatedAt: new Date().toISOString() });
      }
      contents.push(content);
      const responseParts = [];
      for (const call of calls.slice(0, 4)) {
        const args = call.functionCall.args || {};
        const queryResult = await rpc('mdr_rel_admin_ai_relational_query', {
          p_actor_id: actorId, p_pin: pin, p_query: args
        });
        if (queryResult?.ok) successfulQueries++;
        responseParts.push({ functionResponse: { name: 'query_relational_database', response: queryResult } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }
    // Flash-Lite can occasionally keep requesting another tool even after it
    // already has enough verified rows. Preserve the hard database-query cap,
    // then force a text-only synthesis pass from the gathered live results.
    console.warn(JSON.stringify({
      level: 'warning',
      message: 'admin assistant reached database query round limit',
      successfulQueries
    }));
    contents.push({ role: 'user', parts: [{ text:
      'Database query সীমা শেষ। আর কোনো tool call করবেন না। ইতিমধ্যে পাওয়া live database ফল ব্যবহার করে এখনই সম্পূর্ণ standalone বাংলা উত্তর দিন। প্রশ্নটি সংখ্যা/মোট/কত দিন/ranking সম্পর্কিত হলে সংশ্লিষ্ট নামের সঙ্গে যাচাইকৃত সংখ্যাটি অবশ্যই লিখুন। নির্ভরযোগ্য ফল যথেষ্ট না হলে কী বিষয়টি অস্পষ্ট তা উল্লেখ করে একটি সংক্ষিপ্ত clarification question করুন। internal UUID, table name বা query plan দেখাবেন না।'
    }] });
    const finalResult = await gemini(contents, {
      tables: schemaResult.tables || [], relationships: schemaResult.relationships || []
    }, false);
    const finalContent = finalResult?.candidates?.[0]?.content;
    const finalAnswer = finalContent?.parts?.map(part => part.text || '').join('').trim() || '';
    if (finalAnswer) {
      return send(res, 200, { ok: true, answer: sanitizeAnswer(finalAnswer), generatedAt: new Date().toISOString() });
    }
    throw new Error('Gemini returned no final answer after database query limit');
  } catch (error) {
    console.error('[admin-assistant]', error?.message || error);
    return send(res, 500, { ok: false, error: 'assistant_unavailable', message: error?.message || 'Unknown error' });
  }
};
