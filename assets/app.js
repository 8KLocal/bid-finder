import { fallbackDraft, modelMessages } from "./draft.js";

const CORE = new Set(["541511", "541512", "541513", "541519", "518210", "511210", "519130"]);
const DIGITAL = /\b(websites?|web[- ]based|web[- ]apps?|web[- ]applications?|software|saas|mobile apps?|mobile applications?|application development|application software|information technology|information systems?|help[- ]desks?|cybersecurity|cyber security|cloud computing|devops|web hosting|data hosting|programmers?|software developers?|user interface|user experience|sharepoint|servicenow|salesforce|digital services?|computer systems?|custom computer)\b/i;
const PLAN_KEY = "iw-starter";
const KEY_SESSION = "iw-model-key";
const DAY = 864e5;

const $ = (id) => document.getElementById(id);
const fileCfg = window.IW_CONFIG || {};

let cfg = { ...fileCfg };
let all = [];
let meta = {};
let activeBid = null;

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

function daysLeft(iso) { return (new Date(iso) - Date.now()) / DAY; }

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
  if (b.scope === "core" || b.scope === "related") return true;
  if (b.scope) return false;
  if (CORE.has(b.naics)) return true;
  const text = `${b.title || ""} ${b.summary || ""}`;
  return DIGITAL.test(text) || /\bIT\b/.test(text);
}

function filtersActive() {
  return Boolean(
    $("q").value.trim() || $("due").value || $("agency").value ||
    $("naics").value || $("setaside").value || $("core").checked
  );
}

