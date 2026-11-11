#!/usr/bin/env node
/** Run one collector group, or all of them. Failures in one group do not stop the others. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const group = process.argv[2] || "all";

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => resolve(code || 0));
  });
}

const groups = {
  async registry() {
    const csv = process.env.CENSUS_CSV || "/tmp/sub-est2024.csv";
    return run("node", ["scripts/sources/build-registry.mjs", csv]);
  },
  async sam() {
    const csv = process.env.SAM_CSV || "";
    return run("python3", ["scripts/fetch_bids.py", ...(csv ? [csv] : [])]);
  },
  async rfpmart() {
    if (process.env.RFP_USE_CACHE === "1") {
      console.log("RFPMart cache kept");
      return 0;
    }
    return run("node", ["scripts/fetch-rfp-bids.js"]);
  },
  async opendata() {
    return run("node", ["scripts/sources/collect-opendata.mjs"]);
  },
  async platforms() {
    return run("node", ["scripts/sources/probe-platforms.mjs"]);
  },
  async discover() {
    return run("node", ["scripts/sources/discover.mjs"]);
  },
  async build() {
    return run("node", ["scripts/feed/build.mjs"]);
  },
};

const order = group === "all"
  ? ["registry", "sam", "rfpmart", "opendata", "platforms", "discover", "build"]
  : [group];

let failed = 0;
for (const name of order) {
  if (!groups[name]) {
    console.error("unknown group " + name);
    process.exit(2);
  }
  console.log(`\n== ${name}`);
  const code = await groups[name]();
  if (code !== 0) {
    failed++;
    console.error(`${name} exited ${code}`);
    if (group !== "all") process.exit(code);
  }
}
if (group === "all" && !order.includes("build")) {
  await groups.build();
}
process.exit(failed ? 1 : 0);
