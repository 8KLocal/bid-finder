#!/usr/bin/env python3
"""Fetch open federal contract opportunities from SAM.gov's public data extract
(Contract Opportunities Full CSV, published daily on sam.gov / data.gov, no API key)
and write a filtered data/bids.json for the static site."""
import csv, io, json, os, re, sys, datetime as dt, urllib.request

SRC = ("https://sam.gov/api/prod/fileextractservices/v1/api/download/"
       "Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public")
FEATURED = {
    "541511": "Custom Computer Programming", "541512": "Computer Systems Design",
    "541519": "Other Computer Related Services", "518210": "Hosting & Data Processing",
    "541430": "Graphic Design", "541810": "Advertising Agencies",
    "541613": "Marketing Consulting", "541820": "Public Relations",
}
# Also keep the wider IT / marketing / creative families.
PREFIXES = ("5415", "5418", "51821", "54143", "54161", "51211", "541990")
SKIP_TYPES = {"Award Notice", "Justification", "Sale of Surplus Property", "Consolidate/(Substantially) Bundle"}

def clean(s, n=None):
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return (s[: n - 1] + "…") if n and len(s) > n else s

def main(path=None):
    csv.field_size_limit(sys.maxsize)
    if path:
        fh = open(path, "rb")
    else:
        req = urllib.request.Request(SRC, headers={"User-Agent": "q8-bid-finder/1.0"})
        fh = urllib.request.urlopen(req, timeout=600)
    text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
    now = dt.datetime.now(dt.timezone.utc)
    out = []
    for r in csv.DictReader(text):
        naics = (r.get("NaicsCode") or "").strip()
        if not (naics in FEATURED or naics.startswith(PREFIXES)):
            continue
        if (r.get("Active") or "").strip() != "Yes" or r.get("Type") in SKIP_TYPES:
            continue
        due = (r.get("ResponseDeadLine") or "").strip()
        if not due:
            continue
        try:
            d = dt.datetime.fromisoformat(due)
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
        if d < now:
            continue
        nid = r["NoticeId"].strip()
        out.append({
            "id": nid,
            "title": clean(r.get("Title"), 220),
            "solicitation": clean(r.get("Sol#")),
            "agency": clean(r.get("Department/Ind.Agency")).title(),
            "subTier": clean(r.get("Sub-Tier")).title(),
            "office": clean(r.get("Office")),
            "posted": (r.get("PostedDate") or "")[:10],
            "due": due,
            "type": clean(r.get("Type")),
            "naics": naics,
            "naicsLabel": FEATURED.get(naics, ""),
            "featured": naics in FEATURED,
            "setAside": (lambda s: "None" if not s or s.lower().startswith("no set") else s)(clean(r.get("SetASide"))),
            "setAsideCode": clean(r.get("SetASideCode")),
            "place": ", ".join(x for x in [clean(r.get("PopCity")), clean(r.get("PopState"))] if x),
            "contact": clean(r.get("PrimaryContactEmail")),
            "link": f"https://sam.gov/opp/{nid}/view",
            "summary": clean(r.get("Description"), 600),
        })
    out.sort(key=lambda b: b["due"])
    os.makedirs("data", exist_ok=True)
    meta = {"source": "SAM.gov Contract Opportunities public data extract (no API key)",
            "sourceUrl": "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public",
            "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "count": len(out),
            "featuredNaics": FEATURED}
    with open("data/bids.json", "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "bids": out}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(out)} bids")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
