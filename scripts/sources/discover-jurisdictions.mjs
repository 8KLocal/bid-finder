#!/usr/bin/env node
/**
 * Daily batch: find a public bid page for the next largest counties and cities.
 * Reads the official site, its links, and one sitemap. Obeys robots.txt.
 * Extracts rows only from HTML tables, RSS/Atom, or iCal. Hosted marketplaces
 * are not copied.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedUrl, politeFetch, readRobots } from "../feed/robots.js";
import {
  bidLinks, classifyPlatform, extractHtmlBids, extractIcalBids, extractRssBids,
  isHostedPlatform, looksLikeBidPage, resolveUrl,
} from "./adapters/listing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const regDir = path.join(root, "data", "sources", "registry");
const batch = Number(process.env.DISCOVER_JURISDICTION_BATCH || 25);
const DONE = new Set(["ok", "blocked", "no-bid-page", "needs-adapter"]);

function loadRegistry() {
  const files = new Map();
  for (const name of fs.readdirSync(regDir)) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(regDir, name);
    files.set(full, JSON.parse(fs.readFileSync(full, "utf8")));
  }
  return files;
}

function indexRegistry(files) {
  const byId = new Map();
  for (const [file, rows] of files) {
    rows.forEach((row, index) => byId.set(row.id, { file, index, row }));
  }
  return byId;
}

function queue(byId, websites) {
  const priority = JSON.parse(fs.readFileSync(path.join(root, "data", "sources", "priority.json"), "utf8"));
  const items = [];
  for (const id of [...priority.counties, ...priority.places]) {
    const hit = byId.get(id);
    if (!hit) continue;
    const status = hit.row.status || "unseen";
    if (process.env.DISCOVER_RECHECK !== "1" && DONE.has(status)) continue;
    const website = websites[id];
    if (!website) continue;
    items.push({ ...hit, website });
    if (items.length >= batch) break;
  }
  return items;
}

async function textOf(url, robots) {
  if (!isAllowedUrl(url, robots)) return { blocked: true, text: "", finalUrl: url, contentType: "" };
  const response = await politeFetch(url, robots);
  const text = await response.text();
  return {
    blocked: false,
    ok: response.ok,
    status: response.status,
    text: text.slice(0, 400000),
    finalUrl: response.url,
    contentType: response.headers.get("content-type") || "",
  };
}

function searchUrl(html, pageUrl) {
  const form = String(html || "").match(/<form\b[^>]*method=["']?get["']?[^>]*>/i);
  if (!form) return "";
  const action = (form[0].match(/action=["']([^"']*)["']/i) || [])[1] || pageUrl;
  const base = resolveUrl(action || pageUrl, pageUrl);
  if (!base) return "";
  const url = new URL(base);
  if ([...url.searchParams.keys()].some((key) => /q|search|keyword/i.test(key))) return "";
  url.searchParams.set("q", "bids");
  return url.toString();
}

async function sitemapLinks(origin, robots) {
  const url = `${origin}/sitemap.xml`;
  if (!isAllowedUrl(url, robots)) return [];
  try {
    const page = await textOf(url, robots);
    if (!page.ok) return [];
    const locs = [...page.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1]);
    return locs.filter((loc) => /bid|rfp|solicit|procure|purchas/i.test(loc)).slice(0, 5);
  } catch {
    return [];
  }
}

async function check(item) {
  const agency = `${item.row.name}, ${item.row.state}`;
  const checked = new Date().toISOString();
  let website;
  try { website = new URL(item.website); }
  catch {
    return { status: "no-bid-page", note: "The recorded official site is not a valid URL.", checked, website: item.website };
  }
  if (!/^https?:$/.test(website.protocol)) {
    return { status: "no-bid-page", note: "The official site is not an http(s) URL.", checked, website: item.website };
  }
  const robots = await readRobots(website.origin);
  const homeAllowed = robots.ok ? isAllowedUrl(website.toString(), robots.robots) : robots.status !== 403;
  if (robots.ok && !homeAllowed) {
    return { status: "blocked", note: "robots.txt disallows the official site.", checked, website: website.toString(), platform: "" };
  }
  if (!robots.ok && /HTML challenge|403/.test(robots.reason)) {
    return { status: "blocked", note: robots.reason, checked, website: website.toString() };
  }
  let home;
  try {
    home = await textOf(website.toString(), robots.robots || { delayMs: 1000 });
  } catch {
    return { status: "no-bid-page", note: "The official site did not respond.", checked, website: website.toString() };
  }
  if (home.blocked) {
    return { status: "blocked", note: "robots.txt disallows the official site.", checked, website: website.toString() };
  }
  if (!home.ok) {
    return { status: "no-bid-page", note: `Official site returned HTTP ${home.status}.`, checked, website: website.toString() };
  }
  let candidates = bidLinks(home.text, home.finalUrl);
  if (!candidates.length) {
    const extra = await sitemapLinks(website.origin, robots.robots || { delayMs: 1000 });
    candidates = extra.map((url) => ({ url, text: "sitemap", score: 2 }));
  }
  if (!candidates.length) {
    const query = searchUrl(home.text, home.finalUrl);
    if (query && isAllowedUrl(query, robots.robots || { delayMs: 0 })) {
      try {
        const searched = await textOf(query, robots.robots || { delayMs: 1000 });
        if (searched.ok) candidates = bidLinks(searched.text, searched.finalUrl);
      } catch { /* the site search is optional */ }
    }
  }
  if (!candidates.length) {
    return { status: "no-bid-page", note: "No procurement or bid link on the official homepage, sitemap, or site search.", checked, website: website.toString() };
  }
  const target = candidates[0];
  let targetUrl;
  try { targetUrl = new URL(target.url); }
  catch {
    return { status: "no-bid-page", note: "The bid link was not a valid URL.", checked, website: website.toString() };
  }
  const targetRobots = targetUrl.origin === website.origin ? robots : await readRobots(targetUrl.origin);
  const rules = targetRobots.robots || { delayMs: 1000 };
  if (targetRobots.ok && !isAllowedUrl(target.url, rules)) {
    return {
      status: "blocked",
      platform: classifyPlatform(target.url),
      url: target.url,
      note: "robots.txt disallows the bid page.",
      checked,
      website: website.toString(),
      bids: [],
    };
  }
  const platformGuess = classifyPlatform(target.url);
  if (isHostedPlatform(platformGuess)) {
    return {
      status: "needs-adapter",
      platform: platformGuess,
      url: target.url,
      note: `Bid page is on ${platformGuess}. Listings were not copied. A simple public table or feed was not available.`,
      checked,
      website: website.toString(),
      bids: [],
    };
  }
  let page;
  try { page = await textOf(target.url, rules); }
  catch {
    return { status: "needs-adapter", platform: platformGuess, url: target.url, note: "The bid page did not respond.", checked, website: website.toString(), bids: [] };
  }
  if (page.blocked || (page.status === 403)) {
    return { status: "blocked", platform: platformGuess, url: target.url, note: "The bid page is disallowed or returned 403.", checked, website: website.toString(), bids: [] };
  }
  const platform = classifyPlatform(page.finalUrl, page.text) || platformGuess || "html";
  if (isHostedPlatform(platform)) {
    return {
      status: "needs-adapter",
      platform,
      url: page.finalUrl,
      note: `Page is a ${platform} site. Listings were not copied.`,
      checked,
      website: website.toString(),
      bids: [],
    };
  }
  let extracted = [];
  if (platform === "rss" || /xml|rss|atom/i.test(page.contentType) || /<(rss|feed)\b/i.test(page.text.slice(0, 500))) {
    extracted = extractRssBids(page.text, page.finalUrl, agency);
  } else if (platform === "ical" || /begin:vcalendar/i.test(page.text.slice(0, 500))) {
    extracted = extractIcalBids(page.text, page.finalUrl, agency);
  } else {
    extracted = extractHtmlBids(page.text, page.finalUrl, agency);
  }
  extracted = extracted.filter((bid) => {
    const title = String(bid.title || "").trim();
    if (/^(sealed )?bids?$/i.test(title) || /^(rfp|rfq|ifb|itb)$/i.test(title)) return false;
    if (/is a bid where|kept hidden until the bid has been awarded|an addendum has been created/i.test(`${title} ${bid.description || ""}`)) return false;
    return true;
  });
  const bids = extracted.map((bid) => ({
    ...bid,
    id: `${item.row.id}-${Buffer.from(bid.url).toString("base64url").slice(0, 24)}`,
    source: "Local bid pages",
    state: item.row.state,
    posted: bid.posted || "",
  }));
  if (bids.length) {
    return {
      status: "ok",
      platform: platform === "html" ? "html-table" : platform,
      url: page.finalUrl,
      note: `Extracted ${bids.length} public rows. Confirm each one on the official page.`,
      checked,
      website: website.toString(),
      bids,
    };
  }
  if (looksLikeBidPage(page.text) || platform === "civicplus" || platform === "socrata" || platform === "ckan") {
    return {
      status: "needs-adapter",
      platform: platform || "unknown",
      url: page.finalUrl,
      note: "A bid page is public, but it is not a simple table, RSS feed, or calendar.",
      checked,
      website: website.toString(),
      bids: [],
    };
  }
  return {
    status: "no-bid-page",
    platform: platform || "",
    url: page.finalUrl,
    note: "The linked page did not contain a public bid list.",
    checked,
    website: website.toString(),
    bids: [],
  };
}

