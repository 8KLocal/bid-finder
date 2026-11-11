/** Tenant theme, alerts, coverage, and mailing. No API keys live here. */

const $ = (id) => document.getElementById(id);

export function tenantSlug() {
  const query = new URLSearchParams(location.search).get("tenant") || "";
  if (/^[a-z0-9-]{2,40}$/.test(query)) return query;
  const label = location.hostname.split(".")[0];
  if (label && !["www", "8klocal", "localhost", "127"].includes(label) && location.hostname.split(".").length > 2) {
    return label;
  }
  return "itsworkplace";
}

export async function loadTenant() {
  const slug = tenantSlug();
  let tenant = { slug: "itsworkplace", brand: "It's Workplace", apiBase: "", bidPriceCents: 2000, example: false };
  try {
    const res = await fetch(`tenants/${slug}.json`, { cache: "no-cache" });
    if (res.ok) tenant = await res.json();
  } catch { /* default brand stays */ }
  const colors = tenant.colors || {};
  const root = document.documentElement;
  if (colors.navy) root.style.setProperty("--navy", colors.navy);
  if (colors.red) root.style.setProperty("--red", colors.red);
  if (colors.blue) root.style.setProperty("--blue", colors.blue);
  if (colors.paper) root.style.setProperty("--paper", colors.paper);
  const name = document.querySelector(".brand-name");
  if (name && tenant.brand) {
    name.firstChild.textContent = tenant.brand;
  }
  if (tenant.brand && tenant.slug !== "itsworkplace") {
    document.title = `${tenant.brand} — public U.S. bids`;
  }
  if (tenant.example) {
    const bar = document.querySelector(".topbar-mid");
    if (bar) bar.textContent = "Example tenant — not a real customer";
  }
  const price = document.getElementById("bid-pay");
  if (price) {
    const dollars = ((tenant.bidPriceCents || 2000) / 100).toFixed(0);
    price.textContent = `Pay $${dollars} and write this bid`;
  }
  return tenant;
}

function api(tenant, path) {
  const base = String(tenant.apiBase || "").replace(/\/$/, "");
  if (base) return base + path;
  return new URL(path.replace(/^\//, ""), document.baseURI).href;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function bindProduct(tenant) {
  const signup = $("signup");
  if (signup) {
    signup.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("signup-status");
      status.textContent = "Sending the confirmation…";
      try {
        const { res, data } = await postJson(api(tenant, "/api/signup"), {
          tenant: tenant.slug,
          email: $("signup-email").value,
          company: $("signup-company").value,
          keywords: $("signup-keywords").value,
          naics: $("signup-naics").value,
          states: $("signup-states").value,
          sources: $("signup-sources").value,
          frequency: $("signup-frequency").value,
        });
        status.textContent = res.ok
          ? "Check your inbox to confirm. You will not get a digest until you do."
          : (data.error || "The alert service did not accept this signup.");
      } catch {
        status.textContent = "The alert service is not on this host. Set apiBase in the tenant file to the PHP server.";
      }
    });
  }

  const quoteBtn = $("mail-quote");
  const form = $("mail-form");
  if (quoteBtn && form) {
    quoteBtn.addEventListener("click", () => requestQuote(tenant, false));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      requestQuote(tenant, true);
    });
  }

  const params = new URLSearchParams(location.search);
  if (params.get("bid_paid") === "1" && params.get("session_id")) {
    pollOrder(tenant, params.get("session_id"), "bid");
  }
  if (params.get("mail_paid") === "1" && params.get("session_id")) {
    pollOrder(tenant, params.get("session_id"), "mail");
  }
}

