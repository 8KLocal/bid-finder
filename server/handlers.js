/**
 * Stripe Checkout and optional model drafting.
 * Secret keys are read from the environment at call time and are never returned.
 */
import { modelMessages } from "../assets/draft.js";

const PAYMENT_HOSTS = new Set(["buy.stripe.com"]);
const PORTAL_HOSTS = new Set(["billing.stripe.com"]);
const CHECKOUT_HOSTS = new Set(["checkout.stripe.com"]);

export function stripeHttps(value, hosts) {
  if (!value || typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !hosts.has(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function siteBase() {
  return (process.env.PUBLIC_SITE_URL || "https://8klocal.github.io/bid-finder").replace(/\/$/, "");
}

export function publicConfig() {
  const secret = process.env.STRIPE_SECRET_KEY || "";
  const price = process.env.STRIPE_PRICE_ID || "";
  return {
    status: 200,
    body: {
      brand: "It's Workplace",
      legalName: "ITS WORKPLACE INC",
      siteUrl: "https://itsworkplace.com",
      planPriceLabel: "$29/month",
      stripePaymentLink: stripeHttps(process.env.STRIPE_PAYMENT_LINK, PAYMENT_HOSTS),
      stripePublishableKey: /^pk_(test|live)_/.test(process.env.STRIPE_PUBLISHABLE_KEY || "")
        ? process.env.STRIPE_PUBLISHABLE_KEY
        : "",
      stripeBuyButtonId: /^buy_btn_/.test(process.env.STRIPE_BUY_BUTTON_ID || "")
        ? process.env.STRIPE_BUY_BUTTON_ID
        : "",
      stripePortalLink: stripeHttps(process.env.STRIPE_PORTAL_LINK, PORTAL_HOSTS),
      checkoutConfigured: Boolean(secret && /^price_/.test(price)),
      aiConfigured: Boolean(process.env.XAI_API_KEY || process.env.AI_API_KEY),
    },
  };
}

export async function createCheckoutSession(fetchImpl = globalThis.fetch) {
  const secret = process.env.STRIPE_SECRET_KEY || "";
  const price = process.env.STRIPE_PRICE_ID || "";
  if (!secret || !/^price_/.test(price)) {
    return {
      status: 503,
      body: {
        code: "STRIPE_NOT_CONFIGURED",
        error: "Checkout needs STRIPE_SECRET_KEY and STRIPE_PRICE_ID on the server, or STRIPE_PAYMENT_LINK in assets/config.js for GitHub Pages.",
      },
    };
  }
  if (!/^sk_(test|live)_/.test(secret) && !/^rk_(test|live)_/.test(secret)) {
    return {
      status: 503,
      body: {
        code: "STRIPE_NOT_CONFIGURED",
        error: "STRIPE_SECRET_KEY should be a Stripe secret or restricted key (sk_ or rk_).",
      },
    };
  }
  const site = siteBase();
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${site}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?checkout=cancel#pricing`,
    allow_promotion_codes: "true",
    billing_address_collection: "auto",
    client_reference_id: "itsworkplace-starter",
    "metadata[brand]": "Its Workplace",
    "metadata[legal_name]": "ITS WORKPLACE INC",
    "metadata[plan]": "starter",
    "subscription_data[metadata][plan]": "starter",
  });
  const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    return {
      status: response.status || 502,
      body: { error: data.error?.message || "Stripe could not start Checkout." },
    };
  }
  if (!stripeHttps(data.url, CHECKOUT_HOSTS)) {
    return { status: 502, body: { error: "Stripe returned an unexpected Checkout URL." } };
  }
  return { status: 200, body: { url: data.url, id: data.id } };
}

export async function verifyCheckout(sessionId, fetchImpl = globalThis.fetch) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { status: 400, body: { active: false, error: "Missing a Stripe Checkout session id." } };
  }
  const secret = process.env.STRIPE_SECRET_KEY || "";
  if (!secret) {
    return {
      status: 503,
      body: { active: false, code: "STRIPE_NOT_CONFIGURED", error: "STRIPE_SECRET_KEY is not set, so this host cannot confirm the session." },
    };
  }
  const response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: 402, body: { active: false, error: data.error?.message || "Could not verify Checkout." } };
  }
  const active = data.status === "complete" && (data.payment_status === "paid" || data.payment_status === "no_payment_required");
  return { status: 200, body: { active, plan: active ? "starter" : null } };
}

export async function createDraft(bid, fetchImpl = globalThis.fetch) {
  if (!bid || typeof bid !== "object" || !bid.title || !bid.link) {
    return { status: 400, body: { error: "A public notice title and link are required." } };
  }
  const xai = process.env.XAI_API_KEY || "";
  const key = xai || process.env.AI_API_KEY || "";
  if (!key) {
    return {
      status: 503,
      body: {
        code: "AI_NOT_CONFIGURED",
        error: "AI_API_KEY is not set. The site will use the in-browser structured draft instead.",
      },
    };
  }
  const base = (xai ? (process.env.XAI_API_BASE || "https://api.x.ai/v1") : (process.env.AI_API_BASE || "https://api.openai.com/v1")).replace(/\/$/, "");
  const model = xai ? (process.env.XAI_MODEL || "grok-4.7") : (process.env.AI_MODEL || "gpt-4o-mini");
  let endpoint;
  try {
    endpoint = new URL(base + "/chat/completions");
    if (endpoint.protocol !== "https:") throw new Error("base");
  } catch {
    return { status: 500, body: { error: "AI_API_BASE must be an https URL." } };
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: modelMessages(bid),
    }),
  });
  const data = await response.json().catch(() => ({}));
  const text = data.choices?.[0]?.message?.content;
  if (!response.ok || !text) {
    return {
      status: 502,
      body: { error: data.error?.message || "The model did not return a draft. The in-browser draft is still available." },
    };
  }
  return { status: 200, body: { draft: String(text).trim(), source: "model", model } };
}
