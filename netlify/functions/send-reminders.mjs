// Runs every minute: sends any reminder that is due.
import { dueSubs, putSub, deleteSub } from './_firestore.mjs';
import { sendPush } from './_webpush.mjs';
import { sendReminderEmail } from './_email.mjs';

export default async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv || !process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Reminders are not set up yet (missing variables).'); return; }
  const vapid = { pub, priv, subject: process.env.VAPID_SUBJECT || 'https://filtbo.com' };
  const now = Date.now();
  let docs = [];
  try { docs = await dueSubs(now, 100); } catch (e) { console.log('query failed', e.message); return; }
  for (const d of docs) {
    try {
      const sub = JSON.parse(d.sub);
      let list = JSON.parse(d.reminders);
      const due = list.filter((r) => r.at <= now);
      list = list.filter((r) => r.at > now);
      let gone = false;
      for (const r of due.slice(0, 5)) {
        if (now - r.at > 6 * 3600000) continue; // too late to be useful
        // The phone notification always goes out first and on its own; the
        // optional email can fail (for example when the email limit is reached)
        // without ever stopping it.
        let out = {};
        try { out = await sendPush(sub, { title: r.title, body: r.body, url: r.url || '/', tag: r.tag || ('r' + r.at), style: r.style === 'audio' ? 'audio' : 'text' }, vapid) || {}; }
        catch (e) { console.log('push failed', e.message); }
        if (r.mail) { try { await sendReminderEmail(r.mail, r); } catch (e) { console.log('email failed (phone notification already sent)', e.message); } }
        if (out.gone) { gone = true; break; }
      }
      if (gone || !list.length) await deleteSub(d.id);
      else await putSub(d.id, { sub: d.sub, reminders: JSON.stringify(list), nextAt: list[0].at });
    } catch (e) { console.log('send failed', e.message); }
  }
};

export const config = { schedule: '*/10 * * * *' };
