import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  agencyFromText,
  categoryFromFeedUrl,
  dedupeBids,
  discoverFeeds,
  isAllowed,
  parseFeed,
  parseHumanDate,
  parseListingHtml,
  parseListingTitle,
  parsePageCount,
  parseRobots,
  placeFromLocation,
} from "../scripts/fetch-rfp-bids.js";
import { claimPayload, mergeBidLists, safeWebhookUrl } from "../assets/list.js";

const ROBOTS = `User-agent: AhrefsBot
Disallow: /

User-agent: *
Crawl-delay: 5
Disallow: /admin/
Disallow: /js/
Disallow: /document/
Disallow: /USA/
Disallow: /Canada/
`;

test("robots.txt allows public listings and blocks private paths", () => {
  const robots = parseRobots(ROBOTS);
  assert.equal(robots.delayMs, 5000);
  assert.equal(isAllowed("https://www.rfpmart.com/rss-feeds.html", robots), true);
  assert.equal(isAllowed("https://www.rfpmart.com/web-design-and-development-rfp-bids.xml", robots), true);
  assert.equal(isAllowed("https://www.rfpmart.com/usa-california-rfp-bids-tender.html", robots), true);
  assert.equal(isAllowed("https://www.rfpmart.com/1196111-usa-california-website-rfp.html", robots), true);
  assert.equal(isAllowed("https://www.rfpmart.com/USA/secret.html", robots), false);
  assert.equal(isAllowed("https://www.rfpmart.com/Canada/secret.html", robots), false);
  assert.equal(isAllowed("https://www.rfpmart.com/js/app.js", robots), false);
  assert.equal(isAllowed("https://www.rfpmart.com/admin/bids", robots), false);
  assert.equal(isAllowed("https://www.rfpmart.com/document/rfp.pdf", robots), false);
  assert.equal(isAllowed("https://user:secret@www.rfpmart.com/feed.xml", robots), false);
  assert.equal(isAllowed("http://www.rfpmart.com/feed.xml", robots), false);
  assert.equal(isAllowed("https://evil.example/feed.xml", robots), false);
});

test("listing titles keep the public fields", () => {
  const web = parseListingTitle("WD-16444 - USA (California) - Website Hosting, Maintenance and Modification Services using Drupal CMS - Deadline December 8,2026");
  assert.equal(web.code, "WD-16444");
  assert.equal(web.title, "Website Hosting, Maintenance and Modification Services using Drupal CMS");
  assert.equal(placeFromLocation(web.location), "California");
  assert.equal(parseHumanDate(web.deadlineText).slice(0, 10), "2026-12-08");

  const city = parseListingTitle("EXTRA-79434-USA (San Francisco, California) - AirTrain Medium Voltage Cable Replacement Services - Deadline December 8,2026");
  assert.equal(city.code, "EXTRA-79434");
  assert.equal(placeFromLocation(city.location), "San Francisco, California");
  assert.equal(city.title, "AirTrain Medium Voltage Cable Replacement Services");

  const global = parseListingTitle("WD-16443 - Switzerland - GLOBAL - Website Design, Development, Hosting - Deadline December 1,2026");
  assert.equal(placeFromLocation(global.location), "Switzerland");
  assert.equal(global.title, "Website Design, Development, Hosting");

  const fed = parseListingTitle("US-FED-00000399634-Oilless Breathing Air Compressor - Deadline November 24,2026");
  assert.equal(fed.code, "US-FED-00000399634");
  assert.equal(fed.title, "Oilless Breathing Air Compressor");
  assert.equal(placeFromLocation(fed.location), "United States");

  const info = parseListingTitle("WD-16445 - USA (Tennessee) - Website Redesign and Brand Development Services - INFO ONLY, RFP NOT INCLUDED - Deadline November 23,2026");
  assert.equal(info.title, "Website Redesign and Brand Development Services");
  assert.equal(placeFromLocation(info.location), "Tennessee");

  const budget = parseListingTitle("WD-16442 - USA (Washington, DC) - GLOBAL - Website Upgrades and Maintenance Using WordPress CMS - Budget - 8600 to 20000 USD - Deadline November 20,2026");
  assert.equal(budget.title, "Website Upgrades and Maintenance Using WordPress CMS");
  assert.equal(placeFromLocation(budget.location), "Washington, DC");

  const canada = parseListingTitle("WD-16439 - Canada (Quebec) - WordPress Platform Managed Services - Deadline December 9,2026");
  assert.equal(canada.title, "WordPress Platform Managed Services");
  assert.equal(placeFromLocation(canada.location), "Quebec, Canada");
});

