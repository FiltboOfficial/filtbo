// Sends one real test notification to the phone that asks, and says exactly what went wrong if it fails.
import { sendPush } from './_webpush.mjs';
import { dueSubs } from './_firestore.mjs';

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const missing = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'FIREBASE_SERVICE_ACCOUNT'].filter((k) => !process.env[k]);
  if (missing.length) return json(200, { ok: false, error: 'these Netlify variables are missing: ' + missing.join(', '), fix: 'add them in Site configuration > Environment variables, then upload the folder again' });
  let body;
  try { body = await req.json(); } catch (e) { return json(400, { ok: false, error: 'Bad request.' }); }
  const sub = body && body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return json(400, { ok: false, error: 'This phone did not give a valid notification address.' });
  // Can the reminder sender read the database?
  let dbNote = '';
  try { await dueSubs(0, 1); } catch (e) { dbNote = 'The reminder database could not be read (' + e.message + '). Check FIREBASE_SERVICE_ACCOUNT and that Firestore is created.'; }
  try {
    const out = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } },
      { title: 'Filtbo notifications are working', body: 'This message was sent from the Filtbo server.', url: '/', tag: 'filtbo-push-test' },
      { pub, priv, subject: process.env.VAPID_SUBJECT || 'https://filtbo.com' });
    if (out.ok) return json(200, { ok: true, db: dbNote || 'ok' });
    const hint = out.status === 403 || out.status === 401 ? 'the push keys do not match. Check VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Netlify are the pair from filtbo-push-keys.txt'
      : out.gone ? 'this phone’s notification address expired. Tap the button again'
      : '';
    return json(200, { ok: false, error: 'the phone service answered ' + out.status + (out.text ? ' (' + out.text.replace(/\s+/g, ' ').slice(0, 80) + ')' : ''), fix: hint || dbNote });
  } catch (e) {
    return json(200, { ok: false, error: 'could not send (' + e.message + ')', fix: 'check VAPID_PRIVATE_KEY is copied exactly, with no spaces' });
  }
};
