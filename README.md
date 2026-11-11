# It's Workplace — bid listings

Public list of United States solicitations from the sources this project can read. It is not every open U.S. bid.

**Live:** https://8klocal.github.io/bid-finder/

**Company:** [It's Workplace](https://itsworkplace.com) · legal entity **ITS WORKPLACE INC**

The site only publishes public notices. It does not show private bidding activity, internal notes, or a private pipeline.

Not affiliated with the U.S. Government. Always confirm details on the official notice.

## What you can do

- **All bids** lists every matching open SAM.gov notice in `data/bids.json` and every public RFPMart listing in `data/rfp-bids.json`. Filter by keyword, deadline, agency, NAICS, set-aside, or source (SAM.gov / RFPMart). Each row links to the original notice.
- **Claim this bid** saves the listing in this browser and opens a draft you can edit, copy, or download. **My claimed bids** shows those claims. Nothing is submitted to a government portal.
- **Free** includes browsing and claiming.
- **Starter ($29/month)** unlocks **Fill this out with AI** when Stripe is connected. The same draft editor is what Claim opens. Nothing is submitted to SAM.gov or any other government portal.

## How the list is built

`scripts/fetch_bids.py` reads the SAM.gov Contract Opportunities public CSV (no API key) and writes `data/bids.json`.

`scripts/fetch-rfp-bids.js` reads [RFPMart](https://www.rfpmart.com/) public category RSS feeds and the first page of the public HTML index, then writes `data/rfp-bids.json`. Each row is `source: "RFPMart"` and links to the original listing. It reads `robots.txt` first, waits out the published crawl delay, and does not request disallowed paths, log in, or store credentials. A descriptive user agent is used. State and country feeds are skipped because they repeat the category feeds. The HTML catalog reports thousands of pages; walking all of them at that crawl delay would take many hours and the file would be too large for GitHub Pages. Set `RFP_INDEX_PAGES` to walk more `home-N.html` pages.

```bash
node scripts/fetch-rfp-bids.js
```

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

## Coverage, alerts, AI drafts, and mail

`data/sources/registry/` lists Census Vintage 2024 states, counties, incorporated places, and townships, plus a short seeded list of school, university, transit, housing, and utility homepages. `scripts/sources/discover.mjs` checks the next batch of bid URLs (highest population first) and records robots.txt blocks. `data/sources/coverage.json` is the honest covered-versus-listed count. The home page shows it.

`server/` is the PHP API for email alerts, the $20 Grok draft (after a Stripe webhook), and “Mail it for me” (LetterStream, test mode by default). See `server/README.md`. White-label tenants are in `docs/WHITE_LABEL.md`. Sources and the takedown address are on `legal.html`.

## Daily refresh

`.github/workflows/refresh-feed.yml` runs every day. It collects SAM.gov, RFPMart, open-data sets, platform robots checks, and the next jurisdiction batch in parallel, then commits `data/feed` and `data/sources`. The older SAM and RFPMart workflows stay as manual runs. None of them need a secret.

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

## Claiming a bid

Every card has **Claim this bid**. Claiming stores `{ bidId, title, agency, deadline, claimedAt }` in `localStorage` under `iw-claimed-bids` and immediately opens the draft editor (the same `fillDraft` path as Fill this out with AI, without an extra click). Copy and download stay on that dialog. **My claimed bids** filters to that browser’s claims.

If `claimWebhookUrl` in `assets/config.js` is an `https` URL with no username or password, the browser POSTs that JSON object, plus `contactEmail` when the optional email field is a valid address. The value is empty by default. Do not put an API key, password, or signing secret in `config.js`. A claim is kept in the browser even if the webhook cannot be reached.

## AI fill-out

Every bid has **Fill this out with AI**. **Claim this bid** opens the same editor immediately so the draft can be copied or downloaded. With Stripe configured, the Fill button itself still asks for Starter before it generates a draft.

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
