// Geelko AI images: the browser sends {prompt}, we answer {image (base64), mime}.
// Uses the same GEMINI_API_KEY. Model can be changed with GEMINI_IMAGE_MODEL.
const json = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(401, { error: "missing_api_key" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "bad_json" }); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 800) : "";
  if (!prompt) return json(400, { error: "no_prompt" });
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] }
      })
    });
    if (r.status === 429) return json(429, { error: "limit_reached" });
    if (r.status === 400 || r.status === 401 || r.status === 403) return json(401, { error: "ai_key_problem" });
    if (!r.ok) return json(502, { error: "ai_upstream_error" });
    const d = await r.json();
    const parts = d.candidates?.[0]?.content?.parts || [];
    const p = parts.find(x => x.inlineData && x.inlineData.data);
    if (!p) return json(422, { error: "image_blocked" });
    return json(200, { image: p.inlineData.data, mime: p.inlineData.mimeType || "image/png" });
  } catch (e) {
    return json(502, { error: "ai_unreachable" });
  }
};
