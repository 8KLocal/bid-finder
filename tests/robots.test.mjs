import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedUrl, parseRobots } from "../scripts/feed/robots.js";

test("wildcard robots rules do not block an open-data resource", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /browse?*&q=
Disallow: /*/browse?*&q=
Disallow: */alt$
`);
  assert.equal(isAllowedUrl("https://data.lacity.org/resource/hf3r-utnq.json?$limit=1", robots), true);
  assert.equal(isAllowedUrl("https://data.lacity.org/browse?x=1&q=bids", robots), false);
  assert.equal(isAllowedUrl("https://example.com/secret", parseRobots("User-agent: *\nDisallow: /")), false);
});
