# Q8 Bid Finder

Find open government contracts for web, app, IT and marketing work. Built by [Q8 Marketing](https://q8marketing.design).

**Live:** https://aklocalsolutions-create.github.io/bid-finder/

## How it works
- Static site (`index.html`, `assets/`) served by GitHub Pages.
- Data: `data/bids.json`, built by `scripts/fetch_bids.py` from the **SAM.gov Contract Opportunities public data extract** (the daily full CSV published on sam.gov / data.gov). No API key, no scraping of third-party bid sites.
- Kept: active notices with a future response deadline in IT, web, marketing and related NAICS families. Featured NAICS: 541511, 541512, 541519, 518210, 541430, 541810, 541613, 541820.
- Daily refresh: `ops/refresh-bids.yml` is a ready GitHub Action. Copy it to `.github/workflows/refresh-bids.yml` to turn it on (the bot token that pushed this repo lacked the `workflow` scope). It needs **no secrets**; it uses the built-in `GITHUB_TOKEN`.

## Run locally
```
python3 scripts/fetch_bids.py && python3 -m http.server
```

## Roadmap
Accounts and saved searches, Stripe subscriptions, AI response drafting, state and local sources, custom domain.

Not affiliated with the U.S. Government. Always confirm details on the official notice.
