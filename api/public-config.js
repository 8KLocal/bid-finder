import { publicConfig } from "../server/handlers.js";
import { send } from "../server/http.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, { status: 204, body: {} });
  if (req.method !== "GET") return send(res, { status: 405, body: { error: "Use GET." } });
  return send(res, publicConfig());
}
