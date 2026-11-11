/** Polite public fetch. Reads robots.txt for User-agent: * and waits the crawl delay. */

export const USER_AGENT = "itsworkplace-bid-listings/1.0 (+https://8klocal.github.io/bid-finder/; legal@itsworkplace.com)";

export function parseRobots(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inStar = false;
  let sawStar = false;
  const disallow = [];
  const allow = [];
  let delaySec = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      inStar = value === "*";
      if (inStar) sawStar = true;
      continue;
    }
    if (!inStar) continue;
    if (key === "disallow" && value) disallow.push(value);
    if (key === "allow" && value) allow.push(value);
    if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) delaySec = n;
    }
  }
  return { disallow, allow, delayMs: Math.min(delaySec, 20) * 1000, found: sawStar || disallow.length > 0 };
}

function robotsMatch(rule, target) {
  const end = rule.endsWith("$");
  const body = end ? rule.slice(0, -1) : rule;
  const pattern = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + pattern + (end ? "$" : "")).test(target);
}

export function pathAllowed(pathname, robots, search = "") {
  const target = (pathname || "/") + (search || "");
  let blockLen = -1;
  let allowLen = -1;
  for (const rule of robots?.disallow || []) {
    if (rule && robotsMatch(rule, target) && rule.length > blockLen) blockLen = rule.length;
  }
  for (const rule of robots?.allow || []) {
    if (rule && robotsMatch(rule, target) && rule.length >= allowLen) allowLen = rule.length;
  }
  if (blockLen < 0) return true;
  return allowLen >= blockLen;
}

export function isAllowedUrl(urlString, robots) {
  let url;
  try { url = new URL(urlString); }
  catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return pathAllowed(url.pathname || "/", robots, url.search || "");
}

const lastHit = new Map();

export async function politeFetch(urlString, robots, fetchImpl = globalThis.fetch) {
  const url = new URL(urlString);
  const wait = robots?.delayMs || 1000;
  const key = url.hostname;
  const now = Date.now();
  const earliest = (lastHit.get(key) || 0) + wait;
  if (earliest > now) await new Promise((r) => setTimeout(r, earliest - now));
  lastHit.set(key, Date.now());
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,application/xml,text/plain,*/*" },
    signal: AbortSignal.timeout(15000),
  });
  return response;
}

export async function readRobots(origin, fetchImpl = globalThis.fetch) {
  const root = new URL(origin);
  const robotsUrl = `${root.protocol}//${root.host}/robots.txt`;
  try {
    const response = await fetchImpl(robotsUrl, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, robots: { disallow: [], allow: [], delayMs: 1000 }, reason: `robots.txt HTTP ${response.status}` };
    }
    const text = await response.text();
    if (/<!doctype html|<html/i.test(text.slice(0, 400))) {
      return { ok: false, status: response.status, robots: { disallow: ["/"], allow: [], delayMs: 0 }, reason: "robots.txt was not a robots file (HTML challenge or app shell)" };
    }
    return { ok: true, status: response.status, robots: parseRobots(text), reason: "" };
  } catch (err) {
    return { ok: false, status: 0, robots: { disallow: [], allow: [], delayMs: 1000 }, reason: err.name === "TimeoutError" ? "robots.txt timed out" : "robots.txt could not be read" };
  }
}
