"""SAM.gov Get Opportunities Public API.

Without SAM_API_KEY this adapter records config-required and returns no rows.
It does not invent opportunities. A key alone still does not call the API
until SAM_API_ENABLE=1, because personal keys are quota-limited and the daily
public CSV is the federal source of record for this build.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from urllib.parse import urlencode

from ingest.categories import FEATURED, categories_for_sam, keep_sam_naics
from ingest.deadlines import parse_sam_deadline, still_open
from ingest.records import build_record
from ingest.security import fetch, sam_api_policy
from ingest.textutil import sanitize

SOURCE_ID = "sam-opportunities-api"
SOURCE_NAME = "SAM.gov Get Opportunities Public API"
ENDPOINT = "https://api.sam.gov/opportunities/v2/search"
DOCS_URL = "https://open.gsa.gov/api/get-opportunities-public-api/"
NOT_CONFIGURED = (
    "SAM.gov Get Opportunities API is not configured (no API key). "
    "Set SAM_API_KEY to a key from your own SAM.gov Account Details page. "
    "No records were fetched or invented."
)
KEY_DISABLED = (
    "SAM_API_KEY is set, but SAM_API_ENABLE is not 1, so this adapter did not "
    "call the API and did not add records. The daily public CSV remains the federal source."
)


def load_sam_api(now, *, env=None, limiter=None, opener=None, resolver=None, probe=False):
    env = env if env is not None else os.environ
    key = (env.get("SAM_API_KEY") or env.get("SAM_GOV_API_KEY") or "").strip()
    detail = {"docsUrl": DOCS_URL, "endpoint": ENDPOINT, "calls": 0}
    if not key:
        if probe and limiter is not None:
            detail["unconfiguredProbe"] = _probe_without_key(limiter, opener, resolver)
        return _result("config-required", NOT_CONFIGURED, detail, error=None)
    if (env.get("SAM_API_ENABLE") or "").strip() != "1":
        return _result("config-required", KEY_DISABLED, detail, error=None)
    if limiter is None:
        raise RuntimeError("SAM API fetch requires the shared rate limiter")
    posted_to = now.astimezone(dt.timezone.utc).strftime("%m/%d/%Y")
    posted_from = (now - dt.timedelta(days=7)).astimezone(dt.timezone.utc).strftime("%m/%d/%Y")
    query = urlencode({
        "api_key": key,
        "postedFrom": posted_from,
        "postedTo": posted_to,
        "limit": "100",
    })
    url = f"{ENDPOINT}?{query}"
    try:
        result = fetch(
            url,
            policy=sam_api_policy,
            limiter=limiter,
            timeout=45,
            max_bytes=5_000_000,
            opener=opener,
            resolver=resolver,
            headers={"Accept": "application/json"},
        )
        detail["calls"] = 1
        detail["httpStatus"] = result.status
        payload = json.loads(result.body.decode("utf-8"))
    except Exception as exc:
        detail["calls"] = 1
        return _result(
            "error",
            "The SAM Opportunities API request failed. No substitute records were created.",
            detail,
            error=_redact(str(exc), key),
        )
    rows = payload.get("opportunitiesData") or payload.get("opportunities") or []
    if not isinstance(rows, list):
        return _result("error", "SAM API response did not include an opportunity list.", detail,
                       error="unexpected JSON shape")
    records = []
    for row in rows:
        naics = str(row.get("naicsCode") or row.get("ncode") or "").strip()
        if not keep_sam_naics(naics):
            continue
        raw_due = str(row.get("responseDeadLine") or row.get("responseDl") or "").strip()
        deadline = parse_sam_deadline(raw_due) if raw_due else None
        if deadline is None or not still_open(deadline, now):
            continue
        notice_id = str(row.get("noticeId") or "").strip()
        if not notice_id:
            continue
        title = row.get("title") or ""
        records.append(build_record(
            source=SOURCE_ID,
            source_name=SOURCE_NAME,
            record_id=notice_id,
            title=title,
            solicitation=str(row.get("solicitationNumber") or ""),
            agency=sanitize(row.get("fullParentPathName") or row.get("departmentName") or "", 180),
            posted=str(row.get("postedDate") or "")[:10],
            deadline=deadline,
            notice_type=str(row.get("type") or row.get("baseType") or ""),
            naics=naics,
            naics_label=FEATURED.get(naics, ""),
            featured=naics in FEATURED,
            categories=categories_for_sam(naics, title),
            set_aside=sanitize(row.get("typeOfSetAsideDescription") or "", 120) or "None",
            link=f"https://sam.gov/opp/{notice_id}/view",
            summary=row.get("description") if isinstance(row.get("description"), str) else "",
            jurisdiction="federal",
            provenance={
                "sourceId": SOURCE_ID,
                "sourceName": SOURCE_NAME,
                "publisher": "U.S. General Services Administration",
                "feedUrl": DOCS_URL,
                "retrievedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "recordId": notice_id,
                "officialUrl": f"https://sam.gov/opp/{notice_id}/view",
                "licenseNote": "Get Opportunities Public API. Description text is often a separate URL and is not fetched here.",
            },
        ))
    detail["returned"] = len(rows)
    detail["matched"] = len(records)
    return _result(
        "working",
        f"API returned {len(rows)} notices in one bounded call; {len(records)} matched the existing NAICS keep-set.",
        detail,
        records=records,
    )


def _probe_without_key(limiter, opener, resolver) -> dict:
    """One unauthenticated request, recorded as a status code. Never turned into rows."""
    try:
        result = fetch(
            ENDPOINT,
            policy=sam_api_policy,
            limiter=limiter,
            timeout=30,
            max_bytes=4000,
            opener=opener,
            resolver=resolver,
            headers={"Accept": "application/json"},
        )
        return {"httpStatus": result.status, "bodyBytes": len(result.body), "recordsInvented": False}
    except Exception as exc:
        text = str(exc)
        status = None
        for code in (404, 401, 403, 400):
            if str(code) in text:
                status = code
                break
        return {"httpStatus": status, "error": text, "recordsInvented": False}


def _result(status, message, detail, records=None, error=None):
    return {
        "id": SOURCE_ID,
        "status": status,
        "message": message,
        "records": records or [],
        "error": error,
        "detail": detail,
    }


def _redact(text: str, key: str) -> str:
    if key:
        text = text.replace(key, "[redacted]")
    return text
