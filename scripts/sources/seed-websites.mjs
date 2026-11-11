#!/usr/bin/env node
/**
 * Attach official websites from Wikidata to the 500 largest counties
 * and 1,000 largest incorporated places. Does not guess domain names.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const regDir = path.join(root, "data", "sources", "registry");
const outDir = path.join(root, "data", "sources");

function loadRows(type) {
  const rows = [];
  for (const file of fs.readdirSync(regDir)) {
    if (!file.endsWith(".json")) continue;
    for (const row of JSON.parse(fs.readFileSync(path.join(regDir, file), "utf8"))) {
      if (row.type === type) rows.push(row);
    }
  }
  rows.sort((a, b) => (b.pop || 0) - (a.pop || 0) || a.name.localeCompare(b.name));
  return rows;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sparql(query) {
  const url = "https://query.wikidata.org/sparql?query=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return response.json();
}

const counties = loadRows("county").slice(0, 500);
const places = loadRows("place").slice(0, 1000);
const countyByFips = new Map(counties.map((row) => [row.id.slice("county-".length).padStart(5, "0"), row.id]));
const placeByFips = new Map(places.map((row) => [row.id.slice("place-".length).padStart(7, "0"), row.id]));

const websites = {};
const countyData = await sparql(`
SELECT ?fips ?website WHERE {
  ?item wdt:P882 ?fips .
  ?item wdt:P856 ?website .
  FILTER(STRLEN(?fips) = 5 || STRLEN(?fips) = 4)
}`);
for (const row of countyData.results.bindings) {
  const fips = digits(row.fips.value).padStart(5, "0");
  const id = countyByFips.get(fips);
  if (id && !websites[id]) websites[id] = row.website.value;
}

const placeData = await sparql(`
SELECT ?fips ?website WHERE {
  ?item wdt:P774 ?fips .
  ?item wdt:P856 ?website .
  ?item wdt:P17 wd:Q30 .
} LIMIT 20000`);
for (const row of placeData.results.bindings) {
  const fips = digits(row.fips.value);
  const key = fips.length >= 7 ? fips.slice(-7).padStart(7, "0") : "";
  const id = key && placeByFips.get(key);
  if (id && !websites[id]) websites[id] = row.website.value;
}

const priority = {
  note: "500 largest counties and 1,000 largest incorporated places in Census Vintage 2024. Official sites come from Wikidata P856 joined on FIPS. Jurisdictions with no Wikidata site stay unchecked.",
  counties: counties.map((row) => row.id),
  places: places.map((row) => row.id),
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "priority.json"), JSON.stringify(priority));
fs.writeFileSync(path.join(outDir, "websites.json"), JSON.stringify(websites));
const countyHits = counties.filter((row) => websites[row.id]).length;
const placeHits = places.filter((row) => websites[row.id]).length;
console.log(`websites ${Object.keys(websites).length} priority counties ${countyHits}/500 places ${placeHits}/1000`);
