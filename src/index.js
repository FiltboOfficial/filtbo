// Filtbo Worker: serves the website, runs the backend (/api/...) and sends reading-plan reminders on a schedule.
//
// Safe switch-over from Netlify: a backend call is handled HERE as soon as the secrets it needs are added in
// Cloudflare (Settings > Variables and Secrets). Until then that one call is passed on to Netlify, exactly like
// before, so nothing breaks while you move the keys across. Once everything is added you can delete Netlify.
import { json } from './lib/util.js';
import { runReminders } from './reminders.js';
import * as aiChat from './api/ai-chat.js';
import * as aiImage from './api/ai-image.js';
import * as verifyPayment from './api/verify-payment.js';
import * as restorePremium from './api/restore-premium.js';
import * as manageSubscription from './api/manage-subscription.js';
import * as notifyEvent from './api/notify-event.js';
import * as pushTest from './api/push-test.js';
import * as subscribePlan from './api/subscribe-plan.js';

const NETLIFY_HOST = 'filtbo.netlify.app';

// needs = the Cloudflare secrets this call cannot work without.
const ROUTES = {
  'ai-chat': { run: aiChat.onRequest, needs: ['GEMINI_API_KEY'] },
  'ai-image': { run: aiImage.onRequest, needs: ['GEMINI_API_KEY'] },
  'verify-payment': { run: verifyPayment.onRequest, needs: ['PAYSTACK_SECRET_KEY'] },
  'restore-premium': { run: restorePremium.onRequest, needs: ['PAYSTACK_SECRET_KEY'] },
  'manage-subscription': { run: manageSubscription.onRequest, needs: ['PAYSTACK_SECRET_KEY'] },
  'notify-event': { run: notifyEvent.onRequest, needs: ['RESEND_API_KEY', 'FIREBASE_SERVICE_ACCOUNT'] },
  'subscribe-plan': { run: subscribePlan.onRequest, needs: ['FIREBASE_SERVICE_ACCOUNT'] },
  // The notification test never falls back: it tells you exactly which Cloudflare variable is missing.
  'push-test': { run: pushTest.onRequest, needs: [] }
};

async function passToNetlify(request, name) {
  const target = new URL(request.url);
  target.hostname = NETLIFY_HOST;
  target.protocol = 'https:';
  target.port = '';
  target.pathname = '/.netlify/functions/' + name;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return fetch(new Request(target.toString(), init));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // New address /api/<name>. The old /.netlify/functions/<name> address keeps working for phones
    // that still have the previous version of the app saved.
    const m = /^\/(?:api|\.netlify\/functions)\/([a-z0-9-]+)\/?$/.exec(url.pathname);
    if (m) {
      const route = ROUTES[m[1]];
      if (!route) return json(404, { error: 'not_found' });
      if (route.needs.some((k) => !env[k])) return passToNetlify(request, m[1]);
      try {
        return await route.run({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
      } catch (e) {
        console.log('backend error in ' + m[1] + ':', e && e.message);
        return json(500, { error: 'server_error' });
      }
    }
    // Everything else is the website itself.
    return env.ASSETS.fetch(request);
  },

  // Runs on the schedule in wrangler.jsonc. Does nothing until the reminder secrets exist.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  }
};
