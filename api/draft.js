import { createDraft } from "../server/handlers.js";
import { send } from "../server/http.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, { status: 204, body: {} });
  if (req.method !== "POST") return send(res, { status: 405, body: { error: "Use POST." } });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  return send(res, await createDraft(body.bid));
}
