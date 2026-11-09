// Checks the Firebase login token sent by the app, using Google's public lookup (no extra setup needed).
const DEFAULT_API_KEY = 'AIzaSyBnD5e47VNFlLCechc-9_O-tnhyqpjIEL8';

export async function userFromRequest(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const apiKey = (env && env.FIREBASE_API_KEY) || DEFAULT_API_KEY;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: m[1] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const u = d.users && d.users[0];
    if (!u || !u.email) return null;
    return { uid: u.localId, email: String(u.email).toLowerCase() };
  } catch (e) { return null; }
}