function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const n = $("naics").value;
  const a = $("agency").value;
  const due = $("due").value;
  const sa = $("setaside").value;
  const coreOnly = $("core").checked;
  return all.filter((b) => {
    if (coreOnly && b.scope !== "core" && !CORE.has(b.naics)) return false;
    if (n && b.naics !== n) return false;
    if (a && b.agency !== a) return false;
    if (sa === "__any" ? b.setAside === "None" : sa && b.setAside !== sa) return false;
    if (due) {
      const d = daysLeft(b.due);
      if (due === "31+" ? d <= 30 : d > +due) return false;
    }
    if (terms.length) {
      const hay = `${b.title} ${b.agency} ${b.subTier} ${b.office} ${b.summary} ${b.solicitation} ${b.naics}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

function render() {
  const rows = filtered();
  $("count").textContent = filtersActive()
    ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} open bids`
    : `${rows.length.toLocaleString()} open ${rows.length === 1 ? "bid" : "bids"}`;
  $("clear").hidden = !filtersActive();
  const list = $("list");
  if (!rows.length) {
    list.innerHTML = '<p class="empty">No open bids match these filters. Clear them to see the full list.</p>';
    return;
  }
  list.innerHTML = rows.map((b) => {
    const d = daysLeft(b.due);
    const cls = d < 3 ? "soon" : d < 10 ? "mid" : "";
    const whole = Math.floor(d);
    const left = d < 1 ? "Due within 24 hours" : `${whole} ${whole === 1 ? "day" : "days"} left`;
    const setAside = b.setAside && b.setAside !== "None"
      ? b.setAside.replace(/\s*\(FAR [^)]*\)/, "")
      : "";
    return `<article class="bid">
      <div>
        <h3><a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.title)}</a></h3>
        <div class="sub">${esc(phrase(b.agency))}${b.subTier && b.subTier !== b.agency ? " · " + esc(phrase(b.subTier)) : ""}${b.place ? " · " + esc(phrase(b.place)) : ""}</div>
        ${b.summary ? `<p class="sum">${esc(b.summary)}</p>` : ""}
        <div class="pills">
          <span class="pill">NAICS ${esc(b.naics)}${b.naicsLabel ? " · " + esc(b.naicsLabel) : ""}</span>
          <span class="pill">${esc(b.type)}</span>
          ${setAside ? `<span class="pill">${esc(setAside)}</span>` : ""}
          ${b.remote ? '<span class="pill remote">Remote</span>' : ""}
          ${b.solicitation ? `<span class="pill">#${esc(b.solicitation)}</span>` : ""}
        </div>
      </div>
      <div class="side">
        <div class="due ${cls}">Due ${esc(formatDue(b.due))}</div>
        <div class="left">${esc(left)}</div>
        <a class="btn ghost" href="${esc(b.link)}" target="_blank" rel="noopener">Official notice</a>
        <button class="btn" type="button" data-fill="${esc(b.id)}">Fill this out with AI</button>
      </div>
    </article>`;
  }).join("");
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
  $("core").checked = false;
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

async function draftWithBrowserKey(bid, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.3, messages: modelMessages(bid) }),
  });
  const data = await res.json().catch(() => ({}));
  const text = data.choices?.[0]?.message?.content;
  if (!res.ok || !text) {
    throw new Error(data.error?.message || "The model key was rejected.");
  }
  return String(text).trim();
}

async function fillDraft(bid) {
  const status = $("draft-status");
  const text = $("draft-text");
  text.value = "Preparing a draft from the public notice…";
  status.textContent = "Working from the official notice fields. Nothing is submitted.";
  const key = ($("draft-key").value || "").trim();
  if (key) sessionStorage.setItem(KEY_SESSION, key);
  if (key) {
    try {
      text.value = await draftWithBrowserKey(bid, key);
      status.textContent = "Draft written with the model key in this browser. Review it, then submit it yourself if you choose to. Nothing was sent to a government portal.";
      return;
    } catch (err) {
      status.textContent = `${err.message} Showing the structured draft instead.`;
    }
  }
  try {
    const res = await fetch(endpoint(cfg.aiDraftEndpoint || "api/draft"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bid }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.draft) {
        text.value = data.draft;
        status.textContent = "Draft written by the configured model from the public notice. It has not been submitted anywhere.";
        return;
      }
    }
  } catch { /* static host, or the API is not deployed */ }
  text.value = fallbackDraft(bid);
  const why = cfg.aiConfigured
    ? "The draft service did not return a model draft."
    : "No model key is configured. Set AI_API_KEY on the draft service, or paste a key under “Use your own model key.”";
  status.textContent = `${why} This structured draft was built in your browser from the public notice and was not sent to a model. Nothing was submitted.`;
}

function showDialog(id) {
  const next = $(id);
  for (const open of document.querySelectorAll("dialog[open]")) {
    if (open !== next) open.close();
  }
  if (!next.open) next.showModal();
}

function openDraft(bid) {
  activeBid = bid;
  $("draft-bid").textContent = bid.title;
  const locked = stripeReady() && !planActive();
  const paid = planActive();
  $("draft-paywall").hidden = !locked;
  $("draft-editor").hidden = locked;
  $("draft-billing").hidden = locked || paid;
  $("draft-key").value = sessionStorage.getItem(KEY_SESSION) || "";
  if (!locked) fillDraft(bid);
  showDialog("draft-dialog");
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

async function init() {
  $("yr").textContent = new Date().getFullYear();
  await loadConfig();
  await applyCheckoutReturn();
  try {
    const res = await fetch("data/bids.json", { cache: "no-cache" });
    const data = await res.json();
    meta = data.meta || {};
    all = (data.bids || []).filter((b) => inScope(b) && new Date(b.due) > Date.now());
  } catch {
    $("meta").textContent = "The bid list could not be loaded.";
    $("list").innerHTML = '<p class="empty">The public list is unavailable right now. Try again shortly.</p>';
    $("list").removeAttribute("aria-busy");
    return;
  }
  $("stat-count").textContent = all.length.toLocaleString();
  $("stat-week").textContent = all.filter((b) => daysLeft(b.due) <= 7).length.toLocaleString();
  $("stat-agencies").textContent = new Set(all.map((b) => b.agency).filter(Boolean)).size.toLocaleString();
  const updated = meta.updated
    ? new Date(meta.updated).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET"
    : "the latest extract";
  const source = meta.sourceUrl
    ? `<a href="${esc(meta.sourceUrl)}" target="_blank" rel="noopener">SAM.gov public data</a>`
    : "SAM.gov public data";
  $("meta").innerHTML = `Every matching open opportunity · ${source} · updated ${esc(updated)}`;
  const labels = meta.featuredNaics || {};
  const naics = [...new Set(all.map((b) => b.naics))].sort((x, y) => (labels[y] ? 1 : 0) - (labels[x] ? 1 : 0) || x.localeCompare(y));
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

$("filters").addEventListener("submit", (event) => event.preventDefault());
$("hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  $("q").value = $("hero-q").value;
  $("bids").scrollIntoView();
  render();
});

["q", "naics", "agency", "due", "setaside", "core"].forEach((id) => {
  $(id).addEventListener("input", render);
});
$("clear").addEventListener("click", clearFilters);
$("list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fill]");
  if (!button) return;
  const bid = all.find((b) => b.id === button.dataset.fill);
  if (bid) openDraft(bid);
});
document.querySelectorAll("[data-checkout]").forEach((button) => {
  button.addEventListener("click", () => startCheckout(button));
});
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
