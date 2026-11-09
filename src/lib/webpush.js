// Minimal Web Push (VAPID + aes128gcm) using only the Web Crypto API that Cloudflare provides. No packages needed.
import { utf8, concat, b64uEncode, b64Decode } from './util.js';

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function vapidJwt(endpoint, pub, priv, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const pubBuf = b64Decode(pub);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: priv, x: b64uEncode(pubBuf.subarray(1, 33)), y: b64uEncode(pubBuf.subarray(33, 65))
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(head + '.' + body));
  return head + '.' + body + '.' + b64uEncode(sig);
}

export async function encryptPayload(sub, payload) {
  const uaPub = b64Decode(sub.keys.p256dh);
  const auth = b64Decode(sub.keys.auth);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const prkKey = await hmac(auth, secret);
  const keyInfo = concat(utf8('WebPush: info\0'), uaPub, asPub);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).subarray(0, 16);
  const nonce = (await hmac(prk, concat(utf8('Content-Encoding: nonce\0'), new Uint8Array([1])))).subarray(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(utf8(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096, big-endian
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, enc);
}

// Returns {ok, status, gone}. gone = the device unsubscribed, so the saved subscription can be deleted.
export async function sendPush(sub, payloadObj, { pub, priv, subject }) {
  const body = await encryptPayload(sub, JSON.stringify(payloadObj));
  const jwt = await vapidJwt(sub.endpoint, pub, priv, subject);
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
