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
  while (Date.now() - started < 10000) {
    if (await evalJs(expression)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  die("timed out: " + label);
}

await waitFor("document.querySelectorAll('article.bid').length > 0", "bids");
const desktop = await evalJs(`(() => {
  const text = document.body.innerText;
  return {
    title: document.title,
    bids: document.querySelectorAll("article.bid").length,
    heading: document.querySelector("#bids h2").textContent,
    count: document.querySelector("#count").textContent,
    brand: document.querySelector(".brand-name").innerText,
    hasOldBrand: /Q8|q8marketing/i.test(document.documentElement.innerHTML),
    checkout: [...document.querySelectorAll("[data-checkout]")].map(el => el.textContent.trim()),
    fill: document.querySelector("[data-fill]")?.textContent.trim() || "",
    coreChecked: document.querySelector("#core").checked,
  };
})()`);
console.log("desktop", desktop);
if (desktop.hasOldBrand) die("old brand is still in the page");
if (!desktop.title.includes("It's Workplace")) die("title");
if (desktop.heading !== "All bids") die("missing All bids heading");
if (desktop.coreChecked) die("software filter should be off so All bids is the full list");
if (desktop.bids < 20) die("expected the full matching list, saw " + desktop.bids);
if (!desktop.fill.includes("Fill this out with AI")) die("missing fill action");
if (!desktop.checkout.some((label) => label.includes("Continue to checkout"))) die("missing checkout");

await evalJs(`document.querySelector("#q").value = "software"; document.querySelector("#q").dispatchEvent(new Event("input", { bubbles: true }));`);
await waitFor("document.querySelector('#count').textContent.includes('of')", "filter count");
const filtered = await evalJs(`document.querySelectorAll("article.bid").length`);
console.log("filtered software", filtered);
if (!(filtered > 0 && filtered < desktop.bids)) die("keyword filter did not narrow the list");

await evalJs(`document.querySelector("#clear").click()`);
await waitFor(`document.querySelectorAll("article.bid").length === ${desktop.bids}`, "clear filters");

await evalJs(`document.querySelector("[data-fill]").click()`);
await waitFor("document.querySelector('#draft-dialog').open && document.querySelector('#draft-text').value.length > 80", "draft");
await shot("desktop-draft.png");
const draft = await evalJs(`({
  open: document.querySelector("#draft-dialog").open,
  text: document.querySelector("#draft-text").value.slice(0, 240),
  status: document.querySelector("#draft-status").textContent,
})`);
console.log("draft status", draft.status);
if (!/NOT SUBMITTED|not been submitted|Nothing was submitted/i.test(draft.text + " " + draft.status)) {
  die("draft does not say it is unsubmitted");
}

await evalJs(`document.querySelector("#draft-billing [data-checkout]").click()`);
await waitFor("document.querySelector('#checkout-dialog').open", "checkout dialog");
const checkoutText = await evalJs("document.querySelector('#checkout-dialog').innerText");
if (!checkoutText.includes("STRIPE_SECRET_KEY") || !checkoutText.includes("STRIPE_PRICE_ID") || !checkoutText.includes("stripePaymentLink")) {
  die("checkout help is missing the env setup");
}
if (!checkoutText.includes("$29/month")) die("price missing");

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

await send("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);
await evalJs(`window.scrollTo(0, 0)`);
await shot("desktop-top.png");
await evalJs(`document.querySelector("#pricing").scrollIntoView({ behavior: "instant", block: "start" })`);
await shot("desktop-pricing.png");
const grammar = await evalJs(`[...document.querySelectorAll(".left")].some(el => el.textContent === "1 days left")`);
if (grammar) die("day count should be singular");

console.log("e2e ok", desktop.bids, "bids");
ws.close();
chrome.kill("SIGKILL");
