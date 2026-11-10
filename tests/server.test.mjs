import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fallbackDraft } from "../assets/draft.js";
import { createCheckoutSession, createDraft, publicConfig, stripeHttps, verifyCheckout } from "../server/handlers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("public config never returns secret keys", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_secret";
  process.env.STRIPE_PRICE_ID = "price_starter";
  process.env.STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_abc";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_public";
  process.env.AI_API_KEY = "sk-model";
  process.env.STRIPE_PORTAL_LINK = "https://billing.stripe.com/p/login/test";
  const { body } = publicConfig();
  const blob = JSON.stringify(body);
  assert.equal(body.checkoutConfigured, true);
  assert.equal(body.aiConfigured, true);
  assert.equal(body.stripePaymentLink, "https://buy.stripe.com/test_abc");
  assert.equal(body.stripePublishableKey, "pk_test_public");
  assert.doesNotMatch(blob, /sk_test_secret/);
  assert.doesNotMatch(blob, /sk-model/);
  assert.doesNotMatch(blob, /price_starter/);
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_PAYMENT_LINK;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.STRIPE_PORTAL_LINK;
});

test("payment links must be https on buy.stripe.com", () => {
  assert.equal(stripeHttps("http://buy.stripe.com/abc", new Set(["buy.stripe.com"])), "");
  assert.equal(stripeHttps("https://evil.example/buy", new Set(["buy.stripe.com"])), "");
  assert.match(stripeHttps("https://buy.stripe.com/test_abc", new Set(["buy.stripe.com"])), /^https:\/\/buy\.stripe\.com\//);
});

test("checkout session is refused without keys", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  const result = await createCheckoutSession(async () => {
    throw new Error("should not call Stripe");
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "STRIPE_NOT_CONFIGURED");
  assert.match(result.body.error, /STRIPE_SECRET_KEY/);
  assert.match(result.body.error, /STRIPE_PRICE_ID/);
  assert.match(result.body.error, /STRIPE_PAYMENT_LINK/);
});

test("checkout session posts the Starter price and returns the hosted URL", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.STRIPE_PRICE_ID = "price_starter29";
  process.env.PUBLIC_SITE_URL = "https://8klocal.github.io/bid-finder";
  let sent;
  const result = await createCheckoutSession(async (url, opts) => {
    sent = { url, body: new URLSearchParams(opts.body) };
    return jsonResponse({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  assert.equal(sent.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(sent.body.get("mode"), "subscription");
  assert.equal(sent.body.get("line_items[0][price]"), "price_starter29");
  assert.match(sent.body.get("success_url"), /checkout=success/);
  assert.match(sent.body.get("success_url"), /\{CHECKOUT_SESSION_ID\}/);
  assert.match(sent.body.get("cancel_url"), /itsworkplace|8klocal/);
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
});

test("verify checkout requires a completed session", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  const unpaid = await verifyCheckout("cs_test_open", async () => jsonResponse({ status: "open", payment_status: "unpaid" }));
  assert.equal(unpaid.body.active, false);
  const paid = await verifyCheckout("cs_test_paid", async () => jsonResponse({ status: "complete", payment_status: "paid" }));
  assert.equal(paid.body.active, true);
  assert.equal(paid.body.plan, "starter");
  delete process.env.STRIPE_SECRET_KEY;
});

test("draft reports a missing model key instead of inventing one", async () => {
  delete process.env.AI_API_KEY;
  const result = await createDraft({ title: "Website support", link: "https://sam.gov/opp/x/view" }, async () => {
    throw new Error("should not call a model");
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "AI_NOT_CONFIGURED");
});

test("draft calls an OpenAI-compatible chat endpoint", async () => {
  process.env.AI_API_KEY = "sk-test";
  process.env.AI_MODEL = "gpt-4o-mini";
  let sent;
  const result = await createDraft(
    { title: "Public website modernization", link: "https://sam.gov/opp/x/view", summary: "Rebuild the public site." },
    async (url, opts) => {
      sent = { url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return jsonResponse({ choices: [{ message: { content: "DRAFT FOR YOUR REVIEW" } }] });
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "model");
  assert.match(result.body.draft, /DRAFT FOR YOUR REVIEW/);
  assert.equal(sent.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(sent.auth, "Bearer sk-test");
  assert.equal(sent.body.model, "gpt-4o-mini");
  assert.match(sent.body.messages[0].content, /has not been submitted/);
  delete process.env.AI_API_KEY;
});

test("public site does not carry the previous brand", () => {
  const files = [
    "index.html",
    "assets/app.js",
    "assets/styles.css",
    "assets/config.js",
    "assets/draft.js",
    "README.md",
  ];
  for (const file of files) {
    const text = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /Q8|q8marketing/i, file);
  }
});

test("fallback draft is editable and does not claim it was submitted", () => {
  const text = fallbackDraft({
    title: "Library website",
    solicitation: "SOL-1",
    agency: "Library of Congress",
    due: "2026-12-01T17:00:00-05:00",
    naics: "541511",
    link: "https://sam.gov/opp/abc/view",
    summary: "Redesign the public website.",
  });
  assert.match(text, /NOT SUBMITTED/);
  assert.match(text, /Library website/);
  assert.match(text, /\[Your legal company name\]/);
  assert.match(text, /https:\/\/sam\.gov\/opp\/abc\/view/);
  assert.doesNotMatch(text, /Q8/i);
});
