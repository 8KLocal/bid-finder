/** Small JSON response helper shared by the Vercel routes and the local server. */

export function applyCors(res) {
  const origin = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export function send(res, result) {
  applyCors(res);
  res.status(result.status);
  if (result.status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body ?? {}));
}
