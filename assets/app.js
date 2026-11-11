import { isPastDue } from "./deadlines.js";
import { fallbackDraft } from "./draft.js";
import { claimPayload, mergeBidLists, safeWebhookUrl } from "./list.js";
import { bindProduct, loadTenant, payForBid, renderCoverage, renderFreshness } from "./product.js";

const CORE = new Set(["541511", "541512", "541513", "541519", "518210", "511210", "519130"]);
const DIGITAL = /\b(websites?|web[- ]based|web[- ]apps?|web[- ]applications?|software|saas|mobile apps?|mobile applications?|application development|application software|information technology|information systems?|help[- ]desks?|cybersecurity|cyber security|cloud computing|devops|web hosting|data hosting|programmers?|software developers?|user interface|user experience|sharepoint|servicenow|salesforce|digital services?|computer systems?|custom computer)\b/i;
const PLAN_KEY = "iw-starter";
const CLAIM_KEY = "iw-claimed-bids";
const EMAIL_KEY = "iw-claim-email";
const DAY = 864e5;

const $ = (id) => document.getElementById(id);
const fileCfg = window.IW_CONFIG || {};

let cfg = { ...fileCfg };
let tenant = { slug: "itsworkplace", apiBase: "", bidPriceCents: 2000 };
let all = [];
let meta = {};
let activeBid = null;
let shown = 40;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function endpoint(rel) {
  if (!rel) return "";
  if (/^https?:\/\//i.test(rel)) return rel;
  return new URL(rel, document.baseURI).href;
}

function safeHttps(value, host) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === host) return url.toString();
  } catch { /* empty config is normal */ }
  return "";
}

function stripeReady() {
  return Boolean(
    cfg.stripePaymentLink ||
    cfg.checkoutConfigured ||
    (cfg.stripeBuyButtonId && cfg.stripePublishableKey)
  );
}

function readPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY) || "null"); }
  catch { return null; }
}
function planActive() { return Boolean(readPlan()?.active); }
function unlock(via) {
  localStorage.setItem(PLAN_KEY, JSON.stringify({ active: true, via, since: new Date().toISOString() }));
  renderPlan();
}
function clearPlan() {
  localStorage.removeItem(PLAN_KEY);
  renderPlan();
}

function daysLeft(iso) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return NaN;
  return (t - Date.now()) / DAY;
}

function claimStorageKey() {
  return tenant.slug && tenant.slug !== "itsworkplace" ? `${CLAIM_KEY}:${tenant.slug}` : CLAIM_KEY;
}

function readClaims() {
  try {
    const data = JSON.parse(localStorage.getItem(claimStorageKey()) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function claimEmail() {
  return ($("claim-email")?.value || localStorage.getItem(EMAIL_KEY) || "").trim();
}

function stillOpen(b) {
  return !isPastDue(b.deadline || b.due);
}

function phrase(s) {
  return String(s ?? "").replace(/\b(Of|The|And|For|A|An|In|On|At|To)\b/g, (w) => w.toLowerCase());
}

function formatDue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "See notice";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }) + " ET";
}

/** Older data files have no scope field. Mirror scripts/fetch_bids.py. */
function inScope(b) {
  if (b.scope === "general" || b.scope === "core" || b.scope === "related" || b.scope === "rfp") return true;
  if (b.source && b.source !== "SAM.gov") return true;
  if (b.source === "RFPMart" || b.scope === "rfp") return true;
  if (b.scope) return false;
  if (CORE.has(b.naics)) return true;
  const text = `${b.title || ""} ${b.summary || ""}`;
  return DIGITAL.test(text) || /\bIT\b/.test(text);
}

function filtersActive() {
  return Boolean(
    $("q").value.trim() || $("due").value || $("agency").value ||
    $("naics").value || $("setaside").value || $("source").value || $("state").value ||
    $("core").checked || $("claimed").checked
  );
}

