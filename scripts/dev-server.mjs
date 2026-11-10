/**
 * Static site + the Stripe / draft API, for local use and any Node host.
 * GitHub Pages serves the static files only. Set keys in the environment.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckoutSession, createDraft, publicConfig, verifyCheckout } from "../server/handlers.js";
import { applyCors } from "../server/http.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8080);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res, result) {
  applyCors(res);
  const body = result.status === 204 ? "" : JSON.stringify(result.body ?? {});
  res.writeHead(result.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    sendJson(res, { status: 204, body: {} });
    return;
  }
  try {
    if (url.pathname === "/api/public-config" && req.method === "GET") {
      sendJson(res, publicConfig());
      return;
    }
    if (url.pathname === "/api/create-checkout-session" && req.method === "POST") {
      sendJson(res, await createCheckoutSession());
      return;
    }
    if (url.pathname === "/api/verify-checkout" && req.method === "GET") {
      sendJson(res, await verifyCheckout(url.searchParams.get("session_id")));
      return;
    }
    if (url.pathname === "/api/draft" && req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, await createDraft(body.bid));
      return;
    }
  } catch (err) {
    sendJson(res, { status: 500, body: { error: "The local API hit an unexpected error." } });
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  rel = rel.replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  const blocked = !file.startsWith(root + path.sep) || path.basename(file).startsWith(".env");
  if (blocked || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`It's Workplace bid listings at http://127.0.0.1:${port}`);
});
