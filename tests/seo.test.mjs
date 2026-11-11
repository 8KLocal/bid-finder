import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const home = fs.readFileSync("index.html", "utf8");
const legal = fs.readFileSync("legal.html", "utf8");
const ORIGIN = "https://8klocal.github.io/bid-finder";

function meta(html, key) {
  const property = html.match(new RegExp(`<meta\\s+property="${key}"\\s+content="([^"]*)"`));
  const name = html.match(new RegExp(`<meta\\s+name="${key}"\\s+content="([^"]*)"`));
  return (property || name)?.[1] || "";
}

test("home title and description cover open US bids and the daily refresh", () => {
  const title = home.match(/<title>([^<]+)<\/title>/)[1];
  const description = meta(home, "description");
  assert.match(title, /Open US government bids/);
  assert.match(title, /refreshed daily/);
  assert.match(title, /It's Workplace/);
  assert.match(description, /Federal, state, county, and city/);
  assert.match(description, /refreshed daily/);
  assert.match(description, /It's Workplace is our offshore team that runs this business/);
  assert.ok(description.length <= 160, description);
});

test("home page has Open Graph, Twitter, canonical, and WebSite search markup", () => {
  assert.equal(home.match(/<link rel="canonical" href="([^"]+)"/)[1], `${ORIGIN}/`);
  assert.equal(meta(home, "og:image"), `${ORIGIN}/assets/share.png`);
  assert.equal(meta(home, "og:image:width"), "1200");
  assert.equal(meta(home, "og:image:height"), "630");
  assert.equal(meta(home, "twitter:card"), "summary_large_image");
  assert.equal(meta(home, "twitter:image"), `${ORIGIN}/assets/share.png`);
  const json = JSON.parse(home.match(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/)[1]);
  assert.equal(json["@type"], "WebSite");
  assert.equal(json.potentialAction["@type"], "SearchAction");
  assert.equal(json.potentialAction.target.urlTemplate, `${ORIGIN}/?q={search_term_string}`);
  assert.equal(json.potentialAction["query-input"], "required name=search_term_string");
});

test("legal page is described and canonical, and the offshore line stays", () => {
  assert.match(legal, /<title>[^<]*It's Workplace/);
  assert.match(meta(legal, "description"), /federal, state, county, and city/i);
  assert.match(legal, /It's Workplace is our offshore team handling the business\./);
  assert.equal(legal.match(/<link rel="canonical" href="([^"]+)"/)[1], `${ORIGIN}/legal.html`);
  assert.equal(meta(legal, "og:url"), `${ORIGIN}/legal.html`);
});

test("robots.txt and sitemap list only the public pages", () => {
  const robots = fs.readFileSync("robots.txt", "utf8");
  const sitemap = fs.readFileSync("sitemap.xml", "utf8");
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Allow:\s*\//);
  assert.match(robots, new RegExp(`Sitemap:\\s*${ORIGIN}/sitemap.xml`));
  assert.match(sitemap, new RegExp(`<loc>${ORIGIN}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${ORIGIN}/legal.html</loc>`));
  assert.equal((sitemap.match(/<loc>/g) || []).length, 2);
});

test("the share image is a 1200 by 630 PNG in the repo", () => {
  const bytes = fs.readFileSync("assets/share.png");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
});

test("SEO markup adds no tracking script and no new external request", () => {
  const added = home.slice(home.indexOf("<title>"), home.indexOf("<link rel=\"icon\""));
  assert.doesNotMatch(added, /google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar|segment\.com/i);
  assert.doesNotMatch(added, /<script[^>]+src=/i);
  assert.match(fs.readFileSync("assets/app.js", "utf8"), /URLSearchParams\(location\.search\)\.get\("q"\)/);
});
