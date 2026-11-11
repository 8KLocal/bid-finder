import test from "node:test";
import assert from "node:assert/strict";
import { classifyPlatform, extractHtmlBids, extractIcalBids, extractRssBids, isHostedPlatform } from "../scripts/sources/adapters/listing.js";
import { normalizeBid } from "../scripts/feed/normalize.js";

const NOW = Date.parse("2026-11-11T12:00:00Z");

test("html table rows become bid links", () => {
  const html = `<table>
    <tr><th>Title</th><th>Close date</th></tr>
    <tr><td><a href="/bids/1">Roof replacement</a></td><td>December 1, 2026</td></tr>
    <tr><td><a href="/bids/2">Janitorial service</a></td><td>2026-10-01</td></tr>
  </table>`;
  const rows = extractHtmlBids(html, "https://city.example.gov/purchasing", "Example City");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://city.example.gov/bids/1");
  const kept = rows.map((row) => normalizeBid({
    ...row,
    id: row.url,
    source: "Local bid pages",
    state: "TX",
  }, { source: "Local bid pages", state: "TX", assumeUS: true, now: NOW })).filter(Boolean);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, "Roof replacement");
});

test("rss and ical keep a title and a link", () => {
  const rss = `<rss><channel><item><title>Bridge repair</title><link>https://county.example.gov/rfp/9</link><description>Deck work</description></item></channel></rss>`;
  const ical = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Snow plow contract\nURL:https://town.example.gov/bids/4\nDTEND:20261215T170000\nEND:VEVENT\nEND:VCALENDAR`;
  assert.equal(extractRssBids(rss, "https://county.example.gov/feed", "Example County")[0].title, "Bridge repair");
  assert.equal(extractIcalBids(ical, "https://town.example.gov/bids.ics", "Example Town")[0].deadline, "2026-12-15");
  assert.equal(classifyPlatform("https://x.example.gov/Bids.aspx", ""), "civicplus");
  assert.equal(isHostedPlatform("bidnet"), true);
  assert.equal(isHostedPlatform("html-table"), false);
});
