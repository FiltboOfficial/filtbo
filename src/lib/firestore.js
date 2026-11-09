// Tiny Firestore REST client using a Firebase service account (no packages needed).
// Signing uses the Web Crypto API that Cloudflare provides, so no Node add-ons are required.
import { utf8, b64uEncode, b64Decode } from './util.js';

let acct = null, acctSrc = null, signKey = null, cached = null;

export function parseAccount(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  // Accept a base64-encoded copy too.
  if (!/[{":]/.test(raw) && /^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    try { raw = new TextDecoder().decode(b64Decode(raw)).trim(); } catch (e) {}
  }
  // Forgiving about a pasted value that lost its outer { }.
  if (raw[0] !== '{') raw = '{' + raw;
  if (raw[raw.length - 1] !== '}') raw = raw + '}';
  const tries = [raw, raw.replace(/\r?\n/g, '\\n')];
  for (const t of tries) {
    try { const o = JSON.parse(t); if (o && o.client_email && o.private_key && o.project_id) return o; } catch (e) {}
  }
  throw new Error('FIREBASE_SERVICE_ACCOUNT is not the full service-account JSON');
}

function account(env) {
  const src = env.FIREBASE_SERVICE_ACCOUNT;
  if (!acct || acctSrc !== src) { acct = parseAccount(src); acctSrc = src; signKey = null; cached = null; }
  return acct;
}

async function privateKey(sa) {
  if (signKey) return signKey;
  const body = String(sa.private_key).replace(/\\n/g, '\n').replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
  signKey = await crypto.subtle.importKey('pkcs8', b64Decode(body), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return signKey;
}

async function token(env) {
  if (cached && cached.exp > Date.now() + 60000) return cached.t;
  const sa = account(env);
  const now = Math.floor(Date.now() / 1000);
  const b = (o) => b64uEncode(utf8(JSON.stringify(o)));
  const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const sig = b64uEncode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await privateKey(sa), utf8(unsigned)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Could not get a Google access token');
  cached = { t: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cached.t;
}

const base = (env) => 'https://firestore.googleapis.com/v1/projects/' + account(env).project_id + '/databases/(default)/documents';
const H = async (env) => ({ Authorization: 'Bearer ' + (await token(env)), 'Content-Type': 'application/json' });

const toFields = (o) => ({
  sub: { stringValue: o.sub }, reminders: { stringValue: o.reminders },
  nextAt: { integerValue: String(o.nextAt) }, updatedAt: { integerValue: String(Date.now()) }
});
const fromDoc = (d) => ({
  id: d.name.split('/').pop(),
  sub: d.fields.sub.stringValue, reminders: d.fields.reminders.stringValue,
  nextAt: Number(d.fields.nextAt.integerValue)
});

export async function getSub(env, id) {
  const r = await fetch(base(env) + '/pushSubs/' + id, { headers: await H(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Firestore get ' + r.status);
  return fromDoc(await r.json());
}
export async function putSub(env, id, o) {
  const r = await fetch(base(env) + '/pushSubs/' + id, { method: 'PATCH', headers: await H(env), body: JSON.stringify({ fields: toFields(o) }) });
  if (!r.ok) throw new Error('Firestore put ' + r.status);
}
export async function deleteSub(env, id) {
  await fetch(base(env) + '/pushSubs/' + id, { method: 'DELETE', headers: await H(env) });
}
export async function dueSubs(env, nowMs, limit = 100) {
  const r = await fetch(base(env) + ':runQuery', {
    method: 'POST', headers: await H(env),
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'pushSubs' }],
      where: { fieldFilter: { field: { fieldPath: 'nextAt' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(nowMs) } } },
      limit
    } })
  });
  if (!r.ok) throw new Error('Firestore query ' + r.status);
  const rows = await r.json();
  return rows.filter((x) => x.document).map((x) => fromDoc(x.document));
}

// Is this account a Premium member right now? (reads the vipUntil the app saves on the account)
export async function isPremiumUser(env, uid) {
  const r = await fetch(base(env) + '/users/' + encodeURIComponent(uid), { headers: await H(env) });
  if (!r.ok) return false;
  const d = await r.json();
  const f = d.fields && d.fields.vipUntil;
  const v = f ? Number(f.integerValue != null ? f.integerValue : f.doubleValue) : 0;
  return v > Date.now();
}
