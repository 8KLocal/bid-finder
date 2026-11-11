import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { daysUntil, isClosedWithin, isPastDue, matchesDeadline } from "../assets/deadlines.js";
import { normalizeBid } from "../scripts/feed/normalize.js";

const NOW = Date.parse("2026-11-11T18:00:00Z");

test("deadline filters use Eastern calendar days and hide past-due notices", () => {
  assert.equal(matchesDeadline("2026-11-11", "today", NOW), true);
  assert.equal(matchesDeadline("2026-11-11", "7", NOW), true);
  assert.equal(matchesDeadline("2026-11-18", "7", NOW), true);
  assert.equal(matchesDeadline("2026-11-19", "7", NOW), false);
  assert.equal(matchesDeadline("2026-11-19", "30", NOW), true);
  assert.equal(matchesDeadline("2026-12-12", "later", NOW), true);
  assert.equal(matchesDeadline("2026-12-12", "30", NOW), false);
  assert.equal(matchesDeadline("", "none", NOW), true);
  assert.equal(matchesDeadline("", "", NOW), true);
  assert.equal(matchesDeadline("", "today", NOW), false);
  assert.equal(matchesDeadline("2026-11-10", "", NOW), false);
  assert.equal(matchesDeadline("2026-11-10", "today", NOW), false);
  assert.equal(isPastDue("2026-11-11T01:00:00-05:00", NOW), false);
  assert.equal(daysUntil("2026-11-11", NOW), 0);
});

test("a notice stays open through the Eastern date, including late UTC", () => {
  const late = Date.parse("2026-11-11T04:30:00Z");
  assert.equal(isPastDue("2026-11-10", late), false);
  assert.equal(matchesDeadline("2026-11-10", "today", late), true);
});

test("past-due window is the previous 30 Eastern days", () => {
  assert.equal(isClosedWithin("2026-11-10", NOW), true);
  assert.equal(isClosedWithin("2026-10-12", NOW), true);
  assert.equal(isClosedWithin("2026-10-11", NOW), false);
  assert.equal(isClosedWithin("2026-11-11", NOW), false);
  assert.equal(isClosedWithin("", NOW), false);
});

test("normalize can keep a recently closed notice out of the open list", () => {
  const recent = normalizeBid({
    id: "recent", title: "Closed cleaning", agency: "Austin", state: "TX",
    deadline: "2026-11-01", source: "SAM.gov", url: "https://sam.gov/opp/recent/view",
  }, { now: NOW, allowRecentlyClosed: true });
  assert.equal(recent.closed, true);
  assert.equal(normalizeBid({
    id: "old", title: "Old cleaning", agency: "Austin", state: "TX",
    deadline: "2026-10-01", source: "SAM.gov", url: "https://sam.gov/opp/old/view",
  }, { now: NOW, allowRecentlyClosed: true }), null);
  assert.equal(normalizeBid({
    id: "recent", title: "Closed cleaning", agency: "Austin", state: "TX",
    deadline: "2026-11-01", source: "SAM.gov", url: "https://sam.gov/opp/recent/view",
  }, { now: NOW }), null);
});

test("the daily refresh is scheduled every day and the cutoff stays Eastern", () => {
  const workflow = fs.readFileSync(".github/workflows/refresh-feed.yml", "utf8");
  const ops = fs.readFileSync("ops/refresh-feed.yml", "utf8");
  assert.match(workflow, /cron:\s*"17 11 \* \* \*"/);
  assert.match(ops, /cron:\s*"17 11 \* \* \*"/);
  const deadlines = fs.readFileSync("assets/deadlines.js", "utf8");
  assert.match(deadlines, /America\/New_York/);
  assert.match(workflow, /node scripts\/feed\/build\.mjs/);
});
