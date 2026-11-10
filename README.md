# It's Workplace — bid listings

Public list of open United States government contracts for websites, apps, software, and related digital or remote services.

**Live:** https://8klocal.github.io/bid-finder/

**Company:** [It's Workplace](https://itsworkplace.com) · legal entity **ITS WORKPLACE INC**

The site only publishes public notices. It does not show private bidding activity, internal notes, or a private pipeline.

Not affiliated with the U.S. Government. Always confirm details on the official notice.

## What you can do

- **All bids** lists every matching open notice in `data/bids.json`, not a featured subset. Filter by keyword, deadline, agency, NAICS, and set-aside. Each row links to the official SAM.gov notice.
- **Free** is browse-only.
- **Starter ($29/month)** unlocks **Fill this out with AI**. The draft can be edited, copied, or downloaded. Nothing is submitted to SAM.gov or any other government portal.

## How the list is built

`scripts/fetch_bids.py` reads the SAM.gov Contract Opportunities public CSV (no API key) and writes `data/bids.json`.

Kept notices are active, still before the response deadline, and performed in the United States (or with no country listed). Software and web NAICS codes are kept on their own:

- 541511 Custom Computer Programming
- 541512 Computer Systems Design
- 541513 Computer Facilities Management
- 541519 Other Computer Related Services
- 518210 Hosting and data processing
- 511210 Software publishers
- 519130 Internet publishing and web portals

Nearby service codes are kept only when the title or description is about software, websites, IT, or related digital work.

```bash
python3 scripts/fetch_bids.py
python3 -m http.server
```

The second command is the static site only. For Stripe Checkout sessions and server-side drafts, use:

```bash
node scripts/dev-server.mjs
```

That serves the site and the `/api` routes at http://127.0.0.1:8080

## Daily refresh

`.github/workflows/refresh-bids.yml` runs every day, reruns the fetch script, and commits `data/bids.json` when it changes. It uses `GITHUB_TOKEN` and needs no secrets. A copy of the same workflow lives in `ops/refresh-bids.yml`.

GitHub Pages publishes the `main` branch from `/` (see `.nojekyll`). Merging to `main` updates https://8klocal.github.io/bid-finder/

## Stripe — itsworkplace.com account

Checkout is real Stripe, not a waitlist. No secret key is stored in the repo. Use either a **Payment Link** (works on GitHub Pages) or a **Checkout Session** (needs the API).

### Payment Link (GitHub Pages)

1. In the Stripe Dashboard for **itsworkplace.com**, create a $29/month recurring price named Starter.
2. Create a Payment Link for that price.
3. Set the link’s after-payment URL to `https://8klocal.github.io/bid-finder/?checkout=success`
4. Set the cancel URL to `https://8klocal.github.io/bid-finder/?checkout=cancel#pricing`
5. Put the link in `assets/config.js`:

```js
stripePaymentLink: "https://buy.stripe.com/your_link",
```

Publishable keys and Payment Links are public by design. **Never** put `sk_` or `rk_` keys in `config.js`.

Returning from that success URL turns on Starter in the browser. Pages cannot cryptographically confirm the payment on its own. Deploy the API below if you want the session checked with Stripe before unlocking.

### Checkout Session (API)

Set these on the host that runs `api/` (or in a `.env` file next to the repo for the local server). Names match `.env.example`.

| Variable | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server only | Secret or restricted key (`sk_` or `rk_`) |
| `STRIPE_PRICE_ID` | Server only | `price_…` for Starter at $29/month |
| `PUBLIC_SITE_URL` | Server | `https://8klocal.github.io/bid-finder` |
| `STRIPE_PAYMENT_LINK` | Server or `config.js` | `https://buy.stripe.com/…` |
| `STRIPE_PUBLISHABLE_KEY` | Public | `pk_live_…` or `pk_test_…`, only for a Buy Button |
| `STRIPE_BUY_BUTTON_ID` | Public | `buy_btn_…` from Stripe’s Buy Button snippet |
| `STRIPE_PORTAL_LINK` | Public | `https://billing.stripe.com/p/login/…` |

The browser posts to `api/create-checkout-session`. The server calls Stripe and redirects to the hosted Checkout URL (`session.url`). Card numbers never touch this site.

`api/verify-checkout?session_id=cs_…` confirms a completed session when `STRIPE_SECRET_KEY` is set.

If neither a Payment Link nor Checkout keys are present, **Continue to checkout** stays active and explains exactly which values to add. It does not pretend the payment went through.

Optional: set `stripePublishableKey` and `stripeBuyButtonId` to render Stripe’s official Buy Button on the Starter card. The script is `https://js.stripe.com/v3/buy-button.js`.

The `api/` files are Vercel-style handlers (`export default function handler`). Point `stripeCheckoutEndpoint` in `config.js` at that host if the API is not on the same origin as the Pages site. Set `CORS_ORIGIN` (default `*`) if you want to limit it, for example to `https://8klocal.github.io`.

## AI fill-out

Every bid has **Fill this out with AI**.

- With Stripe configured, Starter has to be active in the browser before a draft is generated.
- Without Stripe keys yet, the dialog still builds a structured draft from the public notice and says the model is not configured. The checkout button in that dialog opens the setup notes above.
- If `AI_API_KEY` is set on the API, **Regenerate** asks that model for the draft. Optional `AI_API_BASE` (default `https://api.openai.com/v1`) and `AI_MODEL` (default `gpt-4o-mini`) select an OpenAI-compatible chat endpoint.
- A visitor can paste their own key in the dialog. It stays in `sessionStorage` for that browser session and is sent only to `api.openai.com`. It is never written to the repo or the server.
- If the model call fails or no key exists, the structured draft remains in the editor so it can be copied or downloaded.

The model is instructed not to invent past performance or prices, and to mark the result as an unsubmitted draft.

## Tests

```bash
npm test
```

That runs the Stripe/draft handler tests and the SAM.gov scope tests. No network and no live keys.
