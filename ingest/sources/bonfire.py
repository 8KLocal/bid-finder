"""Keyless Bonfire public RSS for organizations we have checked by hand.

There is no public directory of Bonfire tenants. Only slugs whose
/opportunities/rss URL has been fetched successfully belong in ORGS.
"""

from __future__ import annotations

import datetime as dt
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from ingest.categories import categories_for_text
from ingest.deadlines import parse_rss_close, still_open
from ingest.records import build_record
from ingest.security import bonfire_policy_for, fetch
from ingest.textutil import sanitize

SOURCE_ID = "bonfire-suffolkcountyny"
SOURCE_NAME = "Suffolk County, NY — Bonfire public opportunities RSS"
ORGS = [
    {
        "slug": "suffolkcountyny",
        "name": "Suffolk County, New York",
        "agency": "Suffolk County",
        "place": "Suffolk County, NY",
        "rss": "https://suffolkcountyny.bonfirehub.com/opportunities/rss",
    }
]
_TITLE = re.compile(r"Reference\s*#:\s*(.+?)\.\s*Name:\s*(.+)", re.I)
_BEHALF = re.compile(r"on behalf of (?:the )?(.+?), invites", re.I)
_LINK_ID = re.compile(r"/opportunities/(\d+)/?$")


def parse_bonfire_rss(xml_bytes: bytes, org: dict, now: dt.datetime) -> tuple[list[dict], dict]:
    text = xml_bytes.decode("utf-8", errors="replace")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("Bonfire RSS contained a DTD, which this parser refuses")
    root = ET.fromstring(text)
    channel = root.find("channel")
    items = channel.findall("item") if channel is not None else root.findall(".//item")
    stats = {"scanned": 0, "matched": 0, "skippedCategory": 0, "skippedClosed": 0, "skippedLink": 0}
    records = []
    slug = org["slug"]
    for item in items:
        stats["scanned"] += 1
        title_raw = _text(item.find("title"))
        description = _text(item.find("description"))
        link = _text(item.find("link"))
        if not _link_ok(link, slug):
            stats["skippedLink"] += 1
            continue
        title_match = _TITLE.search(title_raw)
        solicitation = title_match.group(1).strip() if title_match else ""
        title = title_match.group(2).strip() if title_match else title_raw
        categories = categories_for_text(title, description)
        if not categories:
            stats["skippedCategory"] += 1
            continue
        deadline = parse_rss_close(description)
        if deadline["feed"]["iso"] and not still_open(deadline, now):
            stats["skippedClosed"] += 1
            continue
        behalf = _BEHALF.search(description)
        posted = _posted(_text(item.find("pubDate")))
        record_id = _LINK_ID.search(link).group(1)
        records.append(build_record(
            source=SOURCE_ID,
            source_name=SOURCE_NAME,
            record_id=record_id,
            title=title,
            solicitation=solicitation,
            agency=org["agency"],
            sub_tier=behalf.group(1).strip() if behalf else "",
            posted=posted,
            deadline=deadline,
            notice_type="Bonfire public opportunity",
            featured=True,
            categories=categories,
            place=org["place"],
            link=link,
            summary=description,
            jurisdiction="local",
            org=slug,
            provenance={
                "sourceId": SOURCE_ID,
                "sourceName": SOURCE_NAME,
                "publisher": org["name"],
                "feedUrl": org["rss"],
                "retrievedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "recordId": record_id,
                "officialUrl": link,
                "licenseNote": "Public Bonfire RSS of currently open opportunities. No login and no API key. Close times are the RSS text; solicitation PDFs are not parsed.",
            },
        ))
        stats["matched"] += 1
    return records, stats


def load_bonfire(now, *, limiter, opener=None, resolver=None, orgs=None):
    orgs = orgs or ORGS
    policy = bonfire_policy_for([org["slug"] for org in orgs])
    records = []
    scanned = matched = 0
    errors = []
    for org in orgs:
        try:
            result = fetch(
                org["rss"],
                policy=policy,
                limiter=limiter,
                timeout=45,
                max_bytes=2_000_000,
                opener=opener,
                resolver=resolver,
                headers={"Accept": "application/rss+xml, application/xml, text/xml"},
            )
            parsed, stats = parse_bonfire_rss(result.body, org, now)
        except Exception as exc:
            errors.append(f"{org['slug']}: {exc}")
            continue
        records.extend(parsed)
        scanned += stats["scanned"]
        matched += stats["matched"]
    if errors and not records:
        return {
            "id": SOURCE_ID,
            "status": "error",
            "message": "The Bonfire RSS could not be read.",
            "records": [],
            "error": "; ".join(errors),
            "detail": {"scanned": scanned, "matched": matched},
        }
    message = (
        f"Read {scanned} open RSS items from {len(orgs)} Bonfire organization"
        f"{'' if len(orgs) == 1 else 's'}; {matched} matched website, app, software, design, or marketing."
    )
    if errors:
        message += " Some organizations failed: " + "; ".join(errors)
    return {
        "id": SOURCE_ID,
        "status": "working" if not errors else "error",
        "message": message,
        "records": records,
        "error": "; ".join(errors) or None,
        "detail": {"scanned": scanned, "matched": matched, "orgs": [org["slug"] for org in orgs]},
    }


def _text(node) -> str:
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _link_ok(url: str, slug: str) -> bool:
    from urllib.parse import urlparse
    parts = urlparse(url or "")
    return (
        parts.scheme == "https"
        and (parts.hostname or "").lower() == f"{slug.lower()}.bonfirehub.com"
        and parts.path.startswith("/opportunities/")
        and _LINK_ID.search(parts.path) is not None
    )


def _posted(pub_date: str) -> str:
    if not pub_date:
        return ""
    try:
        return parsedate_to_datetime(pub_date).date().isoformat()
    except (TypeError, ValueError, IndexError):
        return ""
