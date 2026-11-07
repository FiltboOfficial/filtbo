// Checks the Firebase login token sent by the app, using Google's public lookup (no extra setup needed).
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBnD5e47VNFlLCechc-9_O-tnhyqpjIEL8';

async function userFromRequest(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: m[1] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const u = d.users && d.users[0];
    if (!u || !u.email) return null;
    return { uid: u.localId, email: String(u.email).toLowerCase() };
  } catch (e) { return null; }
}
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
module.exports = { userFromRequest, json };