function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const n = $("naics").value;
  const a = $("agency").value;
  const due = $("due").value;
  const sa = $("setaside").value;
  const source = $("source").value;
  const state = $("state").value;
  const coreOnly = $("core").checked;
  const claims = readClaims();
  const claimedOnly = $("claimed").checked;
  return all.filter((b) => {
    if (claimedOnly && !claims[b.id]) return false;
    if (source && (b.source || "SAM.gov") !== source) return false;
    if (state && (b.state || "") !== state) return false;
    if (coreOnly && b.scope !== "core" && !CORE.has(b.naics)) return false;
    if (n && b.naics !== n) return false;
    if (a && b.agency !== a) return false;
    if (sa === "__any" ? b.setAside === "None" : sa && b.setAside !== sa) return false;
    if (!stillOpen(b)) return false;
    if (due) {
      const d = daysLeft(b.deadline || b.due);
      if (!Number.isFinite(d)) return false;
      if (due === "31+" ? d <= 30 : d > +due) return false;
    }
    if (terms.length) {
      const hay = `${b.title} ${b.agency} ${b.subTier} ${b.office} ${b.summary} ${b.solicitation} ${b.naics} ${b.category || ""} ${b.place || ""} ${b.source || ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

function dueParts(iso) {
  if (!iso) return { cls: "", due: "No deadline listed", left: "No deadline listed" };
  const d = daysLeft(iso);
  if (!Number.isFinite(d)) {
    return { cls: "", due: "No deadline listed", left: "No deadline listed" };
  }
  const cls = d < 3 ? "soon" : d < 10 ? "mid" : "";
  const whole = Math.floor(d);
  const left = d < 1 ? "Due within 24 hours" : `${whole} ${whole === 1 ? "day" : "days"} left`;
  return { cls, due: `Due ${formatDue(iso)}`, left };
}

function render(resetPage = true) {
  if (resetPage) shown = 40;
  const rows = filtered();
  const visible = rows.slice(0, shown);
  const claims = readClaims();
  $("count").textContent = $("claimed").checked
    ? `${rows.length.toLocaleString()} claimed ${rows.length === 1 ? "bid" : "bids"} in this browser`
    : filtersActive()
      ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} open bids`
      : `${rows.length.toLocaleString()} open ${rows.length === 1 ? "bid" : "bids"}`;
  $("clear").hidden = !filtersActive();
  const list = $("list");
  if (!rows.length) {
    const noneClaimed = $("claimed").checked && Object.keys(claims).length === 0;
    list.innerHTML = noneClaimed
      ? '<p class="empty">You have not claimed a bid in this browser yet. Choose Claim this bid on a listing to save it here and open a draft.</p>'
      : '<p class="empty">No open bids match these filters. Clear them to see the full list.</p>';
    return;
  }
  const more = rows.length > visible.length
    ? `<p class="more"><button class="btn ghost" type="button" id="more">Show more</button></p>`
    : "";
  list.innerHTML = visible.map((b) => {
    const when = dueParts(b.deadline || b.due);
    const claimed = Boolean(claims[b.id]);
    const setAside = b.setAside && b.setAside !== "None"
      ? b.setAside.replace(/\s*\(FAR [^)]*\)/, "")
      : "";
    const who = [b.agency ? phrase(b.agency) : "", b.subTier && b.subTier !== b.agency ? phrase(b.subTier) : "", b.place ? phrase(b.place) : ""]
      .filter(Boolean)
      .join(" · ");
    const source = b.source || "SAM.gov";
    return `<article class="bid${claimed ? " claimed" : ""}">
      <div>
        <h3><a href="${esc(b.link || b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a></h3>
        <div class="sub">${esc(who || source)}</div>
        ${b.summary ? `<p class="sum">${esc(b.summary)}</p>` : ""}
        <div class="pills">
          <span class="pill">${esc(source)}</span>
          ${b.naics ? `<span class="pill">NAICS ${esc(b.naics)}${b.naicsLabel ? " · " + esc(b.naicsLabel) : ""}</span>` : ""}
          ${b.category ? `<span class="pill">${esc(b.category)}</span>` : ""}
          ${b.type ? `<span class="pill">${esc(b.type)}</span>` : ""}
          ${setAside ? `<span class="pill">${esc(setAside)}</span>` : ""}
          ${b.remote ? '<span class="pill remote">Remote</span>' : ""}
          ${claimed ? '<span class="pill claimed">Claimed</span>' : ""}
          ${b.solicitation ? `<span class="pill">#${esc(b.solicitation)}</span>` : ""}
        </div>
      </div>
      <div class="side">
        <div class="due ${when.cls}">${esc(when.due)}</div>
        <div class="left">${esc(when.left)}</div>
        <button class="btn${claimed ? " ghost" : ""}" type="button" data-claim="${esc(b.id)}" aria-pressed="${claimed ? "true" : "false"}">${claimed ? "Claimed" : "Claim this bid"}</button>
        <button class="btn ghost" type="button" data-fill="${esc(b.id)}">Fill this out with AI</button>
        <a class="btn ghost" href="${esc(b.link || b.url)}" target="_blank" rel="noopener">Original notice</a>
      </div>
    </article>`;
  }).join("") + more;
}

function fillSelect(sel, values, label = (v) => v) {
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label(v);
    sel.appendChild(o);
  }
}

function clearFilters() {
  $("q").value = "";
  $("hero-q").value = "";
  $("due").value = "";
  $("agency").value = "";
  $("naics").value = "";
  $("setaside").value = "";
  $("source").value = "";
  if ($("state")) $("state").value = "";
  $("core").checked = false;
  $("claimed").checked = false;
  render();
}

function showNotice(message, warn = false) {
  const el = $("notice");
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("warn", Boolean(warn) && Boolean(message));
}

function renderPlan() {
  const active = planActive();
  const state = $("plan-state");
  const clear = $("clear-plan");
  state.hidden = !active;
  clear.hidden = !active;
  if (active) {
    const portal = cfg.stripePortalLink
      ? ` <a href="${esc(cfg.stripePortalLink)}">Manage billing</a>.`
      : "";
    state.innerHTML = `Starter is active in this browser.${portal}`;
  }
}

function mountBuyButton() {
  const slot = $("buy-button-slot");
  if (!cfg.stripeBuyButtonId || !cfg.stripePublishableKey || slot.childElementCount) return;
  const script = document.createElement("script");
  script.src = "https://js.stripe.com/v3/buy-button.js";
  script.async = true;
  document.head.appendChild(script);
  const button = document.createElement("stripe-buy-button");
  button.setAttribute("buy-button-id", cfg.stripeBuyButtonId);
  button.setAttribute("publishable-key", cfg.stripePublishableKey);
  slot.appendChild(button);
}

async function loadConfig() {
  let remote = {};
  try {
    const res = await fetch(endpoint(fileCfg.publicConfigEndpoint || "api/public-config"), { cache: "no-store" });
    if (res.ok) remote = await res.json();
  } catch { /* GitHub Pages has no API. config.js still applies. */ }
  cfg = {
    ...fileCfg,
    stripePaymentLink: safeHttps(remote.stripePaymentLink || fileCfg.stripePaymentLink || "", "buy.stripe.com"),
    stripePublishableKey: /^pk_(test|live)_/.test(remote.stripePublishableKey || fileCfg.stripePublishableKey || "")
      ? (remote.stripePublishableKey || fileCfg.stripePublishableKey)
      : "",
    stripeBuyButtonId: /^buy_btn_/.test(remote.stripeBuyButtonId || fileCfg.stripeBuyButtonId || "")
      ? (remote.stripeBuyButtonId || fileCfg.stripeBuyButtonId)
      : "",
    stripePortalLink: safeHttps(remote.stripePortalLink || fileCfg.stripePortalLink || "", "billing.stripe.com"),
    checkoutConfigured: Boolean(remote.checkoutConfigured),
    aiConfigured: Boolean(remote.aiConfigured),
    planPriceLabel: fileCfg.planPriceLabel || "$29/month",
    claimWebhookUrl: safeWebhookUrl(fileCfg.claimWebhookUrl || ""),
  };
  mountBuyButton();
  renderPlan();
}

async function startCheckout(button) {
  const original = button ? button.textContent : "";
  if (button) {
    button.textContent = "Opening Stripe Checkout…";
    button.setAttribute("aria-busy", "true");
  }
  const restore = () => {
    if (!button) return;
    button.textContent = original;
    button.removeAttribute("aria-busy");
  };
  const fail = (message) => {
    restore();
    const err = $("checkout-error");
    if (message) {
      err.hidden = false;
      err.textContent = message;
    } else {
      err.hidden = true;
      err.textContent = "";
    }
    showDialog("checkout-dialog");
  };
  try {
    if (cfg.stripePaymentLink) {
      const url = new URL(cfg.stripePaymentLink);
      url.searchParams.set("client_reference_id", "itsworkplace-starter");
      window.location.assign(url.toString());
      return;
    }
    const res = await fetch(endpoint(cfg.stripeCheckoutEndpoint || "api/create-checkout-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (cfg.stripeBuyButtonId && cfg.stripePublishableKey) {
      restore();
      $("buy-button-slot").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const missing = !res.ok && (res.status === 404 || data.code === "STRIPE_NOT_CONFIGURED");
    fail(missing ? "" : (data.error || "Stripe did not return a Checkout link."));
  } catch {
    if (cfg.stripeBuyButtonId && cfg.stripePublishableKey) {
      restore();
      $("buy-button-slot").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    fail("");
  }
}

async function fillDraft(bid) {
  const status = $("draft-status");
  const text = $("draft-text");
  const progress = $("draft-progress");
  if (progress) progress.textContent = "Reading the public notice…";
  text.value = fallbackDraft(bid);
  if (progress) progress.textContent = "Template ready. AI writing waits for payment.";
  status.textContent = "AI draft, review before submitting. This template was built in your browser from the public notice and was not sent to a model. Nothing was submitted.";
}

function showDialog(id) {
  const next = $(id);
  for (const open of document.querySelectorAll("dialog[open]")) {
    if (open !== next) open.close();
  }
  if (!next.open) next.showModal();
}

function openDraft(bid, opts = {}) {
  activeBid = bid;
  $("draft-bid").textContent = bid.title;
  const locked = !opts.force;
  const paid = planActive();
  $("draft-paywall").hidden = !locked;
  $("draft-editor").hidden = locked;
  $("draft-billing").hidden = locked || paid;
  $("draft-title").textContent = opts.force ? "Filled-out draft" : "Fill this out with AI";
  $("claim-note").textContent = opts.note || "";
  if (!locked) fillDraft(bid);
  showDialog("draft-dialog");
}

function claimBid(bid) {
  const claims = readClaims();
  const first = !claims[bid.id];
  const email = claimEmail();
  if (email) localStorage.setItem(EMAIL_KEY, email);
  else localStorage.removeItem(EMAIL_KEY);
  const payload = claimPayload(bid, new Date().toISOString(), email);
  claims[bid.id] = { ...payload, tenant: tenant.slug || "itsworkplace" };
  localStorage.setItem(claimStorageKey(), JSON.stringify(claims));
  const webhook = safeWebhookUrl(cfg.claimWebhookUrl || (String(tenant.apiBase || "").startsWith("https://") ? `${String(tenant.apiBase).replace(/\/$/, "")}/api/claim` : ""));
  let note = "Claimed in this browser. Copy or download the draft. Nothing is submitted to a government portal.";
  if (webhook && first) note = "Claimed in this browser. Sending the team notice. Copy or download the draft. Nothing is submitted to a government portal.";
  if (!first) note = "Already claimed in this browser. Copy or download the draft. Nothing is submitted to a government portal.";
  render();
  openDraft(bid, { force: true, note });
  if (first && webhook) notifyClaim(payload, webhook);
}

async function notifyClaim(payload, url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(String(res.status));
    if (activeBid && activeBid.id === payload.bidId) {
      $("claim-note").textContent = "Claimed in this browser. The team notice was accepted. Copy or download the draft. Nothing was submitted to a government portal.";
    }
  } catch {
    if (activeBid && activeBid.id === payload.bidId) {
      $("claim-note").textContent = "Claimed in this browser. The team notice could not be delivered from this page. Copy or download the draft. Nothing was submitted to a government portal.";
    }
  }
}

async function applyCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const state = params.get("checkout");
  if (!state) return;
  if (state === "cancel") {
    showNotice("Checkout was canceled. You were not charged.", true);
  } else if (state === "success") {
    const sessionId = params.get("session_id");
    let verified = false;
    let rejected = false;
    if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      try {
        const res = await fetch(endpoint(cfg.verifyEndpoint || "api/verify-checkout") + "?session_id=" + encodeURIComponent(sessionId));
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.active) verified = true;
        else if (res.ok && data.active === false) rejected = true;
      } catch { /* Pages cannot verify. The success URL is the signal. */ }
    }
    if (rejected) {
      showNotice("Stripe has not marked this checkout complete, so AI fill-out stays locked.", true);
    } else {
      unlock(verified ? "verified" : "return");
      showNotice(verified
        ? "Payment received. Starter is active in this browser. Open any bid and choose Fill this out with AI."
        : "You’re back from Stripe Checkout. Starter is active in this browser. Open any bid and choose Fill this out with AI.");
    }
  }
  const url = new URL(location.href);
  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

async function loadPublishedFeed() {
  const res = await fetch("data/feed/index.json", { cache: "no-cache" });
  if (!res.ok) return null;
  const index = await res.json();
  const parts = await Promise.all((index.shards || []).map(async (file) => {
    const response = await fetch("data/feed/" + file, { cache: "no-cache" });
    if (!response.ok) return [];
    const data = await response.json();
    return data.bids || [];
  }));
  return { index, bids: parts.flat() };
}

async function init() {
  $("yr").textContent = new Date().getFullYear();
  tenant = await loadTenant();
  bindProduct(tenant);
  renderCoverage();
  const savedEmail = localStorage.getItem(EMAIL_KEY) || "";
  if (savedEmail && $("claim-email")) $("claim-email").value = savedEmail;
  await loadConfig();
  await applyCheckoutReturn();
  let sam = [];
  let rfp = [];
  let rfpMeta = {};
  let samFailed = false;
  let feedIndex = null;
  try {
    const published = await loadPublishedFeed();
    if (published && published.bids.length) {
      feedIndex = published.index;
      all = published.bids.filter((b) => b && inScope(b) && stillOpen(b));
    }
  } catch { /* Fall back to the older JSON files. */ }
  if (!feedIndex) {
  try {
    const res = await fetch("data/bids.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    meta = data.meta || {};
    sam = (data.bids || [])
      .filter((b) => inScope(b) && stillOpen({ ...b, source: b.source || "SAM.gov" }))
      .map((b) => ({ ...b, source: b.source || "SAM.gov" }));
  } catch {
    samFailed = true;
  }
  try {
    const res = await fetch("data/rfp-bids.json", { cache: "no-cache" });
    if (res.ok) {
      const data = await res.json();
      rfpMeta = data.meta || {};
      rfp = (data.bids || []).filter((b) => b && (b.source === "RFPMart" || b.scope === "rfp") && stillOpen({ ...b, source: "RFPMart" }))
        .map((b) => ({ ...b, source: "RFPMart" }));
    }
  } catch { /* The RFP file is optional until the collector has run. */ }
  if (samFailed && !rfp.length) {
    $("meta").textContent = "The bid list could not be loaded.";
    $("list").innerHTML = '<p class="empty">The public list is unavailable right now. Try again shortly.</p>';
    $("list").removeAttribute("aria-busy");
    return;
  }
  all = mergeBidLists(sam, rfp).sort((a, b) => {
    const ad = Date.parse(a.due);
    const bd = Date.parse(b.due);
    const aOk = Number.isFinite(ad);
    const bOk = Number.isFinite(bd);
    if (aOk && bOk) return ad - bd;
    if (aOk) return -1;
    if (bOk) return 1;
    return a.title.localeCompare(b.title);
  });
  }
  all.sort((a, b) => String(a.deadline || a.due || "9999").localeCompare(String(b.deadline || b.due || "9999")) || String(a.title).localeCompare(String(b.title)));
  $("stat-count").textContent = all.length.toLocaleString();
  $("stat-week").textContent = all.filter((b) => {
    const d = daysLeft(b.deadline || b.due);
    return Number.isFinite(d) && d <= 7;
  }).length.toLocaleString();
  $("stat-agencies").textContent = new Set(all.map((b) => b.agency).filter(Boolean)).size.toLocaleString();
  const stamp = feedIndex?.updated || meta.updated;
  const updated = stamp
    ? new Date(stamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET"
    : "the latest extract";
  const rfpCount = all.filter((b) => b.source === "RFPMart").length;
  const sourceNames = feedIndex
    ? (feedIndex.sources || []).map((source) => source.name).filter(Boolean)
    : [...new Set(all.map((b) => b.source || "SAM.gov"))];
  const sourceSelect = $("source");
  sourceSelect.innerHTML = '<option value="">All sources</option>';
  fillSelect(sourceSelect, [...new Set(sourceNames)]);
  const stateSelect = $("state");
  if (stateSelect) fillSelect(stateSelect, [...new Set(all.map((b) => b.state).filter(Boolean))].sort());
  if (feedIndex) renderFreshness(feedIndex.sources || []);
  $("meta").textContent = feedIndex
    ? `${all.length.toLocaleString()} public notices from the sources below · updated ${updated}. This is not every U.S. bid.`
    : `Public notices · ${updated}. This is not every U.S. bid.`;
  if (rfpMeta.blocked && !rfpCount) {
    showNotice("RFPMart did not return public listings, so All bids is showing SAM.gov notices.", true);
  }
  const labels = meta.featuredNaics || {};
  const naics = [...new Set(all.map((b) => b.naics).filter(Boolean))].sort((x, y) => (labels[y] ? 1 : 0) - (labels[x] ? 1 : 0) || x.localeCompare(y));
  fillSelect($("naics"), naics, (v) => v + (labels[v] ? " · " + labels[v] : ""));
  fillSelect($("agency"), [...new Set(all.map((b) => b.agency).filter(Boolean))].sort());
  const setAsides = [...new Set(all.map((b) => b.setAside))].filter((v) => v && v !== "None").sort();
  const any = document.createElement("option");
  any.value = "__any";
  any.textContent = "Any small-business set-aside";
  $("setaside").appendChild(any);
  fillSelect($("setaside"), setAsides, (v) => v.replace(/\s*\(FAR [^)]*\)/, ""));
  const coreOnlyUseful = all.some((b) => b.scope === "related");
  $("core").closest("label").hidden = !coreOnlyUseful;
  $("list").removeAttribute("aria-busy");
  render();
}

document.querySelectorAll("[data-all-bids]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    clearFilters();
    $("bids").scrollIntoView();
    history.replaceState(null, "", "#bids");
    $("q").focus();
  });
});

document.querySelectorAll("[data-claimed-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    $("q").value = "";
    $("hero-q").value = "";
    $("due").value = "";
    $("agency").value = "";
    $("naics").value = "";
    $("setaside").value = "";
    $("source").value = "";
    if ($("state")) $("state").value = "";
    $("core").checked = false;
    $("claimed").checked = true;
    render();
    $("bids").scrollIntoView();
    history.replaceState(null, "", "#bids");
  });
});

$("filters").addEventListener("submit", (event) => event.preventDefault());
$("hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  $("q").value = $("hero-q").value;
  $("bids").scrollIntoView();
  render();
});

["q", "naics", "agency", "due", "setaside", "source", "state", "core", "claimed"].forEach((id) => {
  $(id).addEventListener("input", render);
});
$("claim-email").addEventListener("change", () => {
  const email = $("claim-email").value.trim();
  if (email) localStorage.setItem(EMAIL_KEY, email);
  else localStorage.removeItem(EMAIL_KEY);
});
$("clear").addEventListener("click", clearFilters);
$("list").addEventListener("click", (event) => {
  if (event.target.closest("#more")) {
    shown += 40;
    render(false);
    return;
  }
  const claim = event.target.closest("[data-claim]");
  if (claim) {
    const bid = all.find((b) => b.id === claim.dataset.claim);
    if (bid) claimBid(bid);
    return;
  }
  const button = event.target.closest("[data-fill]");
  if (!button) return;
  const bid = all.find((b) => b.id === button.dataset.fill);
  if (bid) openDraft(bid);
});
document.querySelectorAll("[data-checkout]").forEach((button) => {
  button.addEventListener("click", () => startCheckout(button));
});
$("bid-pay")?.addEventListener("click", () => { if (activeBid) payForBid(tenant, activeBid); });
$("draft-close").addEventListener("click", () => $("draft-dialog").close());
$("checkout-close").addEventListener("click", () => $("checkout-dialog").close());
$("checkout-dismiss").addEventListener("click", () => $("checkout-dialog").close());
$("draft-regen").addEventListener("click", () => { if (activeBid) fillDraft(activeBid); });
$("draft-copy").addEventListener("click", async () => {
  const value = $("draft-text").value;
  try {
    await navigator.clipboard.writeText(value);
    $("draft-status").textContent = "Copied. Paste it into your own document. It has not been submitted.";
  } catch {
    $("draft-text").focus();
    $("draft-text").select();
    $("draft-status").textContent = "Select the draft and copy it. It has not been submitted.";
  }
});
$("draft-download").addEventListener("click", () => {
  const blob = new Blob([$("draft-text").value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "its-workplace-draft.txt";
  a.click();
  URL.revokeObjectURL(url);
});
$("clear-plan").addEventListener("click", () => {
  clearPlan();
  showNotice("Starter was removed from this browser. You can subscribe again whenever you want.", true);
});

init();
