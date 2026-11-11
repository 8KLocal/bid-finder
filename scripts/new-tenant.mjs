#!/usr/bin/env node
/** Create tenants/<slug>.json from the example. Does not overwrite. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith("--")) {
    args[key] = next;
    i++;
  } else {
    args[key] = "true";
  }
}
const slug = String(args.slug || "").toLowerCase();
const brand = args.brand || "";
if (!/^[a-z0-9-]{2,40}$/.test(slug) || !brand) {
  console.error("Usage: node scripts/new-tenant.mjs --slug acme --brand \"Acme Bid Desk\"");
  process.exit(2);
}
const dest = path.join(root, "tenants", `${slug}.json`);
if (fs.existsSync(dest)) {
  console.error("Refusing to overwrite " + dest);
  process.exit(1);
}
const tenant = JSON.parse(fs.readFileSync(path.join(root, "tenants", "example-harbor.json"), "utf8"));
tenant.slug = slug;
tenant.brand = brand;
tenant.legalName = args.legal || brand;
tenant.example = false;
tenant.tagline = args.tagline || `${brand} public bid list`;
tenant.emailFrom = brand;
tenant.replyTo = args.reply || "";
tenant.address = args.address || "";
tenant.domains = args.domain ? [args.domain] : [];
tenant.listingsUrl = "";
tenant.persona = `Write for ${brand}. ` + (args.persona || "Use only facts from the notice and the customer profile.");
tenant.offshoreLine = args.offshore || "";
fs.writeFileSync(dest, JSON.stringify(tenant, null, 2) + "\n");
console.log("wrote " + dest);
