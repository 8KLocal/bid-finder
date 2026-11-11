import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchIndex, searchBids, stemToken, suggestBids } from "../assets/search.js";

const bids = [
  { id: "j1", title: "Janitorial services", agency: "Homochitto Ranger District", state: "MS", place: "Jackson, MS", solicitation: "1240", naics: "561720", naicsLabel: "Janitorial Services", summary: "Custodial work for the district offices." },
  { id: "c1", title: "Fuel tank cleaning", agency: "Coast Guard", state: "TX", place: "Houston, TX", solicitation: "HSGG", naics: "561790", naicsLabel: "Other Services to Buildings", summary: "Clean and desludge the tank." },
  { id: "s1", title: "IT support for the public website", agency: "City of Austin", state: "TX", place: "Austin, TX", solicitation: "WEB-9", naics: "541511", naicsLabel: "Custom Computer Programming", summary: "Software and web design for the city portal." },
  { id: "r1", title: "Roof replacement", agency: "City of Dallas", state: "TX", place: "Dallas, TX", solicitation: "ROOF-1", naics: "238160", naicsLabel: "Roofing Contractors", summary: "Replace the shingles." },
];

const index = buildSearchIndex(bids);
const titles = new Map(bids.map((bid) => [bid.id, bid.title]));

test("a one-letter typo finds cleaning and janitorial notices", () => {
  const result = searchBids(index, "cleanig");
  assert.equal(result.suggestion, "cleaning");
  const ids = result.hits.map((hit) => hit.id);
  assert.ok(ids.includes("c1"));
  assert.ok(ids.includes("j1"));
  assert.equal(ids.includes("r1"), false);
  assert.ok(result.hits[0].score >= result.hits[1].score);
});

test("stemming and synonyms connect cleaning, janitorial, and custodial", () => {
  assert.equal(stemToken("cleaning"), "clean");
  const ids = searchBids(index, "custodial").hits.map((hit) => hit.id);
  assert.ok(ids.includes("j1"));
  assert.ok(ids.includes("c1"));
});

test("website, web design, IT, and software find the same notice", () => {
  for (const query of ["website", "web design", "IT", "software"]) {
    const ids = searchBids(index, query).hits.map((hit) => hit.id);
    assert.ok(ids.includes("s1"), query);
  }
});

test("search covers agency, NAICS label, solicitation, state, and city", () => {
  assert.equal(searchBids(index, "Homochitto").hits[0].id, "j1");
  assert.equal(searchBids(index, "Roofing Contractors").hits[0].id, "r1");
  assert.equal(searchBids(index, "WEB-9").hits[0].id, "s1");
  assert.equal(searchBids(index, "Houston").hits[0].id, "c1");
  assert.ok(searchBids(index, "texas").hits.some((hit) => hit.id === "c1"));
});

test("suggestions offer a correction and the top titles", () => {
  const items = suggestBids(index, "cleanig", titles);
  assert.match(items[0].label, /Did you mean cleaning/i);
  assert.ok(items.some((item) => /clean|janitor/i.test(item.label)));
});

test("an unknown query still returns a hint instead of silence", () => {
  const result = searchBids(index, "zzzzqqqq");
  assert.equal(result.hits.length, 0);
  const items = suggestBids(index, "roofingg", titles);
  assert.match(items[0].label, /Did you mean/i);
  assert.ok(items.length > 1);
});
