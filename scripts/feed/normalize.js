/** One public-notice shape for every source. Drops non-US and expired rows. */

import { looksForeign, stateCode, stateFromPlace } from "./states.js";

export const CANONICAL = ["id", "title", "agency", "state", "naics", "posted", "deadline", "source", "url", "description"];

const SNIPPET = 220;

export function snippet(value, max = SNIPPET) {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function deadlineMs(value) {
  if (!value) return NaN;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}

export function isExpired(value, now = Date.now()) {
  const ms = deadlineMs(value);
  if (Number.isNaN(ms)) return false;
  return ms < now;
}

/**
 * @param {object} raw
 * @param {{source?: string, state?: string, now?: number}} opts
 * @returns {object|null}
 */
export function normalizeBid(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return null;
  const source = String(raw.source || opts.source || "").trim();
  const title = snippet(raw.title, 200);
  const url = String(raw.url || raw.link || "").trim();
  if (!title || !url) return null;
  let parsed;
  try { parsed = new URL(url); }
  catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  parsed.protocol = "https:";
  parsed.hash = "";

  const deadline = String(raw.deadline || raw.due || "").trim();
  if (isExpired(deadline, opts.now ?? Date.now())) return null;

  const place = String(raw.place || "");
  const country = String(raw.country || "");
  let state = stateCode(raw.state) || stateFromPlace(place) || stateCode(opts.state || "");
  if (looksForeign(place, country) && !state) return null;
  if (!state && looksForeign(place, country)) return null;
  if (!state && !opts.state && source !== "SAM.gov" && !/\b(united states|u\.s\.a\.|\busa\b)/i.test(`${place} ${country} ${title}`)) {
    if (place || country) return null;
    if (!opts.assumeUS) return null;
  }
  if (!state && opts.state) state = stateCode(opts.state);

  const id = String(raw.id || "").trim() || `${source}:${parsed.hostname}${parsed.pathname}`.slice(0, 80);
  const description = snippet(raw.description || raw.summary || "");
  const bid = {
    id,
    title,
    agency: snippet(raw.agency, 120),
    state,
    naics: String(raw.naics || "").replace(/\D/g, "").slice(0, 6),
    posted: String(raw.posted || "").slice(0, 10),
    deadline,
    source,
    url: parsed.toString(),
    description,
    due: deadline,
    link: parsed.toString(),
    summary: description,
    place: state ? place || state : place,
    scope: raw.scope || "general",
    type: raw.type || "",
    setAside: raw.setAside || "",
    solicitation: raw.solicitation || "",
    subTier: raw.subTier || "",
    office: raw.office || "",
    remote: Boolean(raw.remote),
    category: raw.category || "",
    naicsLabel: raw.naicsLabel || "",
  };
  return bid;
}

export function dedupeKeyUrl(link) {
  try {
    const url = new URL(link);
    const pathName = url.pathname.replace(/\/$/, "").toLowerCase();
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathName}${url.search}`;
  } catch {
    return String(link || "").trim().toLowerCase();
  }
}

export function dedupeKeyTitle(bid) {
  const title = String(bid.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const agency = String(bid.agency || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${title}|${agency}`;
}

const RANK = {
  "SAM.gov": 1,
  "LA RAMP": 2,
  "Delaware Bids": 2,
  "Montgomery County MD": 2,
  "TxDOT Lettings": 2,
  "Baton Rouge Bids": 2,
  "RFPMart": 5,
};

export function sourceRank(name) {
  return RANK[name] ?? 4;
}

/** Earlier sources win ties only when their rank is better. */
export function dedupeBids(bids) {
  const ranked = [...bids].filter(Boolean).sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  const urlCounts = new Map();
  for (const bid of ranked) {
    const urlKey = bid.url ? dedupeKeyUrl(bid.url) : "";
    if (urlKey) urlCounts.set(urlKey, (urlCounts.get(urlKey) || 0) + 1);
  }
  const byUrl = new Map();
  const byTitle = new Map();
  const out = [];
  for (const bid of ranked) {
    const urlKey = bid.url ? dedupeKeyUrl(bid.url) : "";
    const shared = urlKey && urlCounts.get(urlKey) > 1;
    const titleKey = dedupeKeyTitle(bid);
    if (!shared && urlKey && byUrl.has(urlKey)) continue;
    const prior = titleKey && titleKey !== "|" ? byTitle.get(titleKey) : null;
    if (prior && prior.source !== bid.source) continue;
    if (urlKey && !shared) byUrl.set(urlKey, bid);
    if (titleKey && titleKey !== "|" && !prior) byTitle.set(titleKey, bid);
    out.push(bid);
  }
  return out;
}
