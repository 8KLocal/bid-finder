#!/usr/bin/env node
/**
 * Build data/sources/registry from the Census Vintage 2024 subcounty file
 * plus the state procurement seeds. Does not invent bid-page URLs.
 *
 *   node scripts/sources/build-registry.mjs /tmp/sub-est2024.csv
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIPS } from "../feed/states.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "data", "sources", "registry");
const csvPath = process.argv[2] || "/tmp/sub-est2024.csv";

function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const seeds = JSON.parse(fs.readFileSync(path.join(root, "scripts", "sources", "state-seeds.json"), "utf8"));
const seedByState = new Map(seeds.map((row) => [row.state, row]));
const specials = JSON.parse(fs.readFileSync(path.join(root, "scripts", "sources", "specials.json"), "utf8"))
  .filter((row) => !row.skip);

const text = fs.readFileSync(csvPath, "utf8");
const lines = text.split(/\r?\n/).filter(Boolean);
const header = parseLine(lines[0]);
const idx = Object.fromEntries(header.map((name, i) => [name, i]));
const buckets = new Map();

function add(state, row) {
  if (!buckets.has(state)) buckets.set(state, []);
  buckets.get(state).push(row);
}

const counts = { state: 0, county: 0, place: 0, township: 0 };
for (const line of lines.slice(1)) {
  const col = parseLine(line);
  const sumlev = col[idx.SUMLEV];
  const st = FIPS[col[idx.STATE]];
  if (!st) continue;
  const func = col[idx.FUNCSTAT];
  const prim = col[idx.PRIMGEO_FLAG];
  const pop = Number(col[idx.POPESTIMATE2024] || 0);
  const name = col[idx.NAME];
  if (sumlev === "040" && func === "A") {
    const seed = seedByState.get(st);
    add(st, {
      id: `state-${st}`,
      name,
      state: st,
      type: "state",
      pop,
      url: seed?.url || "",
      platform: seed?.platform || "",
      status: "unseen",
    });
    counts.state++;
  } else if (sumlev === "050" && prim === "0" && (func === "A" || func === "C")) {
    add(st, {
      id: `county-${col[idx.STATE]}${col[idx.COUNTY]}`,
      name,
      state: st,
      type: "county",
      pop,
      status: "unseen",
    });
    counts.county++;
  } else if (sumlev === "162" && col[idx.COUNTY] === "000" && func === "A") {
    add(st, {
      id: `place-${col[idx.STATE]}${col[idx.PLACE]}`,
      name,
      state: st,
      type: "place",
      pop,
      status: "unseen",
    });
    counts.place++;
  } else if (sumlev === "061" && prim === "1" && func === "A") {
    add(st, {
      id: `mcd-${col[idx.STATE]}${col[idx.COUNTY]}${col[idx.COUSUB]}`,
      name,
      state: st,
      type: "township",
      pop,
      status: "unseen",
    });
    counts.township++;
  }
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) {
  if (file.endsWith(".json")) fs.unlinkSync(path.join(outDir, file));
}
for (const [state, rows] of buckets) {
  rows.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(outDir, `${state.toLowerCase()}.json`), JSON.stringify(rows));
}

const specialsOut = specials.map((row) => ({
  id: row.id,
  name: row.name,
  state: row.state,
  type: row.type,
  pop: row.pop || 0,
  url: row.url || "",
  platform: row.platform || "",
  status: "unseen",
  partial: true,
}));
fs.writeFileSync(path.join(root, "data", "sources", "specials.json"), JSON.stringify(specialsOut));

const coverage = {
  updated: new Date().toISOString(),
  disclaimer: "Jurisdiction list is the Census Bureau Vintage 2024 subcounty population file (states, active counties, incorporated places, and active minor civil divisions). A row is covered only after its public bid page is fetched under robots.txt. This is not 100% of U.S. governments and not 100% of open bids.",
  census: "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv",
  totals: counts,
  verified: { state: 0, county: 0, place: 0, township: 0, school: 0, university: 0, transit: 0, housing: 0, utility: 0 },
  specialsListed: specialsOut.length,
  specialsNote: "School districts, universities, transit, housing authorities, and utilities are a short seeded list, not a complete census.",
};
fs.mkdirSync(path.join(root, "data", "sources"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "sources", "coverage.json"), JSON.stringify(coverage, null, 2));
console.log(JSON.stringify(counts));
