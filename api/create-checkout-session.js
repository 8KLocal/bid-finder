import { createCheckoutSession } from "../server/handlers.js";
import { send } from "../server/http.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, { status: 204, body: {} });
  if (req.method !== "POST") return send(res, { status: 405, body: { error: "Use POST." } });
  return send(res, await createCheckoutSession());
}
