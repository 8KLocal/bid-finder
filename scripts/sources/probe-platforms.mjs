#!/usr/bin/env node
/** Record whether each commercial platform's public page may be read. Does not copy listings. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedUrl, readRobots } from "../feed/robots.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const platforms = JSON.parse(fs.readFileSync(path.join(root, "scripts", "sources", "platforms.json"), "utf8"));

const results = [];
for (const platform of platforms) {
  const robots = await readRobots(new URL(platform.robots).origin === new URL(platform.url).origin
    ? platform.url
    : platform.robots);
  let status = "skipped";
  let note = "";
  if (!robots.ok && /HTML challenge/.test(robots.reason)) {
    status = "blocked";
    note = `${platform.name}: ${robots.reason} Listings were not copied.`;
  } else if (!robots.ok && robots.status === 403) {
    status = "blocked";
    note = `${platform.name}: robots.txt returned 403. The bid pages were not fetched.`;
  } else if (robots.ok && !isAllowedUrl(platform.url, robots.robots)) {
    status = "blocked";
    note = `${platform.name}: robots.txt disallows the public page we would have read. Listings were not copied.`;
  } else if (platform.id === "bidnet") {
    status = "skipped";
    note = "BidNet Direct robots.txt allows a generic crawler on the open-solicitations path, disallows paged search URLs, sets a crawl delay, and blocks a list of automated-bot user agents. The terms page is a client-rendered app, so we could not read a license that allows copying those listings into another product. Skipped.";
  } else if (platform.id === "demandstar") {
    status = "skipped";
    note = "DemandStar robots.txt does not disallow the homepage. The terms of use were not available as a stable public document that grants the right to copy solicitations, so no listings were copied.";
  } else if (platform.id === "bonfire") {
    status = robots.ok && !isAllowedUrl(platform.url, robots.robots) ? "blocked" : "blocked";
    note = "Bonfire/Euna publishes a per-agency RSS feed, and a sample of agency hosts (including harriscountytx.bonfirehub.com) answers robots.txt with Disallow: /. The feeds were not downloaded.";
  } else if (["ionwave", "buyboard", "periscope", "jaggaer", "ariba", "civicplus", "opengov", "planetbids"].includes(platform.id)) {
    status = "skipped";
    note = `${platform.name} does not publish one nationwide open-bid feed we can read without a login. Agency sites on this platform are recorded one by one when a jurisdiction URL is known. No listings were copied from the vendor homepage.`;
    if (!robots.ok) note = `${platform.name}: ${robots.reason} ${note}`;
  }
  results.push({ id: platform.id, name: platform.name, status, note, checked: new Date().toISOString(), url: platform.url });
  console.log(`${status}\t${platform.name}`);
}
fs.mkdirSync(path.join(root, "data", "sources"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "sources", "platform-status.json"), JSON.stringify(results, null, 2));
