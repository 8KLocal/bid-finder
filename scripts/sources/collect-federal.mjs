#!/usr/bin/env node
/**
 * Public federal notices that are not SAM.gov's CSV.
 * Grants.gov and USAspending are recorded as skipped because they are not open bids.
 * GSA eBuy is login-only and is not read.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRobots, isAllowedUrl } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const UA = "itsworkplace-bid-listings/1.0 (+https://8klocal.github.io/bid-finder/; legal@itsworkplace.com)";
const TERM = /\b(request for proposals|invitation for bids|sources sought|request for quotation)\b|\b(rfp|ifb)\b/i;
const NOT_A_BID = /information collection|omb review|paperwork reduction|presolicitation notice and response/i;

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const sources = [
  { id: "grants-gov", name: "Grants.gov", status: "skipped", count: 0, updated: new Date().toISOString(), reason: "Grants.gov lists grants, not contract bids. It is not collected." },
  { id: "usaspending", name: "USAspending", status: "skipped", count: 0, updated: new Date().toISOString(), reason: "USAspending lists awards and spending, not open solicitations. It is not collected." },
];
const bids = [];

const frUrl = "https://www.federalregister.gov/api/v1/documents.json?" + new URLSearchParams({
  per_page: "100",
  order: "newest",
  "conditions[type][]": "NOTICE",
  "conditions[term]": "invitation for bids",
});
try {
  const robots = await readRobots("https://www.federalregister.gov/api/v1/documents.json");
  if (robots.ok && !isAllowedUrl(frUrl, robots.robots)) {
    sources.push({ id: "federal-register", name: "Federal Register", status: "blocked", count: 0, updated: new Date().toISOString(), reason: "robots.txt disallows the public documents API." });
  } else {
    const data = await getJson(frUrl);
    for (const doc of data.results || []) {
      const title = String(doc.title || "");
      const abstract = String(doc.abstract || "");
      if (!TERM.test(title) || NOT_A_BID.test(title)) continue;
      bids.push({
        id: `fr-${doc.document_number}`,
        title: title.slice(0, 220),
        agency: doc.agencies?.[0]?.name || "Federal Register",
        state: "",
        naics: "",
        posted: String(doc.publication_date || "").slice(0, 10),
        deadline: doc.comments_close_on || "",
        source: "Federal Register",
        url: doc.html_url,
        description: abstract.slice(0, 280),
      });
    }
    sources.push({
      id: "federal-register",
      name: "Federal Register",
      status: bids.length ? "ok" : "no-current-notices",
      count: bids.length,
      updated: new Date().toISOString(),
      reason: bids.length
        ? "Public Federal Register notices whose titles are solicitations, RFPs, IFBs, or sources sought."
        : "Queried the public Federal Register API for NOTICE documents matching “invitation for bids”. None of the newest 100 titles were themselves a solicitation. FedBizOpps-style contract notices are already in the SAM.gov extract and were not copied twice.",
    });
    console.log(`ok\tFederal Register\t${bids.length}`);
  }
} catch (err) {
  sources.push({ id: "federal-register", name: "Federal Register", status: "error", count: 0, updated: new Date().toISOString(), reason: err.message });
  console.log(`error\tFederal Register\t${err.message}`);
}

let eBuyNote = "GSA eBuy requires a login. It was not read. GSA contract notices that are public are already in the SAM.gov extract.";
try {
  const robots = await readRobots("https://www.ebuy.gsa.gov/");
  if (!robots.ok || (robots.ok && !isAllowedUrl("https://www.ebuy.gsa.gov/", robots.robots))) {
    eBuyNote = `GSA eBuy was not read (${robots.reason || "robots.txt disallows the site"}). Public GSA contract notices remain in the SAM.gov extract.`;
  }
} catch {
  eBuyNote = "GSA eBuy did not respond to a robots check. It was not read. Public GSA contract notices remain in the SAM.gov extract.";
}
sources.push({ id: "gsa-ebuy", name: "GSA eBuy", status: "skipped", count: 0, updated: new Date().toISOString(), reason: eBuyNote });
console.log(`skipped\tGSA eBuy`);

fs.mkdirSync(path.join(root, "data", "raw"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "raw", "federal.json"), JSON.stringify({ sources, bids }));
