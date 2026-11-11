import test from "node:test";
import assert from "node:assert/strict";
import { isPastDue } from "../assets/deadlines.js";
import { dedupeBids, isExpired, normalizeBid } from "../scripts/feed/normalize.js";
import { matchBid } from "../scripts/feed/match.js";
import fs from "node:fs";

const NOW = Date.parse("2026-11-11T12:00:00Z");

test("normalize keeps a US notice and the canonical fields", () => {
  const bid = normalizeBid({
    id: "abc",
    title: "Roof replacement",
    agency: "City of Austin",
    state: "Texas",
    naics: "238160",
    posted: "2026-11-01",
    deadline: "2026-12-01T17:00:00Z",
    source: "SAM.gov",
    url: "https://sam.gov/opp/abc/view",
    description: "Replace the roof.",
  }, { now: NOW });
  assert.equal(bid.state, "TX");
  assert.equal(bid.deadline, "2026-12-01T17:00:00Z");
  assert.equal(bid.url, "https://sam.gov/opp/abc/view");
  assert.equal(bid.description, "Replace the roof.");
});

test("normalize drops expired and foreign notices", () => {
  assert.equal(normalizeBid({
    id: "old", title: "Old roof", agency: "Austin", state: "TX", deadline: "2026-10-01",
    source: "SAM.gov", url: "https://sam.gov/opp/old/view", description: "x",
  }, { now: NOW }), null);
  assert.equal(isExpired("2026-10-01", NOW), true);
  assert.equal(isExpired("", NOW), false);
  assert.equal(isPastDue("2026-11-11T01:00:00-05:00", NOW), false);
  assert.equal(isPastDue("2026-11-10", NOW), true);
  assert.equal(isExpired("2026-11-11T01:00:00-05:00", NOW), false);
  assert.equal(normalizeBid({
    id: "ca", title: "Snow clearing", agency: "City of Toronto", place: "Toronto, Ontario, Canada",
    deadline: "2026-12-01", source: "RFPMart", url: "https://www.rfpmart.com/1-toronto.html",
  }, { now: NOW }), null);
});

test("normalize keeps a dated US place and drops a secret in the URL", () => {
  const bid = normalizeBid({
    id: "r1", title: "Harbor lights", agency: "City of Norfolk", place: "Norfolk, Virginia",
    deadline: "2026-12-20", source: "RFPMart", url: "https://www.rfpmart.com/99-harbor.html",
    description: "x".repeat(400),
  }, { now: NOW });
  assert.equal(bid.state, "VA");
  assert.ok(bid.description.endsWith("…"));
  assert.ok(bid.description.length < 230);
  assert.equal(normalizeBid({
    id: "x", title: "Secret", source: "SAM.gov", url: "https://user:pass@sam.gov/opp/x/view", deadline: "2026-12-01",
  }, { now: NOW }), null);
});

test("dedupe keeps the official row when the title matches", () => {
  const rows = dedupeBids([
    normalizeBid({ id: "r", title: "Same Work", agency: "VA", source: "RFPMart", url: "https://www.rfpmart.com/1.html", state: "VA", deadline: "2026-12-01" }, { now: NOW }),
    normalizeBid({ id: "s", title: "Same Work", agency: "VA", source: "SAM.gov", url: "https://sam.gov/opp/s/view", state: "VA", deadline: "2026-12-01" }, { now: NOW }),
  ]);
  assert.deepEqual(rows.map((bid) => bid.id), ["s"]);
});

test("matcher uses the shared cases", () => {
  const cases = JSON.parse(fs.readFileSync(new URL("./fixtures/match-cases.json", import.meta.url), "utf8"));
  for (const item of cases) {
    assert.equal(matchBid(item.bid, item.interests), item.want, item.name);
  }
});
