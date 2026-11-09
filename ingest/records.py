"""Shape every opportunity the static site already knows how to read."""

from __future__ import annotations

import hashlib

from ingest.textutil import sanitize


def build_record(
    *,
    source: str,
    source_name: str,
    record_id: str,
    title: str,
    solicitation: str = "",
    agency: str = "",
    sub_tier: str = "",
    office: str = "",
    posted: str = "",
    due: str = "",
    due_raw: str = "",
    deadline: dict | None = None,
    notice_type: str = "",
    naics: str = "",
    naics_label: str = "",
    featured: bool = False,
    categories: list | None = None,
    set_aside: str = "None",
    set_aside_code: str = "",
    place: str = "",
    contact: str = "",
    link: str = "",
    portal_url: str = "",
    summary: str = "",
    jurisdiction: str = "",
    org: str = "",
    addenda: list | None = None,
    provenance: dict | None = None,
) -> dict:
    deadline = deadline or {}
    feed = deadline.get("feed") or {}
    due_value = due or feed.get("iso") or ""
    raw_value = due_raw or feed.get("raw") or due_value
    canonical = sanitize(solicitation, 80) or sanitize(record_id, 80)
    provenance = dict(provenance or {})
    provenance.setdefault("sourceId", source)
    provenance.setdefault("officialUrl", link)
    provenance.setdefault("recordId", record_id)
    rec = {
        "id": sanitize(record_id, 80),
        "uid": f"{source}:{sanitize(record_id, 80)}",
        "canonicalId": canonical,
        "title": sanitize(title, 220),
        "solicitation": sanitize(solicitation, 80),
        "agency": sanitize(agency, 180),
        "subTier": sanitize(sub_tier, 220),
        "office": sanitize(office, 180),
        "posted": sanitize(posted, 40),
        "due": due_value,
        "dueRaw": raw_value,
        "dueTimezone": feed.get("timezone") or "",
        "duePrecision": feed.get("precision") or "",
        "dueAssumption": feed.get("assumption") or "",
        "dueBasis": "feed" if feed.get("confident") else ("assumed-zone" if feed.get("timezone") else "unspecified"),
        "deadline": deadline,
        "type": sanitize(notice_type, 80),
        "naics": sanitize(naics, 12),
        "naicsLabel": sanitize(naics_label, 80),
        "featured": bool(featured),
        "categories": list(categories or []),
        "setAside": sanitize(set_aside, 120) or "None",
        "setAsideCode": sanitize(set_aside_code, 20),
        "place": sanitize(place, 120),
        "contact": sanitize(contact, 120),
        "link": link,
        "portalUrl": portal_url,
        "summary": sanitize(summary, 600),
        "jurisdiction": jurisdiction,
        "source": source,
        "sourceName": source_name,
        "org": org,
        "addenda": list(addenda or []),
        "alsoSeen": [],
        "demo": False,
        "provenance": provenance,
    }
    payload = "|".join([
        rec["source"], rec["id"], rec["title"], rec["solicitation"], rec["dueRaw"], rec["link"],
    ])
    provenance["contentHash"] = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return rec
