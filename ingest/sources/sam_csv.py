"""SAM.gov Contract Opportunities public CSV extract. No API key."""

from __future__ import annotations

import csv
import datetime as dt
import io
import os
import sys
import tempfile

from ingest.categories import FEATURED, SKIP_TYPES, categories_for_sam, keep_sam_naics
from ingest.deadlines import parse_sam_deadline, still_open
from ingest.records import build_record
from ingest.security import RateLimiter, fetch, header_get, sam_csv_policy
from ingest.textutil import sanitize

SOURCE_ID = "sam-public-csv"
SOURCE_NAME = "SAM.gov Contract Opportunities public extract"
PAGE_URL = "https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public"
FALLBACK_URL = "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
INFO_URL = "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public"
DOCS_URL = "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public"
MAX_BYTES = 400_000_000


def set_aside(raw: str) -> str:
    text = sanitize(raw, 120)
    if not text or text.lower().startswith("no set"):
        return "None"
    return text


def parse_sam_csv(path: str, now: dt.datetime) -> tuple[list[dict], dict]:
    csv.field_size_limit(sys.maxsize)
    stats = {
        "scanned": 0,
        "matched": 0,
        "skippedNaics": 0,
        "skippedInactive": 0,
        "skippedType": 0,
        "skippedDeadline": 0,
    }
    records = []
    with open(path, "rb") as fh:
        text = io.TextIOWrapper(fh, encoding="cp1252", newline="")
        for row in csv.DictReader(text):
            stats["scanned"] += 1
            naics = (row.get("NaicsCode") or "").strip()
            if not keep_sam_naics(naics):
                stats["skippedNaics"] += 1
                continue
            if (row.get("Active") or "").strip() != "Yes":
                stats["skippedInactive"] += 1
                continue
            notice_type = (row.get("Type") or "").strip()
            if notice_type in SKIP_TYPES:
                stats["skippedType"] += 1
                continue
            raw_due = (row.get("ResponseDeadLine") or "").strip()
            if not raw_due:
                stats["skippedDeadline"] += 1
                continue
            deadline = parse_sam_deadline(raw_due)
            if not deadline["feed"]["iso"] or not still_open(deadline, now):
                stats["skippedDeadline"] += 1
                continue
            notice_id = (row.get("NoticeId") or "").strip()
            if not notice_id:
                stats["skippedDeadline"] += 1
                continue
            place = ", ".join(
                part for part in [
                    sanitize(row.get("PopCity"), 60),
                    sanitize(row.get("PopState"), 40),
                ] if part
            )
            record = build_record(
                source=SOURCE_ID,
                source_name=SOURCE_NAME,
                record_id=notice_id,
                title=row.get("Title") or "",
                solicitation=row.get("Sol#") or "",
                agency=sanitize(row.get("Department/Ind.Agency"), 180).title(),
                sub_tier=sanitize(row.get("Sub-Tier"), 180).title(),
                office=row.get("Office") or "",
                posted=(row.get("PostedDate") or "")[:10],
                deadline=deadline,
                notice_type=notice_type,
                naics=naics,
                naics_label=FEATURED.get(naics, ""),
                featured=naics in FEATURED,
                categories=categories_for_sam(naics, row.get("Title") or ""),
                set_aside=set_aside(row.get("SetASide") or ""),
                set_aside_code=row.get("SetASideCode") or "",
                place=place,
                contact=row.get("PrimaryContactEmail") or "",
                link=f"https://sam.gov/opp/{notice_id}/view",
                summary=row.get("Description") or "",
                jurisdiction="federal",
                provenance={
                    "sourceId": SOURCE_ID,
                    "sourceName": SOURCE_NAME,
                    "publisher": "U.S. General Services Administration",
                    "feedUrl": INFO_URL,
                    "retrievedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "recordId": notice_id,
                    "officialUrl": f"https://sam.gov/opp/{notice_id}/view",
                    "licenseNote": "SAM.gov public Contract Opportunities extract (privacy=Public). No API key.",
                },
            )
            records.append(record)
            stats["matched"] += 1
    return records, stats


def probe_sam_range(limiter: RateLimiter, opener=None, resolver=None) -> dict:
    """Confirm the documented extract with a small ranged GET. Stores no signed URL."""
    result = fetch(
        PAGE_URL,
        policy=sam_csv_policy,
        limiter=limiter,
        timeout=60,
        max_bytes=4000,
        headers={"Range": "bytes=0-800"},
        opener=opener,
        resolver=resolver,
    )
    text = result.body.decode("cp1252", errors="replace")
    return {
        "status": result.status,
        "finalHost": _host(result.final_url),
        "contentRange": header_get(result.headers, "Content-Range"),
        "lastModified": header_get(result.headers, "Last-Modified"),
        "privacy": header_get(result.headers, "x-amz-meta-privacy"),
        "contentLength": header_get(result.headers, "Content-Length"),
        "startsWithNoticeId": text.lstrip().startswith('"NoticeId"') or text.lstrip().startswith("NoticeId"),
        "signedUrlStored": False,
    }


def download_sam_csv(dest: str, limiter: RateLimiter, opener=None, resolver=None) -> dict:
    errors = []
    for url in (PAGE_URL, FALLBACK_URL):
        try:
            result = fetch(
                url,
                policy=sam_csv_policy,
                limiter=limiter,
                timeout=180,
                max_bytes=MAX_BYTES,
                opener=opener,
                resolver=resolver,
                dest_path=dest,
            )
            return {
                "status": result.status,
                "finalHost": _host(result.final_url),
                "lastModified": header_get(result.headers, "Last-Modified"),
                "privacy": header_get(result.headers, "x-amz-meta-privacy"),
                "contentLength": header_get(result.headers, "Content-Length"),
                "feedUpdated": header_get(result.headers, "x-amz-meta-lastmodifieddate"),
                "signedUrlStored": False,
                "via": "primary" if url == PAGE_URL else "s3-fallback",
            }
        except Exception as exc:
            errors.append(f"{_host(url)}: {exc}")
            if os.path.exists(dest):
                os.remove(dest)
    raise RuntimeError("; ".join(errors))


def load_sam(now, *, csv_path=None, limiter=None, opener=None, resolver=None, probe=False):
    limiter = limiter or RateLimiter()
    detail = {"docsUrl": DOCS_URL, "feedUrl": INFO_URL}
    if probe and not csv_path:
        try:
            detail["rangeProbe"] = probe_sam_range(limiter, opener=opener, resolver=resolver)
        except Exception as exc:
            detail["rangeProbeError"] = str(exc)
    temp_path = None
    try:
        if csv_path:
            path = csv_path
            detail["mode"] = "local-file"
        else:
            fd, temp_path = tempfile.mkstemp(prefix="sam-opps-", suffix=".csv")
            os.close(fd)
            detail.update(download_sam_csv(temp_path, limiter, opener=opener, resolver=resolver))
            path = temp_path
            detail["mode"] = "network"
        records, stats = parse_sam_csv(path, now)
        detail.update(stats)
        return {
            "id": SOURCE_ID,
            "status": "working",
            "message": f"Read {stats['matched']} open matching notices from {stats['scanned']} extract rows.",
            "records": records,
            "error": None,
            "detail": detail,
        }
    except Exception as exc:
        return {
            "id": SOURCE_ID,
            "status": "error",
            "message": "The SAM public extract could not be read. Previous federal notices are kept if this build already had them.",
            "records": [],
            "error": str(exc),
            "detail": detail,
        }
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def _host(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).hostname or ""
