// "Restore my purchase" and automatic renewals: lists this person's successful Premium payments on Paystack.
// Needs the Cloudflare secret PAYSTACK_SECRET_KEY. The app adds 3 months for each payment.
import { json } from '../lib/util.js';
import { userFromRequest } from '../lib/auth.js';

const MIN_KOBO = 189000; // NGN 1,890

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const secret = env.PAYSTACK_SECRET_KEY;
  if (!secret) return json(500, { error: 'Payments are not set up on the server yet.' });
  const user = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'Please log in with Google again and retry.' });
  const H = { Authorization: 'Bearer ' + secret };
  try {
    const cr = await fetch('https://api.paystack.co/customer/' + encodeURIComponent(user.email), { headers: H });
    if (cr.status === 404) return json(200, { status: true, payments: [] });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.data || !cd.data.id) return json(502, { error: 'We could not check your payments right now.' });
    const tr = await fetch('https://api.paystack.co/transaction?status=success&perPage=100&customer=' + cd.data.id, { headers: H });
    const td = await tr.json().catch(() => ({}));
    if (!tr.ok || !Array.isArray(td.data)) return json(502, { error: 'We could not check your payments right now.' });
    const payments = td.data
      .filter((t) => t.status === 'success' && t.currency === 'NGN' && Number(t.amount) >= MIN_KOBO &&
        (String(t.reference || '').indexOf('filtbo-vip-') === 0 || t.plan_object || (t.plan && Object.keys(t.plan).length)))
      .map((t) => ({ reference: t.reference, paidAt: Date.parse(t.paid_at || t.paidAt || t.created_at || '') || 0 }))
      .filter((p) => p.paidAt);
    return json(200, { status: true, payments });
  } catch (e) {
    return json(502, { error: 'We could not reach the payment provider. Please try again.' });
  }
}
