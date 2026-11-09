// Saves a phone's push subscription and its list of future reminders.
import { json } from '../lib/util.js';
import { getSub, putSub, deleteSub, isPremiumUser } from '../lib/firestore.js';
import { userFromRequest } from '../lib/auth.js';

const clean = (s, n) => String(s == null ? '' : s).slice(0, n);

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { error: 'Bad request.' }); }
  const sub = body && body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 ||
      !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return json(400, { error: 'Invalid subscription.' });
  const incoming = (Array.isArray(body.reminders) ? body.reminders : []).slice(0, 400).map((r) => ({
    at: Date.parse(r && r.sendAtUTC), title: clean(r.title, 120), body: clean(r.body, 400),
    url: /^\//.test(r.url || '') ? clean(r.url, 200) : '/', tag: clean(r.tag, 80), planId: clean(r.planId, 60), style: r && (r.style === 'audio' || r.style === 'text') ? r.style : 'push'
  })).filter((r) => r.at && r.at > Date.now() - 60000 && r.at < Date.now() + 400 * 86400000);
  const dropId = clean(body.cancelPlanId || body.replacePlanId, 60);
  if (!incoming.length && !dropId) return json(200, { ok: true, saved: 0 });

  // Email/SMS and Call/Alarm reminders are for Premium members only. The email address comes from the
  // verified login, never from the request, so nobody can use this to email someone else.
  if (incoming.length && incoming.some((r) => r.style !== 'push')) {
    const user = await userFromRequest(request, env);
    let premium = false;
    try { premium = !!(user && await isPremiumUser(env, user.uid)); } catch (e) { premium = false; }
    if (!premium) return json(403, { error: 'These reminder types are only available for Premium users.' });
    incoming.forEach((r) => { if (r.style === 'text') r.mail = user.email; });
  }

  try {
    const id = await sha256Hex(sub.endpoint);
    const old = await getSub(env, id);
    let list = [];
    if (old) { try { list = JSON.parse(old.reminders); } catch (e) {} }
    const seen = new Set();
    if (dropId) list = list.filter((r) => r.planId !== dropId);
    const merged = list.concat(incoming).filter((r) => r.at > Date.now() - 3600000)
      .filter((r) => { const k = r.at + '|' + r.title; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.at - b.at).slice(0, 500);
    if (!merged.length) { if (old) await deleteSub(env, id); return json(200, { ok: true, saved: 0, cancelled: true }); }
    await putSub(env, id, { sub: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), reminders: JSON.stringify(merged), nextAt: merged[0].at });
    return json(200, { ok: true, saved: merged.length });
  } catch (e) {
    console.log('subscribe-plan failed:', e && e.message);
    return json(500, { error: 'Could not save reminders: ' + String(e && e.message).slice(0, 120) });
  }
}
