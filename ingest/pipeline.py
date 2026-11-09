"""Build data/bids.json, data/sources.json, and data/runs.json."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path

from ingest.catalog import COVERAGE_NOTE, catalog
from ingest.categories import CATEGORY_LABELS, FEATURED
from ingest.deadlines import parse_sam_deadline, still_open
from ingest.dedup import dedup
from ingest.security import RateLimiter
from ingest.sources.bonfire import load_bonfire
from ingest.sources.nyc_crol import load_nyc
from ingest.sources.sam_api import load_sam_api
from ingest.sources.sam_csv import load_sam
from ingest.verify import apply_verifications, load_verifications

RUN_LIMIT = 30


def run(dest: Path, now: dt.datetime, *, env=None, sam_csv=None, smoke=False,
        limiter=None, opener=None, resolver=None) -> dict:
    dest = Path(dest)
    data = dest / "data"
    data.mkdir(parents=True, exist_ok=True)
    env = env if env is not None else os.environ
    limiter = limiter or RateLimiter(min_interval=1.0, max_requests=40)
    started = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    previous = _load_json(data / "bids.json")
    previous_records = [_normalize_old(rec) for rec in previous.get("bids", [])]
    previous_sources = {row["id"]: row for row in _load_json(data / "sources.json").get("sources", [])}
    try:
        verifications = load_verifications(data / "deadline-verifications.json")
        verification_error = None
    except ValueError as exc:
        verifications = []
        verification_error = str(exc)

    outcomes = [
        load_sam(now, csv_path=sam_csv, limiter=limiter, opener=opener, resolver=resolver, probe=smoke),
        load_sam_api(now, env=env, limiter=limiter, opener=opener, resolver=resolver, probe=smoke),
        load_bonfire(now, limiter=limiter, opener=opener, resolver=resolver),
        load_nyc(now, limiter=limiter, opener=opener, resolver=resolver),
    ]
    fresh = []
    preserved_ids = []
    for outcome in outcomes:
        if outcome["status"] == "working":
            fresh.extend(rec for rec in outcome["records"] if not rec.get("demo"))
        elif outcome["status"] == "error":
            kept = []
            for rec in previous_records:
                if rec.get("source") != outcome["id"] or rec.get("demo"):
                    continue
                rec = _normalize_old(rec)
                provenance = dict(rec.get("provenance") or {})
                provenance["stale"] = True
                provenance["staleReason"] = outcome.get("error") or "fetch failed"
                rec["provenance"] = provenance
                if _open_enough(rec, now):
                    kept.append(rec)
            fresh.extend(kept)
            if kept:
                preserved_ids.append(outcome["id"])

    fresh, verification_notes = apply_verifications(fresh, verifications)
    opportunities, dedup_stats = dedup(fresh)
    finished = dt.datetime.now(dt.timezone.utc)
    sources = _sources(outcomes, previous_sources, opportunities, now, preserved_ids)
    run_row = {
        "id": started,
        "startedAt": started,
        "finishedAt": finished.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": _run_status(outcomes),
        "dedup": dedup_stats,
        "preservedSources": preserved_ids,
        "verificationNotes": verification_notes,
        "verificationFileError": verification_error,
        "sources": [
            {
                "id": item["id"],
                "status": item["status"],
                "matched": (item.get("detail") or {}).get("matched"),
                "scanned": (item.get("detail") or {}).get("scanned"),
                "error": item.get("error"),
                "message": item.get("message"),
            }
            for item in outcomes
        ],
        "opportunityCount": len(opportunities),
        "notes": _history_note(data / "runs.json"),
    }
    meta = {
        "kind": "live",
        "demo": False,
        "source": "Primary public feeds only. See data/sources.json for what is actually ingested.",
        "sourceUrl": "data/sources.json",
        "updated": finished.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(opportunities),
        "coverageNote": COVERAGE_NOTE,
        "featuredNaics": FEATURED,
        "categories": [{"id": key, "label": label} for key, label in CATEGORY_LABELS.items()],
        "dedup": dedup_stats,
    }
    _write(data / "bids.json", {"meta": meta, "bids": opportunities}, pretty=False)
    _write(data / "sources.json", {
        "updated": meta["updated"],
        "kind": "live",
        "demo": False,
        "coverageNote": COVERAGE_NOTE,
        "sources": sources,
    }, pretty=True)
    runs_doc = _load_json(data / "runs.json")
    runs = [run_row] + [row for row in runs_doc.get("runs", []) if row.get("id") != run_row["id"]]
    _write(data / "runs.json", {"kind": "live", "demo": False, "runs": runs[:RUN_LIMIT]}, pretty=True)
    return {
        "status": run_row["status"],
        "count": len(opportunities),
        "outcomes": outcomes,
        "dedup": dedup_stats,
        "run": run_row,
        "sources": sources,
    }


def _open_enough(rec: dict, now: dt.datetime) -> bool:
    deadline = rec.get("deadline") or {}
    if (deadline.get("feed") or {}).get("iso") or (deadline.get("feed") or {}).get("precision") == "unknown":
        return still_open(deadline, now)
    if rec.get("due"):
        return still_open(parse_sam_deadline(rec["due"]), now)
    return False


def _normalize_old(rec: dict) -> dict:
    rec = dict(rec)
    rec.setdefault("source", "sam-public-csv")
    rec.setdefault("uid", f"{rec['source']}:{rec.get('id')}")
    rec.setdefault("demo", False)
    if rec.get("due") and not (rec.get("deadline") or {}).get("feed"):
        rec["deadline"] = parse_sam_deadline(rec["due"])
    return rec


def _sources(outcomes, previous, opportunities, now, preserved_ids) -> list[dict]:
    by_id = {item["id"]: item for item in outcomes}
    counts = {}
    for rec in opportunities:
        counts[rec.get("source")] = counts.get(rec.get("source"), 0) + 1
    rows = []
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    for base in catalog():
        row = dict(base)
        outcome = by_id.get(row["id"])
        if outcome:
            row["status"] = outcome["status"]
            row["message"] = outcome["message"]
            row["error"] = outcome.get("error")
            row["lastAttempt"] = stamp
            detail = outcome.get("detail") or {}
            row["scanned"] = detail.get("scanned")
            row["matched"] = detail.get("matched")
            row["detail"] = {k: v for k, v in detail.items() if k != "rangeProbe"}
            if detail.get("rangeProbe"):
                row["rangeProbe"] = detail["rangeProbe"]
            if outcome["status"] == "working":
                row["lastSuccess"] = stamp
                row["feedLastModified"] = detail.get("lastModified") or detail.get("feedUpdated") or ""
            else:
                row["lastSuccess"] = (previous.get(row["id"]) or {}).get("lastSuccess")
            if row["id"] in preserved_ids:
                row["showingPreviousRecords"] = True
        else:
            row["message"] = row["notes"]
            row["error"] = None
            row["lastAttempt"] = None
            row["lastSuccess"] = None
            row["scanned"] = None
            row["matched"] = None
        row["opportunities"] = counts.get(row["id"], 0)
        rows.append(row)
    return rows


def _run_status(outcomes) -> str:
    fetched = [item for item in outcomes if item["status"] != "config-required"]
    if fetched and all(item["status"] == "working" for item in fetched):
        return "success"
    if any(item["status"] == "working" for item in fetched):
        return "partial"
    return "failed"


def _history_note(path: Path) -> str:
    if path.exists() and _load_json(path).get("runs"):
        return ""
    return (
        "No earlier automated run is stored. .github/workflows was not in the "
        "repository, so the scheduled refresh had not been running."
    )


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write(path: Path, payload: dict, *, pretty: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if pretty:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Refresh Q8 Bid Finder public opportunity data")
    parser.add_argument("sam_csv", nargs="?", help="Optional local SAM CSV instead of the network extract")
    parser.add_argument("--dest", default=".", help="Repository root to write data/ into")
    parser.add_argument("--smoke-out", help="Also write a redacted verification report")
    args = parser.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    result = run(
        Path(args.dest),
        now,
        sam_csv=args.sam_csv,
        smoke=bool(args.smoke_out),
    )
    for outcome in result["outcomes"]:
        print(f"{outcome['id']}: {outcome['status']} — {outcome['message']}")
    print(f"wrote {result['count']} opportunities ({result['status']})")
    if args.smoke_out:
        _write_smoke(Path(args.smoke_out), result)
    if result["status"] == "success":
        return 0
    if result["status"] == "partial":
        return 2
    return 1


def _write_smoke(path: Path, result: dict) -> None:
    by_id = {item["id"]: item for item in result["outcomes"]}
    payload = {
        "kind": "verification",
        "demo": False,
        "verifiedAt": result["run"]["finishedAt"],
        "signedUrlStored": False,
        "recordsInvented": False,
        "samPublicCsv": {
            "status": by_id["sam-public-csv"]["status"],
            "message": by_id["sam-public-csv"]["message"],
            "error": by_id["sam-public-csv"].get("error"),
            "detail": by_id["sam-public-csv"].get("detail"),
        },
        "samOpportunitiesApi": {
            "status": by_id["sam-opportunities-api"]["status"],
            "message": by_id["sam-opportunities-api"]["message"],
            "records": len(by_id["sam-opportunities-api"]["records"]),
            "detail": by_id["sam-opportunities-api"].get("detail"),
        },
        "bonfireSuffolk": {
            "status": by_id["bonfire-suffolkcountyny"]["status"],
            "message": by_id["bonfire-suffolkcountyny"]["message"],
            "detail": by_id["bonfire-suffolkcountyny"].get("detail"),
        },
        "nycCrol": {
            "status": by_id["nyc-crol"]["status"],
            "message": by_id["nyc-crol"]["message"],
            "detail": by_id["nyc-crol"].get("detail"),
        },
        "dedup": result["dedup"],
        "opportunityCount": result["count"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