test("RSS items become RFPMart bids and skip other hosts", () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
  <item>
    <title>WD-16444 - USA (California) - Website Hosting Services - Deadline December 8,2026</title>
    <description>Vendor needs to provide website hosting for the City of Oakland. Remote work is allowed.</description>
    <pubDate>Sat, 07 Nov 2026 00:00:00 -0800</pubDate>
    <link>http://www.rfpmart.com/1196111-usa-california-website-hosting-rfp.html</link>
  </item>
  <item>
    <title>Not our site</title>
    <link>https://example.com/private</link>
    <pubDate>Sat, 07 Nov 2026 00:00:00 -0800</pubDate>
  </item>
  </channel></rss>`;
  const bids = parseFeed(xml, "https://www.rfpmart.com/web-design-and-development-rfp-bids.xml");
  assert.equal(bids.length, 1);
  assert.equal(bids[0].source, "RFPMart");
  assert.equal(bids[0].id, "rfp-1196111");
  assert.equal(bids[0].category, "Web Design and Development");
  assert.equal(bids[0].agency, "City of Oakland");
  assert.equal(bids[0].place, "California");
  assert.equal(bids[0].remote, true);
  assert.equal(bids[0].link, "https://www.rfpmart.com/1196111-usa-california-website-hosting-rfp.html");
  assert.equal(bids[0].posted, "2026-11-07");
  assert.equal(categoryFromFeedUrl("https://www.rfpmart.com/us-federal-rfp-bids.xml"), "US Federal");
  assert.equal(agencyFromText("nothing named here"), "");
});

test("HTML index listings and feed discovery stay on public pages", () => {
  const html = `
    <div class="rfpmartIN-descriptionCategory">
      <a href="1196506-us-fed-fa-18-basic-ordering-agreement.html">
        US-FED-00000399630-F/A-18 Basic Ordering Agreement - Deadline November 25,2026
      </a>
    </div>
    <div class="rfpmartIIc-categoryPostDetail">
      <span class="post-date">Tuesday, 10 November, 2026</span>
      <span class="expiry-date">Wednesday, 25 November, 2026</span>
    </div>
    <div class="counter"><span> 1 of 6939</span></div>
    <a href="https://www.rfpmart.com/software-system-and-application-rfp-bids.xml">software</a>
    <a href="https://www.rfpmart.com/state/usa-california-rfp-bids-bids.xml">state</a>
    <a href="https://www.rfpmart.com/country/canada-rfp-bids.xml">country</a>
    <a href="https://www.rfpmart.com/USA/hidden.xml">hidden</a>
  `;
  const bids = parseListingHtml(html, "https://www.rfpmart.com/");
  assert.equal(bids.length, 1);
  assert.equal(bids[0].title, "F/A-18 Basic Ordering Agreement");
  assert.equal(bids[0].posted, "2026-11-10");
  assert.equal(bids[0].due.slice(0, 10), "2026-11-25");
  assert.equal(parsePageCount(`<div class="counter"><span> 1 of 6939</span></div>`), 6939);
  const feeds = discoverFeeds(html);
  assert.deepEqual(feeds, ["https://www.rfpmart.com/software-system-and-application-rfp-bids.xml"]);
});

test("duplicate URLs and titles collapse", () => {
  const bids = dedupeBids([
    { link: "https://www.rfpmart.com/1-a.html", title: "Same Work", due: "2026-12-02T23:59:00-05:00" },
    { link: "https://www.rfpmart.com/1-a.html", title: "Same Work", due: "2026-12-02T23:59:00-05:00" },
    { link: "https://www.rfpmart.com/2-b.html", title: "Same Work", due: "2026-12-03T23:59:00-05:00" },
    { link: "https://www.rfpmart.com/3-c.html", title: "Other", due: "" },
  ]);
  assert.equal(bids.length, 2);
  assert.equal(bids[0].title, "Same Work");
  assert.equal(bids[1].title, "Other");
});

test("All bids prefers SAM.gov when the title or URL matches", () => {
  const merged = mergeBidLists(
    [{ id: "sam", title: "Website Hosting", link: "https://sam.gov/opp/abc/view", source: "SAM.gov" }],
    [
      { id: "rfp-1", title: "Website Hosting", link: "https://www.rfpmart.com/1-a.html", source: "RFPMart" },
      { id: "rfp-2", title: "Cable replacement", link: "https://www.rfpmart.com/2-b.html", source: "RFPMart" },
      { id: "rfp-3", title: "Cable replacement", link: "https://www.rfpmart.com/2-b.html", source: "RFPMart" },
    ],
  );
  assert.deepEqual(merged.map((bid) => bid.id), ["sam", "rfp-2"]);
});

test("claim notices stay small and the webhook URL cannot carry a secret", () => {
  const body = claimPayload(
    { id: "rfp-1", title: "Hosting", agency: "City of Oakland", due: "2026-12-08T23:59:00-05:00" },
    "2026-11-11T01:00:00Z",
    "not-an-email",
  );
  assert.deepEqual(body, {
    bidId: "rfp-1",
    title: "Hosting",
    agency: "City of Oakland",
    deadline: "2026-12-08T23:59:00-05:00",
    claimedAt: "2026-11-11T01:00:00Z",
  });
  const withEmail = claimPayload({ id: "1", title: "T", agency: "", due: "" }, "2026-11-11T00:00:00Z", "ada@itsworkplace.com");
  assert.equal(withEmail.contactEmail, "ada@itsworkplace.com");
  assert.equal(safeWebhookUrl(""), "");
  assert.equal(safeWebhookUrl("http://hooks.example/claim"), "");
  assert.equal(safeWebhookUrl("https://token:secret@hooks.example/claim"), "");
  assert.equal(safeWebhookUrl("https://hooks.example/claim"), "https://hooks.example/claim");
});

test("config.js publishes an empty claim webhook and no secret keys", () => {
  const text = fs.readFileSync(new URL("../assets/config.js", import.meta.url), "utf8");
  assert.match(text, /claimWebhookUrl:\s*""/);
  assert.doesNotMatch(text, /sk_live_|sk_test_|rk_live_|rk_test_|AKIA|BEGIN PRIVATE KEY/);
  assert.match(text, /stripePaymentLink:\s*"https:\/\/buy\.stripe\.com\//);
});
