#!/usr/bin/env node
/** Pull a few public Socrata open-bid datasets whose robots.txt allows /resource/. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedUrl, politeFetch, readRobots } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const now = new Date();
const today = now.toISOString().slice(0, 10);

function linkOf(value, fallback) {
  if (value && typeof value === "object" && value.url) return value.url;
  if (typeof value === "string" && value.startsWith("http")) return value;
  return fallback;
}

async function soda(domain, dataset, query) {
  const origin = `https://${domain}`;
  const robots = await readRobots(origin);
  const url = `${origin}/resource/${dataset}.json?${query}`;
  if (!robots.ok && robots.status === 403) {
    return { status: "blocked", reason: "robots.txt returned 403", bids: [] };
  }
  if (robots.ok && !isAllowedUrl(url, robots.robots)) {
    return { status: "blocked", reason: "robots.txt disallows /resource/", bids: [] };
  }
  const response = await politeFetch(url, robots.robots || { delayMs: 1000 });
  if (!response.ok) return { status: "error", reason: `HTTP ${response.status}`, bids: [] };
  const rows = await response.json();
  return { status: "ok", reason: "", rows: Array.isArray(rows) ? rows : [] };
}

const jobs = [
  {
    id: "la-ramp",
    name: "LA RAMP",
    state: "CA",
    run: async () => {
      const result = await soda("data.lacity.org", "hf3r-utnq", "$where=" + encodeURIComponent("stagename='Open'") + "&$limit=1000");
      if (result.status !== "ok") return result;
      const bids = result.rows.map((row) => ({
        id: `ramp-${row.rampid}`,
        title: row.title || "",
        agency: row.department || "Los Angeles",
        state: "CA",
        naics: "",
        posted: String(row.bidpost || "").slice(0, 10),
        deadline: row.closedate || "",
        source: "LA RAMP",
        url: linkOf(row.url, "https://www.rampla.org/"),
        description: [row.type, row.category].filter(Boolean).join(" · "),
        place: "Los Angeles, CA",
      }));
      return { status: "ok", bids, reason: "" };
    },
  },
  {
    id: "delaware",
    name: "Delaware Bids",
    state: "DE",
    run: async () => {
      const result = await soda("data.delaware.gov", "2hnj-zwix", "$limit=500");
      if (result.status !== "ok") return result;
      const bids = result.rows.map((row) => ({
        id: `de-${row.contractnumber || String(row.contracttitle || "bid").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
        title: row.contracttitle || "",
        agency: row.agencycode ? `Delaware ${row.agencycode}` : "State of Delaware",
        state: "DE",
        naics: "",
        posted: String(row.opendate || "").slice(0, 10),
        deadline: row.deadlinedate || "",
        source: "Delaware Bids",
        url: linkOf(row.bidurl, "https://mmp.delaware.gov/Bids"),
        description: row.unspsc ? `UNSPSC ${row.unspsc}` : "",
        place: "Delaware",
      }));
      return { status: "ok", bids, reason: "Weekly open-data extract. Confirm the live notice on the state site." };
    },
  },
  {
    id: "montgomery-md",
    name: "Montgomery County MD",
    state: "MD",
    run: async () => {
      const result = await soda("data.montgomerycountymd.gov", "eeq6-nnwe", "$where=" + encodeURIComponent("status='Active'") + "&$limit=500");
      if (result.status !== "ok") return result;
      const bids = result.rows.map((row) => ({
        id: `mococo-${row.number}`,
        title: row.description || `Solicitation ${row.number}`,
        agency: row.department || "Montgomery County, Maryland",
        state: "MD",
        naics: "",
        posted: String(row.issuancedate || "").slice(0, 10),
        deadline: row.closingdate || "",
        source: "Montgomery County MD",
        url: "https://data.montgomerycountymd.gov/d/eeq6-nnwe",
        description: `${row.type || "Solicitation"} ${row.number || ""}`.trim(),
        solicitation: row.number || "",
        place: "Montgomery County, MD",
      }));
      return { status: "ok", bids, reason: "County open-data file. The record links to the dataset because the extract has no per-notice URL." };
    },
  },
  {
    id: "baton-rouge",
    name: "Baton Rouge Bids",
    state: "LA",
    run: async () => {
      const result = await soda("data.brla.gov", "u9zk-8nix", "$where=" + encodeURIComponent(`bid_date>='${today}T00:00:00.000'`) + "&$limit=400");
      if (result.status !== "ok") return result;
      const bids = result.rows.map((row) => ({
        id: `brla-${row.unique_id}`,
        title: row.description || "Baton Rouge bid",
        agency: row.department_name || "City of Baton Rouge",
        state: "LA",
        naics: "",
        posted: "",
        deadline: row.bid_date || "",
        source: "Baton Rouge Bids",
        url: "https://data.brla.gov/d/u9zk-8nix",
        description: [row.note, row.bid_time && `Opens ${row.bid_time}`].filter(Boolean).join(" ").slice(0, 300),
        place: "Baton Rouge, LA",
      }));
      return { status: "ok", bids, reason: "Upcoming bid openings from the city open-data file. Past openings are omitted." };
    },
  },
  {
    id: "txdot",
    name: "TxDOT Lettings",
    state: "TX",
    run: async () => {
      const result = await soda("data.texas.gov", "qh8x-rm8r", "$select=" + encodeURIComponent("project_id,project_number,project_type,highway,county,district_division,proposal_published_date,bid_recieved_until_date_and,project_classification") + "&$where=" + encodeURIComponent(`bid_recieved_until_date_and>'${today}T00:00:00.000'`) + "&$limit=5000");
      if (result.status !== "ok") return result;
      const byProject = new Map();
      for (const row of result.rows) {
        const id = row.project_id || row.project_number;
        if (!id || byProject.has(id)) continue;
        byProject.set(id, {
          id: `txdot-${id}`,
          title: [row.project_type, row.highway, row.county && `${row.county} County`, row.project_number].filter(Boolean).join(" · ") || `TxDOT ${id}`,
          agency: "Texas Department of Transportation",
          state: "TX",
          naics: "",
          posted: String(row.proposal_published_date || "").slice(0, 10),
          deadline: row.bid_recieved_until_date_and || "",
          source: "TxDOT Lettings",
          url: "https://www.txdot.gov/business/letting-bids.html",
          description: [row.project_classification, row.district_division && `${row.district_division} District`, `Project ${row.project_number || id}`].filter(Boolean).join(". "),
          place: row.county ? `${row.county} County, TX` : "Texas",
          solicitation: row.project_number || "",
        });
      }
      return { status: "ok", bids: [...byProject.values()], reason: "Highway lettings aggregated from the public bid-item extract. One row per project. The Texas ESBD portal is a separate source and is not scraped when robots.txt disallows it." };
    },
  },
];

const sources = [];
const bids = [];
for (const job of jobs) {
  try {
    const result = await job.run();
    const kept = result.bids || [];
    bids.push(...kept);
    sources.push({
      id: job.id,
      name: job.name,
      status: result.status,
      count: kept.length,
      updated: new Date().toISOString(),
      reason: result.reason || "",
      state: job.state,
    });
    console.log(`${result.status}\t${job.name}\t${kept.length}`);
  } catch (err) {
    sources.push({ id: job.id, name: job.name, status: "error", count: 0, updated: new Date().toISOString(), reason: err.message || "failed", state: job.state });
    console.log(`error\t${job.name}\t${err.message}`);
  }
}

fs.mkdirSync(path.join(root, "data", "raw"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "raw", "opendata.json"), JSON.stringify({ sources, bids }));
