// Sends the signed-in person an email about their own account: welcome, login, Premium, birthday.
// The address always comes from the verified login, never from the request.
import { json } from '../lib/util.js';
import { isPremiumUser } from '../lib/firestore.js';
import { sendEventEmail } from '../lib/email.js';
import { userFromRequest } from '../lib/auth.js';

const MAILS = {
  premium: ['Welcome to Filtbo Premium', 'Welcome to Filtbo Premium', 'Thank you for going Premium, and thank you for supporting Filtbo. Your Premium benefits are now active, including an ad-free experience, Geelko AI, the Audio Bible with music, the verse picture maker and email reminders for your reading plans. We pray the extra tools help you study the Bible with more depth and joy.'],
  birthday: ['Happy birthday from Filtbo', 'Happy birthday from Filtbo', 'Today is your special day, and everyone at Filtbo is celebrating you. We thank God for your life and pray that this new year brings you good health, peace, wisdom and favour. May His Word keep guiding every step you take, and may you have a truly blessed birthday.']
};

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  let type = '';
  try { type = String((await request.json()).type || ''); } catch (e) {}
  const m = MAILS[type];
  if (!m) return json(400, { error: 'Unknown type.' });
  const user = await userFromRequest(request, env);
  if (!user) return json(401, { error: 'Not signed in.' });
  try {
    if (type === 'birthday') {
      let premium = false;
      try { premium = await isPremiumUser(env, user.uid); } catch (e) {}
      if (!premium) return json(200, { ok: true, skipped: 'not premium' });
    }
    const out = await sendEventEmail(env, user.email, m[0], m[1], m[2], 'Open Filtbo');
    return json(200, { ok: true, ...out });
  } catch (e) {
    // An email problem (for example the daily email limit) must never matter to the app.
    console.log('notify-event email failed', e && e.message);
    return json(200, { ok: false });
  }
}
