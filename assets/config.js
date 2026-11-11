/**
 * Public configuration for It's Workplace bid listings.
 *
 * Put publishable values here so GitHub Pages can take a payment without a
 * server. Never paste a Stripe secret key (sk_ / rk_) or an AI API key into
 * this file — those belong in environment variables for server/handlers.js.
 *
 * After you fill these in, commit this file (the payment link and pk_ key are
 * meant to be public) or leave the strings empty and set the same names as
 * environment variables when you run `node scripts/dev-server.mjs`.
 */
window.IW_CONFIG = {
  brand: "It's Workplace",
  legalName: "ITS WORKPLACE INC",
  siteUrl: "https://itsworkplace.com",
  listingsUrl: "https://8klocal.github.io/bid-finder/",
  planName: "Starter",
  planPriceLabel: "$29/month",

  // Stripe Payment Link from the itsworkplace.com Stripe account.
  // Dashboard → Payment Links → the Starter $29/month price.
  // Success URL: https://8klocal.github.io/bid-finder/?checkout=success
  // Cancel URL:  https://8klocal.github.io/bid-finder/?checkout=cancel#pricing
  stripePaymentLink: "https://buy.stripe.com/7sY8wJ6s67Gn9wF9JW0ZW3k",

  // Optional. Required only for the official Stripe Buy Button embed.
  // Example: "pk_live_..." or "pk_test_..."
  stripePublishableKey: "",

  // Optional. From the Buy Button embed snippet (buy_btn_...).
  // Leave empty to use the Payment Link or Checkout Session button instead.
  stripeBuyButtonId: "",

  // Optional Customer Portal link (https://billing.stripe.com/p/login/...).
  stripePortalLink: "",

  // Relative on this host, or an absolute URL if the API lives elsewhere.
  stripeCheckoutEndpoint: "api/create-checkout-session",
  verifyEndpoint: "api/verify-checkout",
  aiDraftEndpoint: "api/draft",
  publicConfigEndpoint: "api/public-config",
};
