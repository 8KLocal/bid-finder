#!/usr/bin/env python3
"""Fetch open U.S. contract opportunities from SAM.gov's public data extract.

Source: Contract Opportunities Full CSV, published daily on sam.gov / data.gov.
No API key. The site lists public notices only — websites, apps, software, and
related digital or remote services — and links each one to the official notice.
"""
import csv, io, json, os, re, sys, datetime as dt, urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

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
    return bool(naics) and (naics.startswith(RELATED_PREFIXES) or naics in {"541990", "541430"})


# Place-of-performance state on the public extract. Full names show up often.
USPS = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS",
    "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC",
    "ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
    "PR","VI","GU","AS","MP",
}
STATE_NAMES = {
    "ALABAMA":"AL","ALASKA":"AK","ARIZONA":"AZ","ARKANSAS":"AR","CALIFORNIA":"CA","COLORADO":"CO",
    "CONNECTICUT":"CT","DELAWARE":"DE","DISTRICT OF COLUMBIA":"DC","FLORIDA":"FL","GEORGIA":"GA",
    "HAWAII":"HI","IDAHO":"ID","ILLINOIS":"IL","INDIANA":"IN","IOWA":"IA","KANSAS":"KS",
    "KENTUCKY":"KY","LOUISIANA":"LA","MAINE":"ME","MARYLAND":"MD","MASSACHUSETTS":"MA",
    "MICHIGAN":"MI","MINNESOTA":"MN","MISSISSIPPI":"MS","MISSOURI":"MO","MONTANA":"MT",
    "NEBRASKA":"NE","NEVADA":"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM",
    "NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND","OHIO":"OH","OKLAHOMA":"OK",
    "OREGON":"OR","PENNSYLVANIA":"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD",
    "TENNESSEE":"TN","TEXAS":"TX","UTAH":"UT","VERMONT":"VT","VIRGINIA":"VA","WASHINGTON":"WA",
    "WEST VIRGINIA":"WV","WISCONSIN":"WI","WYOMING":"WY","PUERTO RICO":"PR","GUAM":"GU",
    "VIRGIN ISLANDS":"VI","AMERICAN SAMOA":"AS","NORTHERN MARIANA ISLANDS":"MP",
}


def state_code(raw):
    text = clean(raw).upper()
    if text in USPS:
        return text
    return STATE_NAMES.get(text, "")


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


def deadline_date(raw):
    """Eastern calendar date of a deadline. A date-only value is that day, not UTC midnight."""
    text = (raw or "").strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return dt.date.fromisoformat(text)
    due = parse_due(text)
    if due is None:
        return None
    return due.astimezone(ET).date()


def is_before_today(raw, now):
    day = deadline_date(raw)
    if day is None:
        return False
    return day < now.astimezone(ET).date()


def consider(row, now):
    """Return a bid dict, or None when the notice is out of scope.

    Open, active, United States notices are kept for every NAICS code. Software
    and web codes stay marked core/related so the site can still filter them.
    Expired, foreign, inactive, and award-style rows are dropped.
    """
    naics = (row.get("NaicsCode") or "").strip()
    if not is_usa(row.get("PopCountry")):
        return None
    if (row.get("Active") or "").strip() != "Yes":
        return None
    if (row.get("Type") or "").strip() in SKIP_TYPES:
        return None
    if is_before_today(row.get("ResponseDeadLine"), now):
        return None
    title = clean(row.get("Title"), 220)
    summary = clean(row.get("Description"), 320)
    if is_core(naics):
        scope = "core"
    elif is_related_code(naics) and digital(title):
        scope = "related"
    else:
        scope = "general"
    text = f"{title} {summary}"
    nid = (row.get("NoticeId") or "").strip()
    if not nid:
        return None
    set_aside = clean(row.get("SetASide"))
    if not set_aside or set_aside.lower().startswith("no set"):
        set_aside = "None"
    place = ", ".join(x for x in [clean(row.get("PopCity")), clean(row.get("PopState"))] if x)
    posted = (row.get("PostedDate") or "").strip()[:10]
    deadline = (row.get("ResponseDeadLine") or "").strip()
    link = f"https://sam.gov/opp/{nid}/view"
    state = state_code(row.get("PopState"))
    return {
        "id": nid,
        "title": title,
        "solicitation": clean(row.get("Sol#")),
        "agency": agency_name(row.get("Department/Ind.Agency")),
        "subTier": agency_name(row.get("Sub-Tier")),
        "office": clean(row.get("Office")),
        "posted": posted,
        "due": deadline,
        "deadline": deadline,
        "type": clean(row.get("Type")),
        "naics": naics,
        "naicsLabel": CORE.get(naics, ""),
        "featured": scope == "core",
        "scope": scope,
        "remote": bool(REMOTE.search(text)),
        "setAside": set_aside,
        "setAsideCode": clean(row.get("SetASideCode")),
        "place": place,
        "state": state,
        "contact": clean(row.get("PrimaryContactEmail")),
        "link": link,
        "url": link,
        "summary": summary,
        "description": summary,
        "source": "SAM.gov",
    }


def cap_rows(rows, limit):
    """Keep every row under the limit. Above it, take the nearest deadlines
    round-robin by state so one state cannot fill the file."""
    rows = [b for b in rows if b]
    if limit <= 0 or len(rows) <= limit:
        return rows
    buckets = {}
    for bid in sorted(rows, key=lambda b: b.get("due") or "9999"):
        buckets.setdefault(bid.get("state") or "", []).append(bid)
    keys = sorted(buckets)
    out = []
    while len(out) < limit and any(buckets.values()):
        for key in keys:
            bucket = buckets[key]
            if not bucket:
                continue
            out.append(bucket.pop(0))
            if len(out) >= limit:
                break
    out.sort(key=lambda b: b.get("due") or "9999")
    return out


def write_bids(rows, now, dest="data/bids.json", scope_note=None, seen=None):
    rows = [b for b in rows if b]
    rows.sort(key=lambda b: b["due"])
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    meta = {
        "source": "SAM.gov Contract Opportunities public data extract (no API key)",
        "sourceUrl": "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public",
        "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(rows),
        "seen": seen if seen is not None else len(rows),
        "scope": scope_note or "Open United States notices from the public extract. Not every U.S. bid.",
        "featuredNaics": CORE,
    }
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "bids": rows}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, dest)
    core_n = sum(1 for b in rows if b["scope"] == "core")
    general_n = sum(1 for b in rows if b["scope"] == "general")
    print(f"wrote {len(rows)} bids to {dest} ({core_n} software/web, {general_n} other NAICS)")
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
    digital = [b for b in rows if b["scope"] in ("core", "related")]
    write_bids(
        digital, now, "data/bids.json",
        scope_note="USA websites, apps, software, and related digital services",
        seen=len(rows),
    )
    limit = int(os.environ.get("SAM_MAX", "10000"))
    broad = cap_rows(rows, limit)
    raw = os.environ.get("SAM_OUT", "data/raw/sam.json")
    write_bids(
        broad, now, raw,
        scope_note="Open United States notices, all NAICS. Capped for GitHub Pages when the extract is larger.",
        seen=len(rows),
    )


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
