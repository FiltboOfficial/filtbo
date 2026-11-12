// Translates the app's own words (menus, buttons, messages) into the language the person picked.
// Bible text is never sent here. Answers are saved at Cloudflare for 30 days so the same words are only translated once.
import { json } from '../lib/util.js';

const LANGS = {
  es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', ar: 'Arabic', hi: 'Hindi', zh: 'Simplified Chinese',
  sw: 'Swahili', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa'
};
const MAX_TEXTS = 60, MAX_EACH = 600, MAX_TOTAL = 14000;

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { error: 'Bad request.' }); }
  const lang = body && body.lang;
  const texts = body && body.texts;
  if (!LANGS[lang] || !Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS) return json(400, { error: 'Bad request.' });
  let total = 0;
  for (const t of texts) {
    if (typeof t !== 'string' || !t.length || t.length > MAX_EACH) return json(400, { error: 'Bad request.' });
    total += t.length;
  }
  if (total > MAX_TOTAL) return json(400, { error: 'Too much text at once.' });

  // Same words in the same language were already translated? Reuse the saved answer.
  const cacheKey = new Request('https://filtbo.com/__translate-cache/' + lang + '/' + (await sha256Hex(JSON.stringify(texts))));
  let cache = null;
  try { cache = caches.default; const hit = await cache.match(cacheKey); if (hit) return json(200, await hit.json()); } catch (e) { cache = null; }

  const key = env.GEMINI_API_KEY;
  if (!key) return json(500, { error: 'not_configured' });
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt =
    'Translate every string in the JSON array below from English into ' + LANGS[lang] + '. ' +
    'These are buttons, menus and messages of a Bible app. Keep the same meaning and a warm, simple tone. ' +
    'Do not translate or change: the names Filtbo, Geelko AI, Gospel Animation, Paystack, Google, Premium (keep as Premium), emojis, numbers, dates, URLs, e-mail addresses or text inside curly braces or square brackets. ' +
    'Keep the same punctuation and line breaks. Return ONLY a JSON array with exactly ' + texts.length + ' strings in the same order.\n\n' + JSON.stringify(texts);
  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } } }
      })
    });
  } catch (e) { return json(502, { error: 'translate_unreachable' }); }
  if (!res.ok) return json(502, { error: 'translate_failed' });
  let out;
  try {
    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts.map((p) => p.text || '').join('');
    out = JSON.parse(text);
  } catch (e) { return json(502, { error: 'translate_bad_answer' }); }
  if (!Array.isArray(out) || out.length !== texts.length || out.some((x) => typeof x !== 'string')) return json(502, { error: 'translate_bad_answer' });

  const payload = { ok: true, lang, texts: out };
  try {
    if (cache) await cache.put(cacheKey, new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } }));
  } catch (e) {}
  return json(200, payload);
}
