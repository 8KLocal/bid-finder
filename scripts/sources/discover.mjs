#!/usr/bin/env node
/**
 * Check the next batch of jurisdiction bid pages.
 * Highest population first. Obeys robots.txt. One page each. No logins.
 *
 *   node scripts/sources/discover.mjs --batch 40
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedUrl, politeFetch, readRobots } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const regDir = path.join(root, "data", "sources", "registry");
const batch = Number(process.env.DISCOVER_BATCH || argValue("--batch") || 40);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

function classify(url, html) {
  const blob = `${url} ${html.slice(0, 4000)}`.toLowerCase();
  const rules = [
    ["bonfire", "bonfirehub.com"],
    ["planetbids", "planetbids"],
    ["opengov", "opengov.com"],
    ["ionwave", "ionwave.net"],
    ["bidnet", "bidnetdirect.com"],
    ["demandstar", "demandstar.com"],
    ["jaggaer", "sciquest.com"],
    ["jaggaer", "jaggaer"],
    ["ariba", "ariba.com"],
    ["civicplus", "civicplus.com"],
    ["periscope", "/bso/"],
    ["periscope", "bidsync"],
  ];
  for (const [name, needle] of rules) {
    if (blob.includes(needle)) return name;
  }
  return "";
}

function loginWall(html) {
  const text = html.slice(0, 2500).toLowerCase();
  return /human verification|just a moment|access denied|cf-browser-verification/.test(text)
    || (/<title[^>]*>[^<]*(log ?in|sign in)/i.test(html.slice(0, 1500)) && !/solicitation|bid opportunity|procurement/i.test(html.slice(0, 2500)));
}

function loadQueue() {
  const queue = [];
  for (const file of fs.readdirSync(regDir)) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(regDir, file);
    const rows = JSON.parse(fs.readFileSync(full, "utf8"));
    rows.forEach((row, index) => {
      if (!row.url) return;
      if (process.env.DISCOVER_RECHECK !== "1" && (row.status || "unseen") !== "unseen") return;
      queue.push({ file: full, index, row });
    });
  }
  const specialsPath = path.join(root, "data", "sources", "specials.json");
  if (fs.existsSync(specialsPath)) {
    const rows = JSON.parse(fs.readFileSync(specialsPath, "utf8"));
    rows.forEach((row, index) => {
      if (!row.url) return;
      if (process.env.DISCOVER_RECHECK !== "1" && (row.status || "unseen") !== "unseen") return;
      queue.push({ file: specialsPath, index, row });
    });
  }
  queue.sort((a, b) => (b.row.pop || 0) - (a.row.pop || 0));
  return queue.slice(0, batch);
}

async function check(item) {
  const row = item.row;
  let url;
  try { url = new URL(row.url); }
  catch {
    return { ...row, status: "unreachable", note: "Bid URL is not a valid http(s) URL.", checked: new Date().toISOString() };
  }
  const robots = await readRobots(url.origin);
  if (!robots.ok && /HTML challenge|timed out|could not be read/.test(robots.reason)) {
    return { ...row, status: "blocked", note: robots.reason, checked: new Date().toISOString() };
  }
  if (robots.ok && !isAllowedUrl(url.toString(), robots.robots)) {
    return { ...row, status: "blocked", note: "robots.txt disallows this path.", checked: new Date().toISOString() };
  }
  if (!robots.ok && robots.status === 403) {
    return { ...row, status: "blocked", note: "robots.txt returned 403, so the page was not fetched.", checked: new Date().toISOString() };
  }
  try {
    const response = await politeFetch(row.url, robots.robots || { delayMs: 1000 });
    const html = await response.text();
    if (response.status === 401 || response.status === 403) {
      return { ...row, status: "blocked", note: `Page returned HTTP ${response.status}.`, checked: new Date().toISOString() };
    }
    if (!response.ok) {
      return { ...row, status: "unreachable", note: `Page returned HTTP ${response.status}.`, checked: new Date().toISOString() };
    }
    if (loginWall(html)) {
      return { ...row, status: "login-wall", platform: classify(response.url, html) || row.platform || "", note: "Page is a login or bot check, not an open bid list.", checked: new Date().toISOString() };
    }
    const platform = classify(response.url, html) || row.platform || "state-portal";
    return {
      ...row,
      url: response.url,
      status: "verified",
      platform,
      note: "Public page responded. Listings are not copied from this check.",
      checked: new Date().toISOString(),
    };
  } catch (err) {
    return { ...row, status: "unreachable", note: err.name === "TimeoutError" ? "Timed out." : "Could not fetch the page.", checked: new Date().toISOString() };
  }
}

function writeBack(updates) {
  const byFile = new Map();
  for (const item of updates) {
    if (!byFile.has(item.file)) byFile.set(item.file, JSON.parse(fs.readFileSync(item.file, "utf8")));
    byFile.get(item.file)[item.index] = item.next;
  }
  for (const [file, rows] of byFile) fs.writeFileSync(file, JSON.stringify(rows));
}

function recount() {
  const verified = { state: 0, county: 0, place: 0, township: 0, school: 0, university: 0, transit: 0, housing: 0, utility: 0 };
  const status = {};
  for (const file of fs.readdirSync(regDir)) {
    if (!file.endsWith(".json")) continue;
    for (const row of JSON.parse(fs.readFileSync(path.join(regDir, file), "utf8"))) {
      const st = row.status || "unseen";
      status[st] = (status[st] || 0) + 1;
      if (st === "verified" && verified[row.type] !== undefined) verified[row.type]++;
    }
  }
  const specialsPath = path.join(root, "data", "sources", "specials.json");
  let specialsListed = 0;
  if (fs.existsSync(specialsPath)) {
    for (const row of JSON.parse(fs.readFileSync(specialsPath, "utf8"))) {
      specialsListed++;
      const st = row.status || "unseen";
      status[st] = (status[st] || 0) + 1;
      if (st === "verified" && verified[row.type] !== undefined) verified[row.type]++;
    }
  }
  const coveragePath = path.join(root, "data", "sources", "coverage.json");
  const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  coverage.updated = new Date().toISOString();
  coverage.verified = verified;
  coverage.statusCounts = status;
  coverage.specialsListed = specialsListed;
  coverage.checkedNote = "verified means the public URL responded and robots.txt allowed that fetch. It does not mean every bid on that site was collected.";
  fs.writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));
  return coverage;
}

const queue = loadQueue();
const updates = [];
for (const item of queue) {
  const next = await check(item);
  updates.push({ ...item, next });
  console.log(`${next.status}\t${next.state}\t${next.type}\t${next.name}`);
}
writeBack(updates);
const coverage = recount();
console.log(JSON.stringify({ checked: updates.length, verified: coverage.verified, status: coverage.statusCounts }));
