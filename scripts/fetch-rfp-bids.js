#!/usr/bin/env node
/**
 * Collect publicly visible RFPMart listings into data/rfp-bids.json.
 *
 * Reads robots.txt first and only requests paths User-agent: * allows.
 * Waits at least the published Crawl-delay between requests. Does not log in,
 * does not send cookies, and does not store credentials or session tokens.
 * Individual listing pages are not downloaded; the source URL is kept so the
 * site can link to the original notice.
 *
 * Public category RSS feeds are what RFPMart publishes for automated readers
 * (about 100 items per feed). The HTML catalog is thousands of pages. Walking
 * all of them at the crawl delay would take many hours and the JSON would be
 * too large for GitHub Pages, so the default also takes the first public index
 * page only. Set RFP_INDEX_PAGES to walk more home-N.html pages.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "data", "rfp-bids.json");
const ORIGIN = "https://www.rfpmart.com";
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const RSS_INDEX = `${ORIGIN}/rss-feeds.html`;
// Identifies this collector and uses the conventional "compatible" token.
// RFPMart returns an empty 200 when the agent string has no product token.
const UA = "Mozilla/5.0 (compatible; itsworkplace-bid-listings/1.0; +https://8klocal.github.io/bid-finder/)";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const SMALL = new Set(["and", "or", "of", "the", "for", "a", "an", "in", "on", "with"]);
const ACRONYM = {
  us: "US", usa: "USA", uk: "UK", it: "IT", ai: "AI", gis: "GIS", hr: "HR",
  seo: "SEO", cad: "CAD", cam: "CAM", cctv: "CCTV", rfp: "RFP",
};
const REMOTE = /\b(remote|telework|work from home)\b/i;

export function parseRobots(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inStar = false;
  let sawStar = false;
  const disallow = [];
  let delaySec = 5;
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
    if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) delaySec = n;
    }
  }
  return { disallow, delayMs: delaySec * 1000, found: sawStar };
}

export function isAllowed(urlString, robots) {
  let url;
  try { url = new URL(urlString); }
  catch { return false; }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "rfpmart.com") return false;
  const pathName = url.pathname || "/";
  for (const rule of robots?.disallow || []) {
    if (!rule) continue;
    if (rule === "/") return false;
    if (pathName.startsWith(rule)) return false;
  }
  return true;
}

export function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHumanDate(value) {
  const text = decodeEntities(value);
  let monthName = "";
  let day = "";
  let year = "";
  const monthFirst = text.match(new RegExp(`\\b(${MONTH})\\s+(\\d{1,2}),?\\s*(\\d{4})\\b`, "i"));
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH}),?\\s*(\\d{4})\\b`, "i"));
  if (monthFirst) {
    monthName = monthFirst[1];
    day = monthFirst[2];
    year = monthFirst[3];
  } else if (dayFirst) {
    day = dayFirst[1];
    monthName = dayFirst[2];
    year = dayFirst[3];
  } else {
    return "";
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (!month || Number(day) < 1 || Number(day) > 31) return "";
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}T23:59:00-05:00`;
}

export function postedDay(value) {
  const text = decodeEntities(value);
  const human = parseHumanDate(text);
  if (human) return human.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function splitHead(chunk) {
  const usa = chunk.match(/^(.*?)-USA\s*(\([^)]+\))\s*$/i);
  if (usa && usa[1]) return { code: usa[1].replace(/-+$/, ""), location: `USA ${usa[2]}` };
  if (/^[A-Z]{1,12}(?:-[A-Z0-9]+)+$/i.test(chunk)) return { code: chunk, location: "" };
  return { code: "", location: chunk };
}

export function parseListingTitle(raw) {
  const text = decodeEntities(raw);
  let deadlineText = "";
  const deadline = text.match(new RegExp(`\\bDeadline\\s+((?:${MONTH})\\s+\\d{1,2},\\s*\\d{4})\\s*$`, "i"));
  let body = text;
  if (deadline) {
    deadlineText = deadline[1].replace(/\s+/g, " ");
    body = text.slice(0, deadline.index).replace(/[\s\-–—]+$/, "").trim();
  }
  const parts = body.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  let code = "";
  let location = "";
  let title = body;
  if (parts.length >= 2) {
    const head = splitHead(parts[0]);
    code = head.code;
    const rest = parts.slice(1);
    if (head.location) location = head.location;
    else if (rest.length && (/^(USA|Canada|UK|United Kingdom)\b/i.test(rest[0]) || /\([^)]+\)/.test(rest[0]))) {
      location = rest.shift() || "";
    } else if (rest.length >= 2 && !/^(GLOBAL|Budget)$/i.test(rest[0])) {
      location = rest.shift() || "";
    }
    if (rest.length && /^GLOBAL$/i.test(rest[0])) rest.shift();
    while (rest.length > 1 && (TRAILING_TITLE.test(rest[rest.length - 1]) || MONEY.test(rest[rest.length - 1]))) {
      rest.pop();
    }
    title = cleanTitle(rest.join(" - "));
    if (!location && head.location) location = head.location;
  } else {
    const glued = body.match(/^(US-FED-\d+)-(.+)$/i);
    if (glued) {
      code = glued[1];
      title = cleanTitle(glued[2]);
      location = "USA";
    }
  }
  return {
    code: code.trim(),
    location: location.trim(),
    title: cleanTitle(title) || body,
    deadlineText,
  };
}

export function placeFromLocation(location) {
  let text = String(location || "")
    .replace(/\bGLOBAL\b/ig, " ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  const wrapped = text.match(/^([A-Za-z][A-Za-z .]*?)\s*\((.+)\)\s*$/);
  if (wrapped) {
    const country = wrapped[1].trim();
    const inner = wrapped[2].replace(/\s+/g, " ").trim();
    if (/^USA$/i.test(country)) return inner;
    return `${inner}, ${country}`;
  }
  if (/^USA$/i.test(text)) return "United States";
  return text;
}

const TRAILING_TITLE = /^(?:INFO ONLY, RFP NOT INCLUDED|THIS IS JOB OPPORTUNITY|Job Opportunity|Job Posting|Sources Sought|Budget)$/i;
const MONEY = /^(?:up to\s+)?[\d,]+(?:\s+to\s+[\d,]+)?\s*(?:USD|CAD|EUR|GBP)$/i;

function cleanTitle(title) {
  return String(title || "")
    .replace(/\s*-?\s*INFO ONLY, RFP NOT INCLUDED\s*$/i, "")
    .replace(/\s*-?\s*THIS IS JOB OPPORTUNITY\s*$/i, "")
    .replace(/\s*-?\s*Job Opportunity\s*$/i, "")
    .replace(/\s*-?\s*Job Posting\s*$/i, "")
    .replace(/\s*-?\s*Sources Sought\s*$/i, "")
    .replace(/^GLOBAL-\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function agencyFromText(...parts) {
  const text = parts.filter(Boolean).join(" ");
  const patterns = [
    /\b((?:The )?(?:City|County|Town|Village|Township|Borough|Parish|State|Commonwealth|University) of [A-Z][A-Za-z0-9.&'’-]{2,70}?)(?=[,.;]|$)/,
    /\b((?:U\.S\.|United States) Department of [A-Z][A-Za-z ]{2,50}?)(?=[,.;]|$)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

export function categoryFromFeedUrl(feedUrl) {
  let file = "";
  try { file = new URL(feedUrl).pathname.split("/").pop() || ""; }
  catch { return ""; }
  const slug = file.replace(/-rfp-bids\.xml$/i, "");
  if (!slug || slug === file) return "";
  return slug.split("-").filter(Boolean).map((word, index) => {
    const low = word.toLowerCase();
    if (ACRONYM[low]) return ACRONYM[low];
    if (index && SMALL.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(" ");
}

export function canonicalLink(href, base = ORIGIN + "/") {
  let url;
  try { url = new URL(href, base); }
  catch { return ""; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  url.protocol = "https:";
  if (url.hostname === "rfpmart.com") url.hostname = "www.rfpmart.com";
  url.hash = "";
  url.search = "";
  return url.toString();
}

function bidId(link) {
  const match = link.match(/\/(\d{4,})-/);
  if (match) return `rfp-${match[1]}`;
  return `rfp-${createHash("sha256").update(link).digest("hex").slice(0, 16)}`;
}

export function toBid(fields) {
  const link = canonicalLink(fields.link);
  if (!link || !fields.title) return null;
  if (!isAllowed(link, { disallow: [] })) return null;
  const parsed = parseListingTitle(fields.title);
  const summary = decodeEntities(fields.summary || "").slice(0, 600);
  const due = parseHumanDate(fields.expiry || "") || parseHumanDate(parsed.deadlineText);
  const place = placeFromLocation(parsed.location);
  const agency = agencyFromText(parsed.title, summary, parsed.location);
  return {
    id: bidId(link),
    title: parsed.title,
    solicitation: parsed.code,
    agency,
    subTier: "",
    office: "",
    posted: postedDay(fields.posted || ""),
    due,
    type: "RFP",
    naics: "",
    naicsLabel: "",
    featured: false,
    scope: "rfp",
    remote: REMOTE.test(`${parsed.title} ${summary}`),
    setAside: "",
    place,
    category: fields.category || "",
    contact: "",
    link,
    summary,
    source: "RFPMart",
  };
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1] : "";
}

export function parseFeed(xml, feedUrl) {
  const category = categoryFromFeedUrl(feedUrl);
  const bids = [];
  for (const block of String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const bid = toBid({
      title: tag(block, "title"),
      summary: tag(block, "description"),
      posted: tag(block, "pubDate"),
      link: tag(block, "link") || tag(block, "guid"),
      category,
    });
    if (bid) bids.push(bid);
  }
  return bids;
}

export function parseListingHtml(html, pageUrl) {
  const bids = [];
  const pattern = /<div class="rfpmartIN-descriptionCategory">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span class="post-date">([\s\S]*?)<\/span>[\s\S]*?<span class="expiry-date">([\s\S]*?)<\/span>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const bid = toBid({
      link: match[1],
      title: match[2],
      posted: match[3],
      expiry: match[4],
      category: "",
    });
    if (bid && isAllowed(bid.link, { disallow: [] })) bids.push(bid);
  }
  return bids;
}

export function parsePageCount(html) {
  const match = String(html || "").match(/class="counter"[\s\S]{0,240}?(\d+)\s+of\s+(\d+)/i);
  return match ? Number(match[2]) || 0 : 0;
}

export function discoverFeeds(html) {
  const found = new Set();
  for (const match of String(html || "").matchAll(/href="(https:\/\/www\.rfpmart\.com\/[^"]+\.xml)"/gi)) {
    const url = canonicalLink(match[1]);
    if (!url.endsWith(".xml")) continue;
    const pathName = new URL(url).pathname;
    // Category feeds live at the site root. /state/ and /country/ repeat them.
    // Anything deeper (including robots-disallowed /USA/ and /Canada/) is skipped.
    if (!/^\/[a-z0-9-]+-rfp-bids\.xml$/i.test(pathName)) continue;
    found.add(url);
  }
  return [...found].sort((a, b) => {
    const ag = a.includes("/global-") ? 1 : 0;
    const bg = b.includes("/global-") ? 1 : 0;
    return ag - bg || a.localeCompare(b);
  });
}

export function dedupeBids(bids) {
  const byUrl = new Map();
  const byTitle = new Map();
  const out = [];
  for (const bid of bids) {
    if (!bid?.link || !bid.title) continue;
    const urlKey = bid.link.toLowerCase();
    const titleKey = bid.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (byUrl.has(urlKey) || (titleKey && byTitle.has(titleKey))) continue;
    byUrl.set(urlKey, bid);
    if (titleKey) byTitle.set(titleKey, bid);
    out.push(bid);
  }
  out.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || a.title.localeCompare(b.title));
  return out;
}

function looksBlocked(status, body, contentType) {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true;
  const head = String(body || "").slice(0, 1800);
  const type = String(contentType || "");
  if (/just a moment/i.test(head) && /cloudflare|cf-browser|challenge/i.test(head + type)) return true;
  if (/attention required/i.test(head) && /cloudflare/i.test(head)) return true;
  return false;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function collectRfpBids(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const wait = options.wait || sleep;
  const indexPages = Number.isFinite(options.indexPages)
    ? options.indexPages
    : Number(process.env.RFP_INDEX_PAGES || "1");
  const log = options.log || ((message) => console.error(message));

  const result = {
    bids: [],
    blocked: false,
    blockedReason: "",
    feedsFetched: 0,
    feedsFailed: [],
    indexPagesFetched: 0,
    catalogPages: 0,
    crawlDelaySeconds: 5,
  };
  let lastEnd = 0;
  let robots = { disallow: [], delayMs: 5000, found: false };

  async function get(url) {
    if (!isAllowed(url, robots)) {
      return { ok: false, failed: true, reason: "disallowed", status: 0, body: "", finalUrl: url };
    }
    const gap = robots.delayMs - (Date.now() - lastEnd);
    if (lastEnd && gap > 0) await wait(gap);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "text/html, application/rss+xml, application/xml, text/plain;q=0.5" },
        redirect: "follow",
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      lastEnd = Date.now();
      return { ok: false, failed: true, reason: error.name === "TimeoutError" ? "timeout" : "network", status: 0, body: "", finalUrl: url };
    }
    lastEnd = Date.now();
    const body = await response.text();
    const finalUrl = response.url || url;
    const contentType = response.headers.get("content-type") || "";
    if (!isAllowed(finalUrl, robots)) {
      return { ok: false, failed: true, reason: "redirected off the public listing", status: response.status, body: "", finalUrl };
    }
    if (looksBlocked(response.status, body, contentType)) {
      return { ok: false, blocked: true, reason: `HTTP ${response.status || "blocked"}`, status: response.status, body, finalUrl };
    }
    if (!response.ok) {
      return { ok: false, failed: true, reason: `HTTP ${response.status}`, status: response.status, body, finalUrl };
    }
    if (!String(body || "").trim()) {
      return { ok: false, failed: true, empty: true, reason: "empty response", status: response.status, body, finalUrl };
    }
    return { ok: true, status: response.status, body, finalUrl, contentType };
  }

  const robotsRes = await get(ROBOTS_URL);
  if (!robotsRes.ok) {
    result.blocked = true;
    result.blockedReason = robotsRes.blocked
      ? "robots.txt was blocked"
      : "robots.txt could not be read, so no listings were requested";
    return result;
  }
  robots = parseRobots(robotsRes.body);
  if (!robots.found) {
    result.blocked = true;
    result.blockedReason = "robots.txt had no User-agent: * group, so no listings were requested";
    return result;
  }
  result.crawlDelaySeconds = robots.delayMs / 1000;
  // The first request already happened. Later requests wait delayMs after it.

  const index = await get(RSS_INDEX);
  if (index.blocked || index.empty) {
    result.blocked = true;
    result.blockedReason = index.blocked
      ? "The public RSS index was blocked."
      : "RFPMart returned an empty page for the public RSS index.";
    return result;
  }
  const feeds = index.ok ? discoverFeeds(index.body).filter((url) => isAllowed(url, robots)) : [];
  if (!feeds.length && !index.ok) {
    result.feedsFailed.push(RSS_INDEX);
  }

  const collected = [];
  let consecutive = 0;
  for (const feedUrl of feeds) {
    log(`feed ${feedUrl}`);
    const res = await get(feedUrl);
    if (res.blocked) {
      result.blocked = true;
      result.blockedReason = `Feed blocked: ${feedUrl}`;
      break;
    }
    if (!res.ok) {
      result.feedsFailed.push(feedUrl);
      log(`failed ${feedUrl} (${res.reason || "error"})`);
      consecutive += 1;
      if (consecutive >= 5) {
        result.blocked = true;
        result.blockedReason = "Stopped after repeated failures talking to RFPMart.";
        break;
      }
      continue;
    }
    consecutive = 0;
    const type = res.contentType || "";
    if (/html/i.test(type) && !/xml/i.test(type)) {
      result.feedsFailed.push(feedUrl);
      continue;
    }
    collected.push(...parseFeed(res.body, feedUrl));
    result.feedsFetched += 1;
  }

  const pages = Math.max(0, indexPages);
  for (let page = 1; page <= pages && !result.blocked; page += 1) {
    const url = page === 1 ? `${ORIGIN}/` : `${ORIGIN}/home-${page}.html`;
    if (!isAllowed(url, robots)) break;
    log(`index ${url}`);
    const res = await get(url);
    if (res.blocked) {
      result.blocked = true;
      result.blockedReason = result.blockedReason || `Listing index blocked: ${url}`;
      break;
    }
    if (!res.ok) break;
    const found = parseListingHtml(res.body, url);
    if (!found.length) break;
    collected.push(...found);
    result.indexPagesFetched += 1;
    if (page === 1) result.catalogPages = parsePageCount(res.body);
  }

  result.bids = dedupeBids(collected);
  return result;
}

function writeResult(result) {
  const meta = {
    source: "RFPMart",
    sourceUrl: "https://www.rfpmart.com/",
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    count: result.bids.length,
    feedsFetched: result.feedsFetched,
    feedsFailed: result.feedsFailed.length,
    indexPagesFetched: result.indexPagesFetched,
    catalogPagesReported: result.catalogPages,
    crawlDelaySeconds: result.crawlDelaySeconds,
    blocked: result.blocked,
    blockedReason: result.blockedReason,
    note: "Public category RSS feeds plus the first public HTML index page. robots.txt Crawl-delay is honored and disallowed paths are not requested. Detail pages are not downloaded and no credentials are stored. State and country feeds are skipped because they repeat the category feeds. The HTML catalog is much larger than one run can walk at the published crawl delay without producing a file GitHub Pages cannot serve.",
  };
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  const tmp = DEST + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ meta, bids: result.bids }));
  fs.renameSync(tmp, DEST);
  console.log(`wrote ${result.bids.length} RFPMart bids (${result.feedsFetched} feeds, ${result.feedsFailed.length} feed failures, blocked=${result.blocked})`);
  if (result.blockedReason) console.log(result.blockedReason);
}

async function main() {
  const result = await collectRfpBids();
  if (result.blocked && result.bids.length === 0) {
    writeResult(result);
    process.exitCode = 2;
    return;
  }
  writeResult(result);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