function writeCoverage(byId) {
  const priority = JSON.parse(fs.readFileSync(path.join(root, "data", "sources", "priority.json"), "utf8"));
  const coveragePath = path.join(root, "data", "sources", "coverage.json");
  const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  const tally = (ids) => {
    const counts = { ok: 0, blocked: 0, "no-bid-page": 0, "needs-adapter": 0, unseen: 0 };
    for (const id of ids) {
      const status = byId.get(id)?.row.status || "unseen";
      if (counts[status] === undefined) counts.unseen += 1;
      else counts[status] += 1;
    }
    return counts;
  };
  coverage.priority = {
    counties: priority.counties.length,
    places: priority.places.length,
    note: "Largest counties and incorporated places are checked in daily batches. ok means a simple public list was read. This is not every local bid.",
  };
  coverage.priorityStatus = {
    county: tally(priority.counties),
    place: tally(priority.places),
  };
  coverage.updated = new Date().toISOString();
  fs.writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));
  return coverage.priorityStatus;
}

const websites = JSON.parse(fs.readFileSync(path.join(root, "data", "sources", "websites.json"), "utf8"));
const files = loadRegistry();
const byId = indexRegistry(files);
const items = queue(byId, websites);
const collected = [];
const dirty = new Set();
for (const item of items) {
  let result;
  try { result = await check(item); }
  catch (err) {
    result = { status: "no-bid-page", note: err.name === "TimeoutError" ? "Timed out." : "Could not read the site.", checked: new Date().toISOString(), website: item.website, bids: [] };
  }
  const next = {
    ...item.row,
    status: result.status,
    url: result.url || item.row.url || "",
    website: result.website || item.website,
    platform: result.platform || item.row.platform || "",
    note: result.note || "",
    checked: result.checked,
  };
  files.get(item.file)[item.index] = next;
  byId.get(item.row.id).row = next;
  dirty.add(item.file);
  collected.push(...(result.bids || []));
  console.log(`${result.status}\t${item.row.state}\t${item.row.type}\t${item.row.name}`);
}
for (const file of dirty) fs.writeFileSync(file, JSON.stringify(files.get(file)));

