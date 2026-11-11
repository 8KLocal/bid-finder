#!/usr/bin/env node
/** Look for open-bid datasets on state open-data portals. Grants and spending files are skipped. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedUrl, politeFetch, readRobots } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOMAINS = [
  ["NY", "data.ny.gov"],
  ["TX", "data.texas.gov"],
  ["WA", "data.wa.gov"],
  ["OR", "data.oregon.gov"],
  ["CO", "data.colorado.gov"],
  ["IL", "data.illinois.gov"],
  ["MO", "data.mo.gov"],
  ["PA", "data.pa.gov"],
  ["NJ", "data.nj.gov"],
  ["CT", "data.ct.gov"],
  ["MI", "data.michigan.gov"],
  ["MD", "opendata.maryland.gov"],
];
const CKAN = [["CA", "https://data.ca.gov"]];
const WANT = /bid|solicitation|rfp|procurement opportunit|open opportunit/i;
const SKIP = /award|payment|expenditure|spending|charity|vendor list|purchase order|checkbook/i;

function linkOf(value) {
  if (value && typeof value === "object" && value.url) return value.url;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  return "";
}

function field(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const key = keys.find((item) => item.toLowerCase() === name);
    if (key && row[key]) return row[key];
  }
  return "";
}

function toBid(row, source, state, fallbackUrl) {
  const title = String(field(row, ["title", "name", "solicitation_title", "bid_title", "project_name", "description", "short_title"]) || "").slice(0, 220);
  if (title.length < 6) return null;
  return {
    id: `${source.id}-${field(row, ["id", "solicitation_number", "bid_number", "notice_id"]) || title}`.slice(0, 80),
    title,
    agency: String(field(row, ["agency", "agency_name", "department", "organization", "buyer"]) || source.name).slice(0, 120),
    state,
    naics: String(field(row, ["naics", "naics_code"]) || "").replace(/\D/g, "").slice(0, 6),
    posted: String(field(row, ["posted", "open_date", "publication_date", "start_date"]) || "").slice(0, 10),
    deadline: String(field(row, ["deadline", "due_date", "close_date", "closing_date", "response_deadline", "end_date"]) || ""),
    source: source.name,
    url: linkOf(field(row, ["url", "link", "bidurl", "notice_url"])) || fallbackUrl,
    description: String(field(row, ["summary", "additional_description_1", "notes"]) || "").slice(0, 280),
  };
}

async function socrataCatalog(domain) {
  const url = `https://${domain}/api/catalog/v1?` + new URLSearchParams({
    domains: domain,
    search_context: domain,
    q: "solicitation bid",
    only: "dataset",
    limit: "8",
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "User-Agent": "itsworkplace-bid-listings/1.0 (+https://8klocal.github.io/bid-finder/; legal@itsworkplace.com)" } });
  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((row) => ({
    id: row.resource?.id,
    name: row.resource?.name || "",
    description: row.resource?.description || "",
  })).filter((row) => row.id && WANT.test(`${row.name} ${row.description}`) && !SKIP.test(row.name));
}

async function ckanCatalog(origin) {
  const url = `${origin}/api/3/action/package_search?q=solicitation+bid&rows=8`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "User-Agent": "itsworkplace-bid-listings/1.0 (+https://8klocal.github.io/bid-finder/; legal@itsworkplace.com)" } });
  if (!response.ok) throw new Error(`CKAN HTTP ${response.status}`);
  const data = await response.json();
  return (data.result?.results || []).map((row) => ({
    id: row.id,
    name: row.title || row.name || "",
    description: row.notes || "",
    resources: row.resources || [],
  })).filter((row) => WANT.test(`${row.name} ${row.description}`) && !SKIP.test(row.name));
}

const sources = [];
const bids = [];

for (const [state, domain] of DOMAINS) {
  let found = [];
  try { found = await socrataCatalog(domain); }
  catch (err) {
    sources.push({ id: `state-${state.toLowerCase()}`, name: `${state} open data`, status: "error", count: 0, updated: new Date().toISOString(), reason: `${domain}: ${err.message}` });
    console.log(`error\t${domain}\t${err.message}`);
    continue;
  }
  if (!found.length) {
    sources.push({ id: `state-${state.toLowerCase()}`, name: `${state} open data`, status: "no-bid-dataset", count: 0, updated: new Date().toISOString(), reason: `${domain} catalog has no current solicitation dataset in the first results. Awards and spending files were ignored.` });
    console.log(`none\t${domain}`);
    continue;
  }
  const dataset = found[0];
  const origin = `https://${domain}`;
  const robots = await readRobots(origin);
  const resource = `${origin}/resource/${dataset.id}.json?$limit=80`;
  if (robots.ok && !isAllowedUrl(resource, robots.robots)) {
    sources.push({ id: `state-${state.toLowerCase()}`, name: `${state} open data`, status: "blocked", count: 0, updated: new Date().toISOString(), reason: `${domain} robots.txt disallows /resource/. Dataset seen: ${dataset.name}` });
    console.log(`blocked\t${domain}`);
    continue;
  }
  try {
    const response = await politeFetch(resource, robots.robots || { delayMs: 1000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const source = { id: `state-${state.toLowerCase()}`, name: `${state} open data` };
    const mapped = (Array.isArray(rows) ? rows : []).map((row) => toBid(row, source, state, `${origin}/d/${dataset.id}`)).filter(Boolean);
    const dated = mapped.filter((bid) => String(bid.deadline || "").trim());
    const keep = dated.length >= 3 ? dated : [];
    bids.push(...keep);
    const reason = keep.length
      ? `${dataset.name} on ${domain}. Rows without a deadline were left out.`
      : `${dataset.name} on ${domain} is not an open solicitation list we can use. It had ${mapped.length} titled rows and ${dated.length} deadlines.`;
    sources.push({ ...source, status: keep.length ? "ok" : "no-bid-dataset", count: keep.length, updated: new Date().toISOString(), reason });
    console.log(`${keep.length ? "ok" : "no-bid-dataset"}\t${domain}\t${keep.length}\t${dataset.name}`);
  } catch (err) {
    sources.push({ id: `state-${state.toLowerCase()}`, name: `${state} open data`, status: "error", count: 0, updated: new Date().toISOString(), reason: err.message });
    console.log(`error\t${domain}\t${err.message}`);
  }
}

for (const [state, origin] of CKAN) {
  try {
    const found = await ckanCatalog(origin);
    const dataset = found[0];
    if (!dataset) {
      sources.push({ id: "state-ca", name: "CA open data", status: "no-bid-dataset", count: 0, updated: new Date().toISOString(), reason: "data.ca.gov CKAN search did not return a solicitation dataset in the first results." });
      console.log("none\tdata.ca.gov");
      continue;
    }
    const csv = (dataset.resources || []).find((item) => /csv|json/i.test(`${item.format} ${item.url}`));
    sources.push({
      id: "state-ca",
      name: "CA open data",
      status: csv ? "needs-adapter" : "no-bid-dataset",
      count: 0,
      updated: new Date().toISOString(),
      reason: csv
        ? `Found “${dataset.name}” on data.ca.gov. The file is public, but the columns are not the simple bid table this adapter reads yet.`
        : `Found “${dataset.name}” without a CSV or JSON resource.`,
    });
    console.log(`needs-adapter\tdata.ca.gov\t${dataset.name}`);
  } catch (err) {
    sources.push({ id: "state-ca", name: "CA open data", status: "error", count: 0, updated: new Date().toISOString(), reason: err.message });
    console.log(`error\tdata.ca.gov\t${err.message}`);
  }
}

fs.mkdirSync(path.join(root, "data", "raw"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "raw", "state-data.json"), JSON.stringify({ sources, bids }));
console.log(`state open data bids ${bids.length}`);
