# Q8 Bid Finder

Find open government solicitations for web, app, software, design, and marketing work. Built by [Q8 Marketing](https://q8marketing.design).

**Live site (last published `main`, not this branch):** https://aklocalsolutions-create.github.io/bid-finder/

This repository does not list every U.S. government bid. It reads three public primary feeds and labels everything else as not ingested.

Counts below are the data file in this commit (refresh run `2026-11-09T01:41:00Z`). The next workflow run replaces them. See `data/sources.json` for the file the site actually loads.

- SAM public CSV: HTTP 206 ranged read, `216,496,724` bytes, `Last-Modified: Sun, 08 Nov 2026 04:30:19 GMT`, `x-amz-meta-privacy: Public`, final host `falextracts.s3.amazonaws.com`. Full parse: `70,527` rows, `412` open notices in the NAICS keep-set, clustered to `198` opportunities (`214` earlier notices kept as addenda).
- Suffolk Bonfire RSS: HTTP 200, `3` open items, `2` category matches (EMR software; tourism marketing). The tourism RSS close text is `Dec 04, 2026 12:00 AM EST`. A reported RFP time of 3:30 PM is flagged and was not parsed from a PDF.
- NYC City Record: dataset has `45,318` solicitation-typed rows. `198` had a due date on or after `2026-11-07`. `1` matched the category phrases (DOE payroll-system managed services). PASSPort was not queried.
- SAM Opportunities API: no key, status `config-required`, `0` rows. An unauthenticated GET returned HTTP 404 and was not turned into notices.
- Live list: `201` opportunities. Demo fixtures are a separate file and are not in that count.

Before this branch, `data/bids.json` had been built at `2026-11-08T19:13:16Z` from that same daily extract, and `.github/workflows` was missing, so no schedule was running.

## What is ingested

| Source | Access | What lands in the list |
|---|---|---|
| SAM.gov Contract Opportunities public CSV | No API key. Daily file extract. | Active federal notices in the existing NAICS families (5415, 5418, 51821, 54143, 54161, 51211, 541990), with a response deadline still ahead. Featured codes: 541511, 541512, 541519, 518210, 541430, 541810, 541613, 541820. |
| Suffolk County, NY Bonfire RSS | No key. `https://suffolkcountyny.bonfirehub.com/opportunities/rss` | Open notices from that one organization whose title or description matches the category phrases. Other Bonfire organizations are not covered. There is no public directory of tenants. |
| NYC City Record Online | No key. Socrata `dg92-zbpx` | Solicitation rows with a due date, matched to those same phrases. Portal boilerplate (“see the website”) is not treated as a website project. Dates more than 15 years out are skipped as placeholders. |
| SAM.gov Get Opportunities API | Key required | Not called unless `SAM_API_KEY` is set and `SAM_API_ENABLE=1`. With no key the adapter records **config-required** and adds zero rows. |

Notices that share a solicitation number are one opportunity. Earlier notices stay on the card as addenda. The raw feed deadline is kept. A conflicting note is shown beside it and does not replace the feed time unless a person sets that in `data/deadline-verifications.json`. This pipeline does not parse solicitation PDFs.

### Not ingested

- **BidNet Direct** — agencies publish into BidNet purchasing groups, and BidNet also aggregates statewide notices from public websites and newspapers. No free bulk API was found. The public search page is not treated as coverage, and BidNet’s corpus is not copied.
- **RFPMart** — a researcher/crawler aggregator (their own materials describe website crawlers, including a SAM.gov crawler). Their RSS and document corpus are not copied. Marketing claims of complete coverage are not used.
- **PlanetBids, OpenGov, IonWave / BidSync** — no documented keyless bulk feed is called. Login-only portals are **unsupported**.
- **NYS Contract Reporter** — official, but full ads need a free registration and no public API/RSS was found. **Manual**. It is not scraped.
- **NYC PASSPort** — public browse page only. City Record rows often say to submit there. No PASSPort bulk API is used, and no per-solicitation PASSPort link is invented. **Manual**.

Status values on the site are `working`, `config-required`, `unsupported`, `manual`, and `error`.

## Deadlines

SAM extract deadlines that include an offset are stored with that offset. Bonfire RSS close text is stored as published (`dueRaw`) and parsed when the abbreviation is recognizable. The Suffolk tourism notice `2026-25` currently says `Dec 04, 2026 12:00 AM EST` in the RSS. Source research reported the official RFP (§I.7) as 3:30 PM. That disagreement is flagged. `parsedPdf` is false because this job does not open the PDF.

NYC City Record `due_date` values have no timezone. They are shown as America/New_York and the card says that is an assumption.

## Refresh safely

The workflow file is `.github/workflows/refresh-bids.yml` (the same text is kept at `ops/refresh-bids.yml`). It was not installed before, so scheduled refresh was not running. GitHub runs the schedule only after the file is on the default branch. Merging this pull request is what turns the schedule on. Nothing here changes Pages settings or deploys by itself. Pages publishes `main` when a commit reaches it.

The workflow:

1. Runs `python -m unittest discover -s tests -v`.
2. Runs `python scripts/fetch_bids.py`.
3. Commits `data/bids.json`, `data/sources.json`, and `data/runs.json` only when they change.
4. Uses the built-in `GITHUB_TOKEN` with `contents: write`. No third-party secret is required for the three public feeds.
5. Fails the job if a required fetch fails, after writing source status. A failed SAM download keeps the previous SAM rows and marks them stale instead of wiping the file.

Optional SAM API, only if you already have your own key:

1. Create the key on your SAM.gov Account Details page. This repo does not create accounts.
2. Add repository secret `SAM_API_KEY`.
3. Add repository secret `SAM_API_ENABLE` with the value `1` when you want the one bounded API call (last 7 days, limit 100). Leave it unset to keep the adapter off even if a key is present.
4. Never commit the key. The job redacts it from error text.

Cron is `17 11 * * *` UTC (about 6–7 AM Eastern). You can also run it with **workflow_dispatch** on the default branch. The SAM file is about 216 MB and is not committed; only the filtered JSON is.

Local run:

```bash
python3 -m unittest discover -s tests -v
python3 scripts/fetch_bids.py
python3 -m http.server
```

`python3 scripts/fetch_bids.py path/to/ContractOpportunitiesFullCSV.csv` parses a local extract and still refreshes Bonfire and City Record. Demo fixtures live in `data/demo/opportunities.json` and are not written into `data/bids.json`.

## Adding another Bonfire organization

Fetch `https://{slug}.bonfirehub.com/opportunities/rss` yourself and confirm it is public RSS. Then add that slug to `ORGS` in `ingest/sources/bonfire.py`. Do not add a slug from a directory this project does not have.

## Category phrases

Website, app, software, design, and marketing phrases are in `ingest/categories.py`. SAM’s NAICS keep-set is unchanged. Extend the phrase lists to track another category; don’t widen them with the bare words “design”, “IT”, or “website” inside portal instructions.

Not affiliated with the U.S. Government, Suffolk County, or the City of New York. Confirm the notice before you respond. This site does not submit bids.
