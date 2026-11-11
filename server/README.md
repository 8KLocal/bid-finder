# Bid service (PHP 8 on shared hosting)

The GitHub Pages site is static. This folder is the API for alerts, the $20 AI draft, claim mail, and “Mail it for me.” It uses SQLite by default and also accepts MySQL. It does not need Composer.

## What it does

| Route | Purpose |
|---|---|
| `POST /api/signup` | Store a subscriber and send the confirmation email |
| `GET /api/confirm` | Double opt-in |
| `POST /api/preferences` | Update interests with the token from the email |
| `GET` or `POST /api/unsubscribe` | One-click unsubscribe |
| `POST /api/claim` | Store a claim and email ops |
| `POST /api/checkout/bid` | Stripe Checkout, $20 (or the tenant price), mode `payment` |
| `POST /api/checkout/mail` | Stripe Checkout for a quoted letter |
| `POST /api/stripe/webhook` | `checkout.session.completed`, signature checked |
| `GET /api/orders/status` | Draft text or mail job id after payment |
| `POST /api/mail/upload` | PDF or draft text. Validates type, size, pages, no password |
| `POST /api/mail/quote` | Postage + page cost + service fee |
| `POST /api/draft` | Returns a draft only after payment. Does not call Grok itself |

Grok runs inside the webhook, after Stripe marks the session paid. LetterStream runs in that same webhook for mail orders, and only then. `LETTERSTREAM_TEST=1` (the default in the example config) does not call LetterStream.

## Environment

Copy `config/config.example.php` to `config/config.php`, or set environment variables. Variables override the file. Never commit `config.php`.

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | xAI key. Server only |
| `XAI_MODEL` | Default `grok-4.7` |
| `XAI_API_BASE` | Default `https://api.x.ai/v1` |
| `STRIPE_SECRET_KEY` | Restricted or secret key (`rk_` or `sk_`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint |
| `OPS_EMAIL` | Claim notices, paid-bid review, mail failures |
| `ALLOWED_ORIGINS` | Comma-separated, e.g. `https://8klocal.github.io,https://itsworkplace.com` |
| `PUBLIC_SITE_URL` | Where Stripe sends the customer back |
| `APP_BASE_URL` | Public URL of this API, used in confirm, unsubscribe, and the PDF link LetterStream fetches |
| `MAIL_TRANSPORT` | `smtp`, `sendgrid`, or `log` |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_ENCRYPTION` | SMTP. Encryption `tls` or `ssl` |
| `MAIL_FROM` `MAIL_FROM_NAME` | From address. Tenant JSON can still change the display name |
| `SENDGRID_API_KEY` | Used when `MAIL_TRANSPORT=sendgrid` |
| `LETTERSTREAM_API_ID` `LETTERSTREAM_API_KEY` | This product’s own LetterStream account |
| `LETTERSTREAM_API_BASE` | Default `https://www.letterstream.com/api/`. Confirm the path in My Account → API after LetterStream enables access |
| `LETTERSTREAM_TEST` | `1` skips the network. Set `0` only in production |
| `MAIL_RETENTION_DAYS` | Delete uploaded PDFs after this many days. Default 14 |
| `FEED_INDEX_URL` | `https://8klocal.github.io/bid-finder/data/feed/index.json` |
| `DB_PATH` | SQLite file. Default `storage/app.sqlite` |
| `DB_DSN` `DB_USER` `DB_PASS` | Optional MySQL, DSN like `mysql:host=localhost;dbname=bids` |

The Starter subscription stays a Stripe Payment Link in `assets/config.js`. The $20 bid and the mailing charge are Checkout Sessions created here. Price per tenant is `bidPriceCents` in `tenants/<slug>.json` (default 2000).

## Hostinger shared hosting

1. In hPanel, add a subdomain such as `bids.itsworkplace.com`. Set its document root to `server/public` after upload (not the repo root, and not `server/storage`).
2. Upload the whole repository, or at least `server/`, `tenants/`, and `data/feed/` if you want digests to read a local copy. PHP 8.1 or newer, with `pdo_sqlite` (or `pdo_mysql`), `curl`, and `mbstring`.
3. Create `server/config/config.php` from the example. Leave it out of git.
4. Make `server/storage` writable by PHP (`chmod 775`). The SQLite file and PDFs are created there. `storage/.htaccess` denies web access; the document root should still be `public/`.
5. Confirm `https://bids.itsworkplace.com/api/health` returns `{"ok":true}`.
6. In Stripe, add an endpoint `https://bids.itsworkplace.com/api/stripe/webhook` for `checkout.session.completed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
7. Set `apiBase` in `tenants/itsworkplace.json` to `https://bids.itsworkplace.com` and republish the Pages site so the browser can call this host.
8. LetterStream: create an account for this product, request API access, and paste that account’s API ID and key. Do not reuse another company’s keys. Keep `LETTERSTREAM_TEST=1` until a paid test order looks right, then set it to `0`. LetterStream must be able to fetch `APP_BASE_URL/api/mail/file?token=…` over HTTPS.
9. Cron, using the host’s PHP 8 binary and the real path:

```
*/15 * * * * /usr/bin/php /home/USER/domains/bids.itsworkplace.com/server/bin/send-welcome.php
15 12 * * * /usr/bin/php /home/USER/domains/bids.itsworkplace.com/server/bin/send-digest.php daily
15 12 * * 1 /usr/bin/php /home/USER/domains/bids.itsworkplace.com/server/bin/send-digest.php weekly
30 4 * * * /usr/bin/php /home/USER/domains/bids.itsworkplace.com/server/bin/purge-uploads.php
```

Digests read `FEED_INDEX_URL`. Point it at the published `data/feed/index.json`.

## Local

```bash
php -S 127.0.0.1:8091 -t server/public server/public/index.php
php server/tests/run.php
```

`node scripts/dev-server.mjs` serves the site. Proxy the API routes at `/api/signup`, `/api/mail`, `/api/checkout`, and `/api/stripe` to the PHP server if you want the forms to talk to it.

## Mail classes

First-Class maps to LetterStream `firstclass`. Certified with return receipt maps to `certified`. Certified without it maps to `certnoerr`. The quote numbers are the tenant’s configured cents, not a live USPS rate.