async function requestQuote(tenant, pay) {
  const status = $("mail-status");
  const out = $("mail-quote-out");
  status.textContent = pay ? "Checking the file and opening Stripe…" : "Getting a quote…";
  const address = (prefix) => ({
    name: $(prefix + "-name").value,
    line1: $(prefix + "-line1").value,
    line2: $(prefix + "-line2").value,
    city: $(prefix + "-city").value,
    state: $(prefix + "-state").value,
    zip: $(prefix + "-zip").value,
  });
  try {
    let uploadId = "";
    let pages = 1;
    const file = $("mail-pdf").files?.[0];
    if ($("mail-use-draft").checked) {
      const draft = $("draft-text")?.value || "";
      const uploaded = await postJson(api(tenant, "/api/mail/upload"), { draft });
      if (!uploaded.res.ok) throw new Error(uploaded.data.error || "Could not prepare the draft.");
      uploadId = uploaded.data.uploadId;
      pages = uploaded.data.pages;
    } else if (file) {
      const body = new FormData();
      body.append("pdf", file);
      const res = await fetch(api(tenant, "/api/mail/upload"), { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not read the PDF.");
      uploadId = data.uploadId;
      pages = data.pages;
    } else {
      throw new Error("Choose a PDF or the open draft.");
    }
    const quoted = await postJson(api(tenant, "/api/mail/quote"), {
      tenant: tenant.slug,
      pages,
      mailClass: $("mail-class").value,
      returnReceipt: $("mail-receipt").checked,
    });
    if (!quoted.res.ok) throw new Error(quoted.data.error || "No quote.");
    const q = quoted.data;
    const money = (cents) => `$${(cents / 100).toFixed(2)}`;
    out.textContent = `Postage ${money(q.postage)} + return receipt ${money(q.returnReceipt)} + pages ${money(q.pages)} + service fee ${money(q.serviceFee)} = ${money(q.total)}. ${q.note}`;
    if (!pay) {
      status.textContent = "Quote only. Nothing has been mailed or charged.";
      return;
    }
    const checkout = await postJson(api(tenant, "/api/checkout/mail"), {
      tenant: tenant.slug,
      email: $("mail-email").value,
      uploadId,
      to: address("to"),
      from: address("from"),
      mailClass: $("mail-class").value,
      returnReceipt: $("mail-receipt").checked,
    });
    if (!checkout.res.ok || !checkout.data.url) throw new Error(checkout.data.error || "Stripe did not open.");
    location.assign(checkout.data.url);
  } catch (err) {
    status.textContent = err.message || "Mailing needs the PHP server.";
  }
}

async function pollOrder(tenant, sessionId, kind) {
  const status = kind === "mail" ? $("mail-status") : $("draft-status");
  if (status) status.textContent = "Confirming payment…";
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(api(tenant, "/api/orders/status?session_id=" + encodeURIComponent(sessionId)));
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.draft && $("draft-text")) {
        $("draft-text").value = data.draft;
        if ($("draft-editor")) $("draft-editor").hidden = false;
        if ($("draft-paywall")) $("draft-paywall").hidden = true;
        if (status) status.textContent = "AI draft, review before submitting. Our team was notified.";
        return;
      }
      if (res.ok && data.jobId && status) {
        status.textContent = `Paid. Mail job ${data.jobId}. We do not guarantee a delivery date.`;
        return;
      }
      if (status) status.textContent = data.status === "paid" ? "Payment confirmed. Still writing…" : (data.error || "Waiting for Stripe…");
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function payForBid(tenant, bid) {
  const status = $("draft-status");
  if (status) status.textContent = "Opening Stripe for this bid…";
  const { res, data } = await postJson(api(tenant, "/api/checkout/bid"), {
    tenant: tenant.slug,
    email: $("bid-email")?.value || $("claim-email")?.value || "",
    company: $("bid-company")?.value || "",
    capabilities: $("bid-capabilities")?.value || "",
    pastPerformance: $("bid-past")?.value || "",
    bid,
  });
  if (!res.ok || !data.url) {
    if (status) status.textContent = data.error || "Checkout needs the PHP server and STRIPE_SECRET_KEY.";
    return;
  }
  location.assign(data.url);
}

export function renderFreshness(sources) {
  const el = $("freshness");
  if (!el) return;
  el.innerHTML = (sources || []).map((source) => `<article>
    <h3>${escapeHtml(source.name)}</h3>
    <p><b>${Number(source.count || 0).toLocaleString()}</b> kept</p>
    <p>${escapeHtml(source.status || "")}${source.updated ? " · " + escapeHtml(String(source.updated).slice(0, 16)) : ""}</p>
    <p>${escapeHtml(source.reason || "")}</p>
  </article>`).join("");
}

export async function renderCoverage() {
  const note = $("coverage-note");
  const stats = $("coverage-stats");
  if (!note || !stats) return;
  try {
    const res = await fetch("data/sources/coverage.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("missing");
    const data = await res.json();
    const totals = data.totals || {};
    const verified = data.verified || {};
    const line = (label, key) => `<div><b>${Number(verified[key] || 0).toLocaleString()}</b><span>of ${Number(totals[key] || verified[key] || 0).toLocaleString()} ${label}</span></div>`;
    const priorityLine = (label, bucket, total) => {
      const counts = bucket || {};
      const ok = Number(counts.ok || 0);
      return `<div><b>${ok.toLocaleString()}</b><span>${label} with a public list read, of ${Number(total || 0).toLocaleString()} largest</span></div>`;
    };
    stats.innerHTML = [
      line("states", "state"),
      line("counties", "county"),
      line("municipalities", "place"),
      priorityLine("counties", data.priorityStatus?.county, data.priority?.counties),
      priorityLine("cities", data.priorityStatus?.place, data.priority?.places),
    ].join("");
    const bits = [data.disclaimer || "", data.priority?.note || "", data.specialsNote || ""].filter(Boolean);
    const county = data.priorityStatus?.county;
    const place = data.priorityStatus?.place;
    if (county && place) {
      bits.push(`Among the largest counties: ${county.ok || 0} read, ${county.blocked || 0} blocked, ${county["no-bid-page"] || 0} with no bid page, ${county["needs-adapter"] || 0} need another adapter, ${county.unseen || 0} not checked yet. Cities: ${place.ok || 0} read, ${place.blocked || 0} blocked, ${place["no-bid-page"] || 0} with no bid page, ${place["needs-adapter"] || 0} need another adapter, ${place.unseen || 0} not checked yet.`);
    }
    note.textContent = bits.join(" ");
  } catch {
    note.textContent = "Coverage figures are published with the daily feed.";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}
