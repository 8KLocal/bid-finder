#!/usr/bin/env python3
"""Fetch open U.S. contract opportunities from SAM.gov's public data extract.

Source: Contract Opportunities Full CSV, published daily on sam.gov / data.gov.
No API key. The site lists public notices only — websites, apps, software, and
related digital or remote services — and links each one to the official notice.
"""
import csv, io, json, os, re, sys, datetime as dt, urllib.request

SRC = ("https://sam.gov/api/prod/fileextractservices/v1/api/download/"
       "Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public")

# Software, websites, apps, hosting, and computer systems. Always eligible
# when the place of performance is in the United States (or unstated).
CORE = {
    "541511": "Custom Computer Programming",
    "541512": "Computer Systems Design",
    "541513": "Computer Facilities Management",
    "541519": "Other Computer Related Services",
    "518210": "Hosting & Data Processing",
    "511210": "Software Publishers",
    "519130": "Internet Publishing & Web Portals",
}

# Adjacent professional-services codes. Kept only when the notice text is
# actually about software, web, IT, or related digital work.
RELATED_PREFIXES = ("54143", "5414", "5416", "541990", "5191", "518", "5112", "61142", "61143")

US_COUNTRIES = {
    "", "USA", "US", "UNITED STATES", "UNITED STATES OF AMERICA",
    "PRI", "PUERTO RICO", "GUM", "GUAM", "VIR", "VIRGIN ISLANDS", "U.S. VIRGIN ISLANDS",
    "ASM", "AMERICAN SAMOA", "MNP", "NORTHERN MARIANA ISLANDS",
    "DC", "DISTRICT OF COLUMBIA",
}

SKIP_TYPES = {
    "Award Notice", "Justification", "Sale of Surplus Property",
    "Consolidate/(Substantially) Bundle",
}

DIGITAL = re.compile(
    r"\b("
    r"websites?|web[- ]based|web[- ]apps?|web[- ]applications?|"
    r"software|saas|mobile apps?|mobile applications?|"
    r"application development|application software|"
    r"information technology|information systems?|"
    r"help[- ]desks?|cybersecurity|cyber security|"
    r"cloud computing|devops|web hosting|data hosting|"
    r"programmers?|software developers?|"
    r"user interface|user experience|"
    r"sharepoint|servicenow|salesforce|"
    r"digital services?|computer systems?|custom computer"
    r")\b",
    re.IGNORECASE,
)
# Case-sensitive so the pronoun "it" is not treated as information technology.
# Also skip the capitalized pronoun that shows up in all-caps sentences ("IT IS", "IT DOES").
IT_WORD = re.compile(r"\bIT\b(?!\s+(?:IS|DOES|WILL|MAY|SHALL|HAS|HAD|CAN|WAS|WERE|WOULD|MUST|SHOULD|COULD|MIGHT)\b)")
REMOTE = re.compile(r"\b(remote|telework|work from home)\b", re.IGNORECASE)
TAG = re.compile(r"<[^>]+>")


_SMALL_WORDS = {"of", "the", "and", "for", "a", "an", "in", "on", "at", "to"}


def agency_name(s):
    words = clean(s).title().split(" ")
    out = []
    for i, word in enumerate(words):
        core = word.strip(",.&").lower()
        if i and core in _SMALL_WORDS and word[:1].isalpha():
            out.append(word[:1].lower() + word[1:])
        else:
            out.append(word)
    return " ".join(out)


def clean(s, n=None):
    s = TAG.sub(" ", s or "")
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
           .replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'")
           .replace("&quot;", '"'))
    s = re.sub(r"\s+", " ", s).strip()
    if n and len(s) > n:
        return s[: n - 1].rstrip() + "…"
    return s


def is_usa(country):
    return clean(country).upper() in US_COUNTRIES


def is_core(naics):
    return naics in CORE or naics.startswith("54151")


def is_related_code(naics):
    return naics.startswith(RELATED_PREFIXES) or naics in {"541990", "541430"}


def digital(text):
    return bool(DIGITAL.search(text) or IT_WORD.search(text))


def parse_due(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        d = dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def consider(row, now):
    """Return a bid dict, or None when the notice is out of scope."""
    naics = (row.get("NaicsCode") or "").strip()
    if not naics:
        return None
    if not is_usa(row.get("PopCountry")):
        return None
    if (row.get("Active") or "").strip() != "Yes":
        return None
    if (row.get("Type") or "").strip() in SKIP_TYPES:
        return None
    due = parse_due(row.get("ResponseDeadLine"))
    if due is None or due < now:
        return None
    title = clean(row.get("Title"), 220)
    summary = clean(row.get("Description"), 600)
    # Related service codes have to say the digital work in the title. A passing
    # "IT IS" or "see the website" in a long description is not enough.
    core = is_core(naics)
    if core:
        scope = "core"
    elif is_related_code(naics) and digital(title):
        scope = "related"
    else:
        return None
    text = f"{title} {summary}"
    nid = (row.get("NoticeId") or "").strip()
    if not nid:
        return None
    set_aside = clean(row.get("SetASide"))
    if not set_aside or set_aside.lower().startswith("no set"):
        set_aside = "None"
    place = ", ".join(x for x in [clean(row.get("PopCity")), clean(row.get("PopState"))] if x)
    posted = (row.get("PostedDate") or "").strip()
    return {
        "id": nid,
        "title": title,
        "solicitation": clean(row.get("Sol#")),
        "agency": agency_name(row.get("Department/Ind.Agency")),
        "subTier": agency_name(row.get("Sub-Tier")),
        "office": clean(row.get("Office")),
        "posted": posted[:10],
        "due": (row.get("ResponseDeadLine") or "").strip(),
        "type": clean(row.get("Type")),
        "naics": naics,
        "naicsLabel": CORE.get(naics, ""),
        "featured": scope == "core",
        "scope": scope,
        "remote": bool(REMOTE.search(text)),
        "setAside": set_aside,
        "setAsideCode": clean(row.get("SetASideCode")),
        "place": place,
        "contact": clean(row.get("PrimaryContactEmail")),
        "link": f"https://sam.gov/opp/{nid}/view",
        "summary": summary,
    }


def write_bids(rows, now, dest="data/bids.json"):
    rows = [b for b in rows if b]
    rows.sort(key=lambda b: b["due"])
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    meta = {
        "source": "SAM.gov Contract Opportunities public data extract (no API key)",
        "sourceUrl": "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public",
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(rows),
        "scope": "USA websites, apps, software, and related digital services",
        "featuredNaics": CORE,
    }
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "bids": rows}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, dest)
    core_n = sum(1 for b in rows if b["scope"] == "core")
    print(f"wrote {len(rows)} bids ({core_n} software/web, {len(rows) - core_n} related)")
    return len(rows)


def load_rows(path=None):
    csv.field_size_limit(sys.maxsize)
    if path:
        fh = open(path, "rb")
    else:
        req = urllib.request.Request(SRC, headers={"User-Agent": "itsworkplace-bid-listings/1.0"})
        fh = urllib.request.urlopen(req, timeout=1800)
    text = io.TextIOWrapper(fh, encoding="cp1252", newline="")
    now = dt.datetime.now(dt.timezone.utc)
    out = []
    seen = 0
    for row in csv.DictReader(text):
        seen += 1
        bid = consider(row, now)
        if bid:
            out.append(bid)
        if seen % 100000 == 0:
            print(f"scanned {seen} notices, kept {len(out)}", file=sys.stderr)
    return out, now


def main(path=None):
    rows, now = load_rows(path)
    write_bids(rows, now)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
