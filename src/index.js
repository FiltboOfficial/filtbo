export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Send existing Netlify function requests to the original backend.
    if (url.pathname.startsWith("/.netlify/functions/")) {
      const target = new URL(request.url);
      target.hostname = "filtbo.netlify.app";
      target.protocol = "https:";
      target.port = "";

      const headers = new Headers(request.headers);
      headers.delete("host");

      const options = {
        method: request.method,
        headers,
        redirect: "manual"
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        options.body = request.body;
      }

      return fetch(new Request(target.toString(), options));
    }

    // Serve the Filtbo website through Cloudflare.
    return env.ASSETS.fetch(request);
  },

  // Netlify continues handling scheduled reminders for now.
  async scheduled() {}
};
// Cloudflare deployment check
