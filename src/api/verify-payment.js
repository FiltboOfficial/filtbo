// Confirms a Premium payment with Paystack. Needs the Cloudflare secret PAYSTACK_SECRET_KEY.
import { json } from '../lib/util.js';
import { userFromRequest } from '../lib/auth.js';

const MIN_KOBO = 189000; // NGN 1,890

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return json(500, { error: 'Payments are not set up on the server yet.' });
  const user = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'Please log in with Google again and retry.' });
  let ref = '';
  try { ref = String(JSON.parse((await request.text()) || '{}').reference || ''); } catch (e) {}
  if (!/^[A-Za-z0-9._=-]{6,100}$/.test(ref)) return json(400, { error: 'That payment reference is not valid.' });
  try {
    const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref), { headers: { Authorization: 'Bearer ' + secret } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.status || !d.data) return json(r.status === 404 || r.status === 400 ? 400 : 502, { error: 'We could not find that payment.' });
    const t = d.data;
    if (t.status === 'abandoned' || t.status === 'pending' || t.status === 'ongoing' || t.status === 'processing' || t.status === 'queued') return json(202, { error: 'Your payment is still being processed.' });
    if (t.status !== 'success') return json(400, { error: 'This payment was not successful.' });
    if (t.currency !== 'NGN' || Number(t.amount) < MIN_KOBO) return json(403, { error: 'This payment does not match the Premium price.' });
    const payer = String((t.customer && t.customer.email) || '').toLowerCase();
    if (payer !== user.email) return json(403, { error: 'This payment was made with a different email than your Filtbo account.' });
    const paidAt = Date.parse(t.paid_at || t.paidAt || '') || Date.now();
    return json(200, { status: true, paidAt, reference: t.reference });
  } catch (e) {
    return json(502, { error: 'We could not reach the payment provider. Please try again.' });
  }
}
