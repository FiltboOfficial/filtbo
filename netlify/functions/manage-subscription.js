// Gives the signed-in person Paystack's own page to update their card or cancel the Premium subscription.
// Needs PAYSTACK_SECRET_KEY.
const { userFromRequest, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return json(500, { error: 'Payments are not set up on the server yet.' });
  const user = await userFromRequest(event);
  if (!user) return json(401, { error: 'Please log in with Google again and retry.' });
  const H = { Authorization: 'Bearer ' + secret };
  try {
    const cr = await fetch('https://api.paystack.co/customer/' + encodeURIComponent(user.email), { headers: H });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.data || !cd.data.id) return json(404, { error: 'We could not find a subscription for ' + user.email + '.' });
    const sr = await fetch('https://api.paystack.co/subscription?customer=' + cd.data.id, { headers: H });
    const sd = await sr.json().catch(() => ({}));
    const subs = Array.isArray(sd.data) ? sd.data : [];
    const pick = subs.find(x => x.status === 'active') || subs.find(x => x.status === 'non-renewing' || x.status === 'attention') || subs[0];
    if (!pick || !pick.subscription_code) return json(404, { error: 'You do not have an automatic-renewal subscription yet.' });
    const lr = await fetch('https://api.paystack.co/subscription/' + encodeURIComponent(pick.subscription_code) + '/manage/link', { headers: H });
    const ld = await lr.json().catch(() => ({}));
    if (!lr.ok || !ld.data || !ld.data.link) return json(502, { error: 'We could not open your subscription right now.' });
    return json(200, { link: ld.data.link });
  } catch (e) {
    return json(502, { error: 'We could not reach the payment provider. Please try again.' });
  }
};
