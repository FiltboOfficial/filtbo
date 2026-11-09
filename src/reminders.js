import { dueSubs, putSub, deleteSub } from './lib/firestore.js';
import { sendPush } from './lib/webpush.js';
import { sendReminderEmail } from './lib/email.js';

// Reminder sender: called by the Worker's cron trigger.
// Sends every reading-plan reminder that is due (phone notification, plus email when the person chose it).
// Cloudflare's free plan allows 50 outgoing requests per run, so each run only handles as many people as fit;
// anyone left over is picked up by the next run a minute later.
const MAX_SUBREQUESTS = 46;

export async function runReminders(env, now = Date.now()) {
  const pub = env.VAPID_PUBLIC_KEY, priv = env.VAPID_PRIVATE_KEY;
  if (!pub || !priv || !env.FIREBASE_SERVICE_ACCOUNT) { console.log('Reminders are not set up yet (missing variables).'); return { skipped: true }; }
  const vapid = { pub, priv, subject: env.VAPID_SUBJECT || 'https://filtbo.com' };
  let docs = [];
  try { docs = await dueSubs(env, now, 100); } catch (e) { console.log('query failed', e.message); return { error: e.message }; }
  let used = 3; // access token + database query + a little spare
  let handled = 0;
  for (const d of docs) {
    try {
      const sub = JSON.parse(d.sub);
      let list = JSON.parse(d.reminders);
      const due = list.filter((r) => r.at <= now);
      list = list.filter((r) => r.at > now);
      const todo = due.slice(0, 5).filter((r) => now - r.at <= 6 * 3600000); // too late to be useful after 6 hours
      const cost = todo.reduce((n, r) => n + 1 + (r.mail ? 1 : 0), 0) + 1;
      if (used + cost > MAX_SUBREQUESTS) break; // the rest are still due, so the next run does them
      used += cost;
      let gone = false;
      for (const r of todo) {
        // The phone notification always goes out first and on its own; the
        // optional email can fail (for example when the email limit is reached)
        // without ever stopping it.
        let out = {};
        try { out = await sendPush(sub, { title: r.title, body: r.body, url: r.url || '/', tag: r.tag || ('r' + r.at), style: r.style === 'audio' ? 'audio' : 'text' }, vapid) || {}; }
        catch (e) { console.log('push failed', e.message); }
        if (r.mail) { try { await sendReminderEmail(env, r.mail, r); } catch (e) { console.log('email failed (phone notification already sent)', e.message); } }
        if (out.gone) { gone = true; break; }
      }
      if (gone || !list.length) await deleteSub(env, d.id);
      else await putSub(env, d.id, { sub: d.sub, reminders: JSON.stringify(list), nextAt: list[0].at });
      handled++;
    } catch (e) { console.log('send failed', e.message); }
  }
  return { due: docs.length, handled };
}
