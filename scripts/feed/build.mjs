#!/usr/bin/env node
/** Normalize SAM, RFPMart, and open-data rows into sharded Pages JSON plus a source index. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeBids, normalizeBid } from "./normalize.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const feedDir = path.join(root, "data", "feed");
const shardDir = path.join(feedDir, "shards");
const now = Date.now();

function readJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

const packs = [];
const sam = readJson("data/raw/sam.json");
if (sam?.bids) {
  packs.push({
    id: "sam",
    name: "SAM.gov",
    status: "ok",
    updated: sam.meta?.updated || new Date().toISOString(),
    reason: sam.meta?.seen > sam.meta?.count
      ? `Public extract had ${sam.meta.seen} open U.S. notices. Published ${sam.meta.count}, balanced across states, so the site stays within GitHub Pages size.`
      : "Official Contract Opportunities public CSV. All NAICS. United States only.",
    bids: sam.bids.map((bid) => normalizeBid(bid, { source: "SAM.gov", now })).filter(Boolean),
    seen: sam.meta?.seen || sam.bids.length,
  });
} else {
  packs.push({ id: "sam", name: "SAM.gov", status: "missing", reason: "data/raw/sam.json was not built on this run.", bids: [], updated: new Date().toISOString(), seen: 0 });
}

const rfp = readJson("data/rfp-bids.json");
if (rfp?.bids) {
  const bids = rfp.bids.map((bid) => normalizeBid({ ...bid, source: "RFPMart" }, { source: "RFPMart", now })).filter(Boolean);
  packs.push({
    id: "rfpmart",
    name: "RFPMart",
    status: rfp.meta?.blocked ? "blocked" : "ok",
    updated: rfp.meta?.updated || new Date().toISOString(),
    reason: "Public category RSS. Non-U.S. and expired rows are dropped. State and country feeds are not refetched because they repeat the category feeds.",
    bids,
    seen: rfp.bids.length,
  });
}

const open = readJson("data/raw/opendata.json");
if (open?.sources) {
  const bySource = new Map();
  for (const bid of open.bids || []) {
    const normalized = normalizeBid(bid, { source: bid.source, state: bid.state, assumeUS: true, now });
    if (!normalized) continue;
    if (!bySource.has(normalized.source)) bySource.set(normalized.source, []);
    bySource.get(normalized.source).push(normalized);
  }
  for (const source of open.sources) {
    packs.push({
      id: source.id,
      name: source.name,
      status: source.status,
      updated: source.updated,
      reason: source.reason || "",
      bids: bySource.get(source.name) || [],
      seen: source.count || 0,
    });
  }
}

const platformPath = path.join(root, "data", "sources", "platform-status.json");
if (fs.existsSync(platformPath)) {
  const platforms = JSON.parse(fs.readFileSync(platformPath, "utf8"));
  for (const platform of platforms) {
    packs.push({
      id: platform.id,
      name: platform.name,
      status: platform.status,
      updated: platform.checked || new Date().toISOString(),
      reason: platform.note || "",
      bids: [],
      seen: 0,
    });
  }
}

const all = dedupeBids(packs.flatMap((pack) => pack.bids));
const keptIds = new Set(all.map((bid) => `${bid.source}:${bid.id}`));
fs.rmSync(shardDir, { recursive: true, force: true });
fs.mkdirSync(shardDir, { recursive: true });

const SHARD = 1800;
const sources = [];
const shardList = [];
const stateCounts = {};
for (const pack of packs) {
  const bids = pack.bids.filter((bid) => keptIds.has(`${bid.source}:${bid.id}`));
  for (const bid of bids) {
    const key = bid.state || "Unspecified";
    stateCounts[key] = (stateCounts[key] || 0) + 1;
  }
  const files = [];
  for (let i = 0; i < bids.length; i += SHARD) {
    const file = `shards/${pack.id}-${String(i / SHARD).padStart(2, "0")}.json`;
    fs.writeFileSync(path.join(feedDir, file), JSON.stringify({ source: pack.name, bids: bids.slice(i, i + SHARD) }));
    files.push(file);
    shardList.push(file);
  }
  sources.push({
    id: pack.id,
    name: pack.name,
    status: pack.status,
    count: bids.length,
    seen: pack.seen,
    updated: pack.updated,
    reason: pack.reason,
    files,
  });
}

const index = {
  updated: new Date().toISOString(),
  disclaimer: "These are the public sources this run could read. This is not every open United States bid, and it is not BidNet or RFPMart coverage.",
  total: all.length,
  states: stateCounts,
  sources,
  shards: shardList,
};
fs.writeFileSync(path.join(feedDir, "index.json"), JSON.stringify(index));
console.log(`feed ${all.length} bids across ${sources.length} sources`);
