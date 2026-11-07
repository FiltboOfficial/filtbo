// Sends a reading-plan reminder email through Resend (https://resend.com). Needs RESEND_API_KEY in Netlify.
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One shared, branded layout for every Filtbo email (logo, heading, paragraph, button, footer).
const LOGO = 'https://filtbo.com/icons/icon-192.png';
function layout(heading, paragraphs, buttonText, buttonUrl, preheader) {
  const paras = paragraphs.map((p) => '<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#3a352c">' + esc(p) + '</p>').join('');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4efe6">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(preheader || heading) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">' +
    '<tr><td align="center" style="background:#14110d;padding:26px 20px 22px">' +
    '<img src="' + LOGO + '" width="64" height="64" alt="Filtbo" style="display:block;border:0;margin:0 auto 10px">' +
    '<div style="font-size:15px;font-weight:800;letter-spacing:.28em;color:#ffffff">FILT<span style="color:#f2790f">BO</span></div></td></tr>' +
    '<tr><td style="padding:30px 30px 12px">' +
    '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14110d">' + esc(heading) + '</h1>' + paras +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 10px"><tr><td style="background:#14110d;border-radius:12px">' +
    '<a href="' + esc(buttonUrl) + '" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px">' + esc(buttonText) + '</a></td></tr></table></td></tr>' +
    '<tr><td style="padding:18px 30px 26px;border-top:1px solid #eee7da"><p style="margin:0;font-size:12px;line-height:1.6;color:#8a8478">Filtbo Bible App &middot; <a href="https://filtbo.com" style="color:#8a8478">filtbo.com</a><br>Questions? Write to <a href="mailto:filtbooffcial@gmail.com" style="color:#8a8478">filtbooffcial@gmail.com</a></p></td></tr>' +
    '</table></td></tr></table></body></html>';
}
async function send(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return { skipped: true };
  const from = process.env.RESEND_FROM || 'Filtbo <reminders@filtbo.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  if (!res.ok) throw new Error('email ' + res.status);
  return { sent: true };
}

// Reading-plan reminder email.
export async function sendReminderEmail(to, r) {
  const url = 'https://filtbo.com' + (r.url && r.url !== '/' ? r.url : '');
  const body = String(r.body || 'Your reading for today is ready.');
  const para = body + ' Take a few quiet minutes today to read, reflect and let the Word settle in your heart. Your plan is waiting for you in Filtbo, and every day you show up helps you stay consistent in your walk with God.';
  const html = layout('Your reading plan for today', [para], 'Open today\'s reading', url, body);
  return send(to, 'Filtbo reminder: ' + body.slice(0, 70), html, 'Your reading plan for today\n\n' + para + '\n\nOpen Filtbo: ' + url);
}

// Account emails (welcome, login, Premium, birthday).
export async function sendEventEmail(to, subject, heading, message, buttonText) {
  const html = layout(heading, [message], buttonText || 'Open Filtbo', 'https://filtbo.com', message.slice(0, 90));
  return send(to, subject, html, heading + '\n\n' + message + '\n\nhttps://filtbo.com');
}
