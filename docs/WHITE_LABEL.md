# White-label bid bot

Each customer is a JSON file in `tenants/`. The site, the emails, and the Grok prompt read the active tenant. Subscribers, claims, and paid orders are stored with that tenant slug.

## Pick a tenant

The page uses the first match:

1. `?tenant=slug`
2. The hostname’s first label, when it is not `www`, `8klocal`, or `localhost` (`harbor.example.com` → `harbor`)
3. `itsworkplace`

`example-harbor` is a fake sample. It is marked `"example": true` and the page shows a banner. Do not put a real customer’s private bids in the repo.

## New tenant

```bash
node scripts/new-tenant.mjs --slug acme --brand "Acme Bid Desk" --reply bids@acme.example --domain bids.acme.example
```

Then edit `tenants/acme.json`:

| Field | Use |
|---|---|
| `brand`, `colors`, `tagline`, `logo` | What the page shows |
| `emailFrom`, `replyTo`, `address` | Digest and receipt footer |
| `bidPriceCents` | Price for one AI bid. Default 2000 ($20) |
| `mail` | Postage, a flat mailing charge (`mailingChargeCents`, default 500), per-page printing, and service-fee cents |
| `defaults` | Keywords, NAICS, states, and sources suggested on the signup form |
| `persona` | Extra instructions added to the Grok system prompt |
| `domains` | Hosts that should resolve to this tenant |
| `apiBase` | HTTPS origin of the PHP API when the site is on GitHub Pages |
| `stripePaymentLink` | That customer’s own Starter link, if they sell the subscription |

Point the customer’s domain at the same static site, or host the PHP app on the subdomain and set `apiBase`.

## What stays shared

The bid feed in `data/feed/` is one public corpus. Tenants do not get a private copy of notices. Payments use the It’s Workplace Stripe account unless you deploy a separate server with that customer’s `STRIPE_SECRET_KEY`. LetterStream credentials are the server’s env vars, never a tenant file.
