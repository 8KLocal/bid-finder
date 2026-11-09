"""NYC City Record Online solicitations from the public Socrata dataset.

PASSPort is the City's submission site. This adapter does not call PASSPort
and does not invent per-solicitation PASSPort links.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from ingest.categories import categories_for_text
from ingest.deadlines import instant, parse_socrata_timestamp, still_open
from ingest.records import build_record
from ingest.security import fetch, nyc_policy
from ingest.textutil import sanitize

SOURCE_ID = "nyc-crol"
SOURCE_NAME = "NYC City Record Online (Socrata)"
RESOURCE = "https://data.cityofnewyork.us/resource/dg92-zbpx.json"
DATASET_URL = "https://data.cityofnewyork.us/City-Government/City-Record-Online/dg92-zbpx"
DETAIL = "https://a856-cityrecord.nyc.gov/RequestDetail/{}"
PASSPORT_NOTE = (
    "Submission is often on NYC PASSPort. This row is the City Record publication. "
    "No PASSPort bulk feed was used and no per-solicitation PASSPort link was invented."
)
_ID = re.compile(r"^[0-9]{5,24}$")
_ADDENDA = re.compile(r"\b(addend(?:um|a)|amend(?:ment|ed))\b", re.I)
_SELECT = ",".join([
    "request_id", "start_date", "agency_name", "type_of_notice_description",
    "category_description", "short_title", "selection_method_description", "pin",
    "due_date", "additional_description_1", "additional_description_2",
    "additional_description_3", "document_links", "email",
])


def load_nyc(now, *, limiter, opener=None, resolver=None):
    eastern_day = now.astimezone(ZoneInfo("America/New_York")).date() - dt.timedelta(days=1)
    where = (
        "type_of_notice_description='Solicitation' AND due_date >= "
        f"'{eastern_day.isoformat()}T00:00:00.000'"
    )
    detail = {
        "datasetUrl": DATASET_URL,
        "resource": RESOURCE,
        "passportBulk": False,
    }
    try:
        counted = _get_json(limiter, {"$select": "count(*)", "$where": "type_of_notice_description='Solicitation'"},
                            opener=opener, resolver=resolver)
        detail["solicitationRows"] = int(counted[0]["count"]) if counted else None
    except Exception as exc:
        detail["solicitationRows"] = None
        detail["countError"] = str(exc)
    try:
        rows = _get_json(
            limiter,
            {"$select": _SELECT, "$where": where, "$limit": "5000", "$order": "due_date"},
            opener=opener,
            resolver=resolver,
        )
    except Exception as exc:
        return {
            "id": SOURCE_ID,
            "status": "error",
            "message": "NYC City Record could not be read. No substitute rows were created.",
            "records": [],
            "error": str(exc),
            "detail": detail,
        }
    records, stats = parse_nyc_rows(rows, now)
    detail.update(stats)
    return {
        "id": SOURCE_ID,
        "status": "working",
        "message": (
            f"City Record returned {stats['scanned']} solicitation rows with a due date on or after "
            f"{eastern_day.isoformat()}. {stats['matched']} matched website, app, software, design, or marketing. "
            f"Dataset solicitation count: {detail.get('solicitationRows')}."
        ),
        "records": records,
        "error": None,
        "detail": detail,
    }


def parse_nyc_rows(rows: list[dict], now: dt.datetime) -> tuple[list[dict], dict]:
    stats = {
        "scanned": 0, "matched": 0, "skippedCategory": 0, "skippedClosed": 0,
        "skippedId": 0, "skippedPlaceholder": 0,
    }
    records = []
    for row in rows:
        stats["scanned"] += 1
        request_id = str(row.get("request_id") or "").strip()
        if not _ID.match(request_id):
            stats["skippedId"] += 1
            continue
        title = row.get("short_title") or ""
        summary = " ".join(
            sanitize(row.get(key), 1500)
            for key in ("additional_description_1", "additional_description_2", "additional_description_3")
        )
        categories = categories_for_text(title, summary)
        if not categories:
            stats["skippedCategory"] += 1
            continue
        deadline = parse_socrata_timestamp(str(row.get("due_date") or ""))
        if deadline["feed"]["iso"] and not still_open(deadline, now):
            stats["skippedClosed"] += 1
            continue
        when = instant(deadline)
        if when is not None and when.year >= now.year + 15:
            stats["skippedPlaceholder"] = stats.get("skippedPlaceholder", 0) + 1
            continue
        pin = str(row.get("pin") or "").strip()
        document = _document_link(row.get("document_links"))
        link = DETAIL.format(request_id)
        addenda = []
        if _ADDENDA.search(summary):
            addenda.append({
                "noticeId": request_id,
                "source": SOURCE_ID,
                "posted": str(row.get("start_date") or "")[:10],
                "type": "mentioned",
                "title": title,
                "link": document or link,
                "dueRaw": deadline["feed"]["raw"],
                "due": deadline["feed"]["iso"],
                "note": "The City Record text mentions an addendum or amendment. That document was not downloaded.",
            })
        records.append(build_record(
            source=SOURCE_ID,
            source_name=SOURCE_NAME,
            record_id=request_id,
            title=title,
            solicitation=pin,
            agency=row.get("agency_name") or "New York City",
            posted=str(row.get("start_date") or "")[:10],
            deadline=deadline,
            notice_type=row.get("selection_method_description") or row.get("type_of_notice_description") or "Solicitation",
            featured=True,
            categories=categories,
            place="New York, NY",
            contact=row.get("email") or "",
            link=link,
            portal_url=document,
            summary=summary,
            jurisdiction="local",
            addenda=addenda,
            provenance={
                "sourceId": SOURCE_ID,
                "sourceName": SOURCE_NAME,
                "publisher": "NYC Department of Citywide Administrative Services",
                "feedUrl": RESOURCE,
                "datasetUrl": DATASET_URL,
                "retrievedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "recordId": request_id,
                "officialUrl": link,
                "category": row.get("category_description") or "",
                "note": PASSPORT_NOTE,
            },
        ))
        stats["matched"] += 1
    return records, stats


def _document_link(value) -> str:
    if isinstance(value, dict):
        raw = value.get("url") or ""
    elif isinstance(value, str):
        raw = value
    else:
        return ""
    raw = sanitize(raw, 400).replace(" ", "")
    parts = urlparse(raw)
    if parts.scheme == "https" and (parts.hostname or "").lower() == "a856-cityrecord.nyc.gov":
        return raw
    return ""


def _get_json(limiter, params: dict, opener=None, resolver=None):
    url = RESOURCE + "?" + urlencode(params)
    result = fetch(
        url,
        policy=nyc_policy,
        limiter=limiter,
        timeout=90,
        max_bytes=12_000_000,
        opener=opener,
        resolver=resolver,
        headers={"Accept": "application/json"},
    )
    data = json.loads(result.body.decode("utf-8"))
    if not isinstance(data, list):
        raise ValueError("NYC City Record response was not a JSON list")
    return data
