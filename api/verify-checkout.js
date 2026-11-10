import { verifyCheckout } from "../server/handlers.js";
import { send } from "../server/http.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, { status: 204, body: {} });
  if (req.method !== "GET") return send(res, { status: 405, body: { error: "Use GET." } });
  const url = new URL(req.url, "https://itsworkplace.local");
  return send(res, await verifyCheckout(url.searchParams.get("session_id")));
}