const rawPath = path.join(root, "data", "raw", "jurisdictions.json");
fs.mkdirSync(path.dirname(rawPath), { recursive: true });
let previous = [];
if (fs.existsSync(rawPath)) {
  const checked = new Set(items.map((item) => item.row.id));
  previous = (JSON.parse(fs.readFileSync(rawPath, "utf8")).bids || []).filter((bid) => {
    return ![...checked].some((id) => String(bid.id || "").startsWith(`${id}-`));
  });
}
const seen = new Set();
const bids = [];
for (const bid of [...previous, ...collected]) {
  const key = bid.url || bid.id;
  if (!key || seen.has(key)) continue;
  seen.add(key);
  bids.push(bid);
  if (bids.length >= 2000) break;
}
const sources = [{
  id: "local-pages",
  name: "Local bid pages",
  status: bids.length ? "ok" : "no-current-notices",
  count: bids.length,
  updated: new Date().toISOString(),
  reason: bids.length
    ? "Rows from county and city pages whose robots.txt allowed a simple HTML table, RSS feed, or calendar. Hosted marketplaces are not copied."
    : "The daily batch checked official sites. None of the pages were a simple public table, RSS feed, or calendar, so no rows were copied. Hosted marketplaces are not copied. Status for each jurisdiction is on the coverage panel.",
}];
fs.writeFileSync(rawPath, JSON.stringify({ sources, bids }));
const status = writeCoverage(byId);
console.log(JSON.stringify({ checked: items.length, kept: bids.length, status }));
