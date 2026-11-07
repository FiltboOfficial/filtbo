// Minimal Web Push (VAPID + aes128gcm) using only Node's built-in crypto. No packages needed.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function vapidJwt(endpoint, pub, priv, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const pubBuf = fromB64u(pub);
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(pubBuf.subarray(1, 33)), y: b64u(pubBuf.subarray(33, 65)) },
    format: 'jwk'
  });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64u(sig);
}

export function encryptPayload(sub, payload) {
  const uaPub = fromB64u(sub.keys.p256dh);
  const auth = fromB64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPub);
  const prkKey = hmac(auth, secret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}

// Returns {ok, status, gone}. gone = the device unsubscribed, so the saved subscription can be deleted.
export async function sendPush(sub, payloadObj, { pub, priv, subject }) {
  const body = encryptPayload(sub, JSON.stringify(payloadObj));
  const jwt = vapidJwt(sub.endpoint, pub, priv, subject);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + pub,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high'
    },
    body
  });
  let text = '';
  if (!res.ok) { try { text = (await res.text()).slice(0, 200); } catch (e) {} }
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text };
}
