/**
 * Browser check for the public listing. Not part of `npm test` (needs Chrome).
 * Usage: node scripts/dev-server.mjs  then  node tests/e2e.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base = process.env.E2E_BASE || "http://127.0.0.1:8080/";
const outDir = process.env.E2E_OUT || "/tmp/iw-e2e";
fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--remote-debugging-port=9222",
  "--user-data-dir=/tmp/chrome-iw-e2e",
  "about:blank",
], { stdio: "ignore" });

function die(message) {
  console.error(message);
  chrome.kill("SIGKILL");
  process.exit(1);
}

let version;
for (let i = 0; i < 40; i++) {
  try {
    version = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json());
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!version) die("Chrome DevTools did not open");
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("devtools socket failed")));
});

let seq = 0;
const pending = new Map();
const waits = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  for (const wait of waits) wait(msg);
});

function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}

function waitEvent(sessionId, method, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for " + method)), timeout);
    const check = (msg) => {
      if (msg.method === method && msg.sessionId === sessionId) {
        clearTimeout(timer);
        waits.splice(waits.indexOf(check), 1);
        resolve(msg);
      }
    };
    waits.push(check);
  });
}

const target = await send("Target.createTarget", { url: "about:blank" });
const sessionId = (await send("Target.attachToTarget", { targetId: target.result.targetId, flatten: true })).result.sessionId;
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);

const loaded = waitEvent(sessionId, "Page.loadEventFired");
await send("Page.navigate", { url: base }, sessionId);
await loaded;

async function evalJs(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.result.exceptionDetails) {
    die("page error: " + JSON.stringify(result.result.exceptionDetails));
  }
  return result.result.result.value;
}

async function waitFor(expression, label) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (await evalJs(expression)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  die("timed out: " + label);
}

await waitFor("document.querySelectorAll('article.bid').length > 0 && Number(document.querySelector('#stat-count').textContent.replace(/,/g,'')) > 0", "bids");
const desktop = await evalJs(`(() => {
  const text = document.body.innerText;
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || "",
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    bids: document.querySelectorAll("article.bid").length,
    total: Number(document.querySelector("#stat-count").textContent.replace(/,/g, "")),
    heading: document.querySelector("#bids h2").textContent,
    count: document.querySelector("#count").textContent,
    brand: document.querySelector(".brand-name").innerText,
    hasOldBrand: /Q8|q8marketing/i.test(document.documentElement.innerHTML),
    checkout: [...document.querySelectorAll("[data-checkout]")].map(el => el.textContent.trim()),
    fill: document.querySelector("[data-ai]")?.textContent.trim() || document.querySelector(".waitlist")?.textContent.trim() || "",
    claim: document.querySelector("[data-claim]")?.textContent.trim() || "",
    claimTip: document.querySelector("[data-claim]")?.title || "",
    savedNav: document.querySelector("[data-claimed-view]")?.textContent.trim() || "",
    deadlines: [...document.querySelectorAll("#due option")].map((option) => option.textContent.trim()),
    pastDueInNav: /past due/i.test(document.querySelector("nav")?.innerText || ""),
    pastDueLink: !!document.querySelector('footer a[href="#past-due"]'),
    hero: document.querySelector("h1")?.textContent || "",
    listUnderFilters: !!(document.querySelector("#filters").compareDocumentPosition(document.querySelector("#list")) & Node.DOCUMENT_POSITION_FOLLOWING) && !document.querySelector("#filters ~ #freshness"),
    sourcesCollapsed: document.querySelector("#coverage")?.tagName === "DETAILS" && !document.querySelector("#coverage").open && !!(document.querySelector("#list").compareDocumentPosition(document.querySelector("#freshness")) & Node.DOCUMENT_POSITION_FOLLOWING),
    mailButton: document.querySelector("#mail-submit")?.textContent.trim() || "",
    mailQuote: document.querySelector("#mail-quote-out")?.innerText || "",
    source: !!document.querySelector("#source"),
    signup: !!document.querySelector("#signup"),
    coreChecked: document.querySelector("#core").checked,
  };
})()`);
console.log("desktop", desktop);
if (desktop.hasOldBrand) die("old brand is still in the page");
if (!desktop.title.includes("It's Workplace")) die("title");
if (!/Federal, state, county, and city/.test(desktop.description)) die("description: " + desktop.description);
if (!desktop.description.includes("offshore team")) die("description dropped the offshore line");
if (desktop.canonical !== "https://8klocal.github.io/bid-finder/") die("canonical: " + desktop.canonical);
if (desktop.heading !== "All bids") die("missing All bids heading");
if (desktop.coreChecked) die("software filter should be off so All bids is the full list");
if (desktop.total < 20) die("expected the full matching list, saw " + desktop.total);
if (!desktop.signup) die("missing signup");
if (!/Fill out with AI, \$20|Coming online soon, join the waitlist/.test(desktop.fill)) die("missing AI action: " + desktop.fill);
if (!desktop.listUnderFilters) die("bid list is not directly under the filters");
if (!desktop.sourcesCollapsed) die("source cards are not collapsed under the list");
if (desktop.mailButton !== "Coming online soon") die("mail button: " + desktop.mailButton);
const quoteLines = desktop.mailQuote.split("\n").map((line) => line.trim()).filter(Boolean);
const postageAt = quoteLines.findIndex((line) => line.startsWith("Postage"));
const mailingAt = quoteLines.findIndex((line) => line.startsWith("Mailing charge"));
const pagesAt = quoteLines.findIndex((line) => line.startsWith("Per-page printing"));
if (!(postageAt >= 0 && postageAt < mailingAt && mailingAt < pagesAt)) die("quote line order: " + desktop.mailQuote);
if (!desktop.mailQuote.includes("$5.00")) die("mailing charge is not $5.00");
if (desktop.claim !== "Save to my bids") die("missing save action: " + desktop.claim);
if (desktop.claimTip !== "Saves this bid to My claimed bids on this device. Add your email and our team will reach out to help.") die("save tooltip");
if (desktop.savedNav !== "My saved bids") die("nav label: " + desktop.savedNav);
if (desktop.pastDueInNav) die("past due is in the main nav");
if (!desktop.pastDueLink) die("missing past-due footer link");
if (!/every category/i.test(desktop.hero)) die("hero is still category-specific: " + desktop.hero);
if (!desktop.deadlines.includes("Any open") || !desktop.deadlines.includes("Due today") || !desktop.deadlines.includes("No deadline listed") || !desktop.deadlines.includes("Due later")) die("deadline options: " + desktop.deadlines.join(" | "));
if (!desktop.source) die("missing source filter");
if (!desktop.checkout.some((label) => label.includes("Continue to checkout"))) die("missing checkout");

await evalJs(`document.querySelector("#q").value = "cleanig"; document.querySelector("#q").dispatchEvent(new Event("input", { bubbles: true }));`);
await waitFor(`document.querySelector("#count").textContent.includes("of") && document.querySelectorAll("article.bid").length > 0 && /Did you mean/i.test(document.querySelector("#list").innerText)`, "fuzzy search");
const fuzzy = await evalJs(`document.querySelector("#list").innerText`);
if (!/clean|janitor|custod/i.test(fuzzy)) die("cleanig did not find cleaning or janitorial notices");
const suggestOpen = await evalJs(`!document.querySelector("#q-suggest").hidden && document.querySelector("#q-suggest").innerText.length > 0`);
if (!suggestOpen) die("search suggestions did not open");
await evalJs(`document.querySelector("#clear").click()`);
await waitFor(`!document.querySelector("#count").textContent.includes("of")`, "clear fuzzy");

await evalJs(`document.querySelector("#q").value = "software"; document.querySelector("#q").dispatchEvent(new Event("input", { bubbles: true }));`);
await waitFor("document.querySelector('#count').textContent.includes('of')", "filter count");
const filtered = await evalJs(`Number((document.querySelector("#count").textContent.match(/\\d[\\d,]*/) || ["0"])[0].replace(/,/g, ""))`);
console.log("filtered software", filtered);
if (!(filtered > 0 && filtered < desktop.total)) die("keyword filter did not narrow the list");

await evalJs(`document.querySelector("#clear").click()`);
await waitFor(`!document.querySelector("#count").textContent.includes("of")`, "clear filters");

await evalJs(`document.querySelector("#source").value = "RFPMart"; document.querySelector("#source").dispatchEvent(new Event("input", { bubbles: true }));`);
await waitFor(`document.querySelector("#count").textContent.includes("of") && document.body.innerText.includes("RFPMart")`, "rfp source");
const rfpShown = await evalJs(`document.querySelectorAll("article.bid").length`);
console.log("rfpmart filter", rfpShown);
if (rfpShown < 1) die("RFPMart source filter showed no bids");
const rfpCard = await evalJs(`document.querySelector("article.bid").innerText`);
if (!rfpCard.includes("RFPMart")) die("RFPMart card missing source");
await evalJs(`document.querySelector("#clear").click()`);
await waitFor(`!document.querySelector("#count").textContent.includes("of")`, "clear source");

await evalJs(`document.querySelector("a[href^='#bid=']").click()`);
await waitFor("document.querySelector('#bid-dialog').open", "bid detail");
await shot("bid-detail.png");
const detail = await evalJs(`({
  open: document.querySelector("#bid-dialog").open,
  title: document.querySelector("#bid-dialog-title").textContent,
  facts: document.querySelector("#bid-facts").innerText,
  summary: document.querySelector("#bid-summary").textContent.length,
  claim: document.querySelector("#bid-dialog-claim").textContent,
  ai: document.querySelector("#bid-dialog-ai").hidden ? document.querySelector("#bid-dialog-wait").innerText : document.querySelector("#bid-dialog-ai").textContent,
  original: document.querySelector("#bid-dialog-original").target,
  hash: location.hash,
})`);
console.log("detail", detail.title, detail.hash);
if (!detail.open || !detail.title) die("detail panel did not open");
if (!detail.hash.startsWith("#bid=")) die("detail is not linkable: " + detail.hash);
if (!/Agency|Place|Due/.test(detail.facts)) die("detail is missing the notice facts");
if (detail.summary < 10) die("detail is missing the description");
if (detail.claim !== "Save to my bids") die("detail save button");
if (!/Coming online soon/.test(detail.ai)) die("detail should offer the waitlist until the API is configured: " + detail.ai);
const aiHidden = await evalJs(`document.querySelector("#bid-dialog-ai").hidden === true`);
if (!aiHidden) die("AI pay button is visible while the API is not configured");
if (detail.original !== "_blank") die("original notice is not a new-tab link");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
await waitFor("!document.querySelector('#bid-dialog').open && !location.hash.startsWith('#bid=')", "escape closes detail");

await evalJs(`document.querySelector("[data-claim]").click()`);
await waitFor("document.querySelector('#draft-dialog').open && !document.querySelector('#draft-editor').hidden && document.querySelector('#draft-text').value.length > 80", "claim draft");
await shot("desktop-draft.png");
const draft = await evalJs(`({
  open: document.querySelector("#draft-dialog").open,
  text: document.querySelector("#draft-text").value.slice(0, 240),
  status: document.querySelector("#draft-status").textContent,
  note: document.querySelector("#claim-note").textContent,
  copy: !!document.querySelector("#draft-copy"),
  download: !!document.querySelector("#draft-download"),
  claims: Object.keys(JSON.parse(localStorage.getItem("iw-claimed-bids") || "{}")).length,
})`);
console.log("draft status", draft.status);
if (!draft.copy || !draft.download) die("draft is missing copy or download");
if (draft.claims !== 1) die("claim was not saved in this browser");
if (!/NOT SUBMITTED|not been submitted|Nothing was submitted|Nothing is submitted/i.test(draft.text + " " + draft.status + " " + draft.note)) {
  die("draft does not say it is unsubmitted");
}
await evalJs(`document.querySelector("#draft-dialog").close()`);
await evalJs(`document.querySelector("#alerts").scrollIntoView({ behavior: "instant", block: "start" })`);
await shot("desktop-signup.png");
await evalJs(`document.querySelector("#signup-email").value = "ada@example.com"; document.querySelector("#signup-company").value = "Ada Contracting";`);
await shot("desktop-signup-filled.png");
await evalJs(`document.querySelector("#bids").scrollIntoView({ behavior: "instant", block: "start" })`);
await waitFor(`document.querySelector("[data-claim]").textContent.includes("Saved")`, "saved label");

await evalJs(`document.querySelector(".waitlist").click()`);
await waitFor("location.hash === '#alerts' && !document.querySelector('#draft-dialog').open", "waitlist");
const payLink = await evalJs(`window.IW_CONFIG && window.IW_CONFIG.stripePaymentLink`);
if (!String(payLink).startsWith("https://buy.stripe.com/")) die("expected the public Stripe payment link");

async function shot(name) {
  const png = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(path.join(outDir, name), Buffer.from(png.result.data, "base64"));
}
await shot("desktop-checkout.png");
await evalJs(`document.querySelector("#checkout-dialog").close()`);

await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
}, sessionId);
await evalJs(`window.scrollTo(0, 0)`);
await shot("mobile-top.png");
await evalJs(`document.querySelector("#bids").scrollIntoView()`);
await new Promise((r) => setTimeout(r, 200));
await shot("mobile-bids.png");
await evalJs(`document.querySelector("a[href^='#bid=']").click()`);
await waitFor("document.querySelector('#bid-dialog').open", "mobile detail");
await evalJs(`document.querySelector("#bid-dialog-claim").scrollIntoView({ block: "center" })`);
await shot("mobile-bid-detail.png");
const mobileDetail = await evalJs(`({
  open: document.querySelector("#bid-dialog").open,
  width: document.querySelector("#bid-dialog").getBoundingClientRect().width,
})`);
if (!mobileDetail.open || mobileDetail.width > 390) die("detail panel is wider than the phone: " + mobileDetail.width);
await evalJs(`document.querySelector("#bid-dialog").close()`);

await send("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);
await evalJs(`window.scrollTo(0, 0)`);
await shot("desktop-top.png");
await evalJs(`document.querySelector("#pricing").scrollIntoView({ behavior: "instant", block: "start" })`);
await shot("desktop-pricing.png");
await evalJs(`document.querySelector('footer a[href="#past-due"]').click()`);
await waitFor(`document.querySelector("#past-count").textContent.includes("closed") && document.querySelector("#past-due").innerText.includes("not in the open list")`, "past due view");
const grammar = await evalJs(`[...document.querySelectorAll(".left")].some(el => el.textContent === "1 days left")`);
if (grammar) die("day count should be singular");

await evalJs(`document.querySelector("#mail-submit").scrollIntoView({ behavior: "instant", block: "center" })`);
await shot("mail-quote.png");
const mailShot = await evalJs(`document.querySelector("#mail-quote-out").innerText.includes("Mailing charge") && document.querySelector("#mail-submit").textContent.includes("Coming online soon")`);
if (!mailShot) die("mail quote was not on the page");
const searchLoad = waitEvent(sessionId, "Page.loadEventFired");
await send("Page.navigate", { url: new URL("?q=cleanig", base).href }, sessionId);
await searchLoad;
await waitFor(`document.querySelector("#q").value === "cleanig" && /clean|janitor|custod/i.test(document.querySelector("#list").innerText)`, "search action");
console.log("e2e ok", desktop.bids, "bids");
ws.close();
chrome.kill("SIGKILL");
