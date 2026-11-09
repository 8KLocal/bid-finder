"""Attach hand-authored deadline checks. This module never parses PDFs."""

from __future__ import annotations

import json
from pathlib import Path

from ingest.dedup import normalize_sol


def load_verifications(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"deadline verification file is not valid JSON: {exc}") from exc
    rows = data.get("verifications", [])
    if not isinstance(rows, list):
        raise ValueError("deadline verification file has no verifications list")
    return rows


def apply_verifications(records: list[dict], verifications: list[dict]) -> tuple[list[dict], list[str]]:
    notes = []
    for rec in records:
        deadline = rec.setdefault("deadline", {})
        deadline.setdefault("feed", {})
        # Ingest code must not flip this on. A file may say true only if a person edited it.
        deadline["feed"]["pdfParsed"] = bool(deadline["feed"].get("pdfParsed", False))
        for item in verifications:
            if not _matches(rec, item):
                continue
            existing = deadline.get("verification") or {}
            if existing.get("id") and existing.get("id") == item.get("id"):
                break
            parsed_pdf = bool(item.get("parsedPdf", False))
            verification = {
                "id": item.get("id") or "",
                "method": item.get("method") or "note",
                "parsedPdf": parsed_pdf,
                "independentlyParsedByIngest": False,
                "reportedDeadlineRaw": item.get("reportedDeadlineRaw") or "",
                "documentRef": item.get("documentRef") or "",
                "note": item.get("note") or "",
                "acceptAsControlling": bool(item.get("acceptAsControlling", False)),
            }
            deadline["verification"] = verification
            feed_raw = (deadline.get("feed") or {}).get("raw") or rec.get("dueRaw") or ""
            reported = verification["reportedDeadlineRaw"]
            differs = bool(reported) and reported not in feed_raw
            if differs:
                deadline["conflict"] = True
                deadline["conflictNote"] = _conflict_note(feed_raw, verification)
            if (
                verification["acceptAsControlling"]
                and item.get("iso")
                and verification["method"] != "source-research-note"
            ):
                rec["due"] = item["iso"]
                deadline["controlling"] = "verified"
                deadline["feed"]["assumption"] = (
                    (deadline["feed"].get("assumption") or "")
                    + " Controlling instant replaced from an explicit verification record."
                ).strip()
            else:
                deadline["controlling"] = deadline.get("controlling") or "feed"
            notes.append(
                f"verification {verification['id']} attached to {rec.get('uid')}; "
                f"parsedPdf={str(parsed_pdf).lower()}; controlling={deadline['controlling']}"
            )
            break
    return records, notes


def _matches(rec: dict, item: dict) -> bool:
    if item.get("source") and rec.get("source") != item.get("source"):
        return False
    if item.get("org") and rec.get("org") != item.get("org"):
        return False
    wanted = item.get("solicitation")
    if wanted and normalize_sol(rec.get("solicitation") or "") != normalize_sol(wanted):
        return False
    needle = item.get("feedRawContains") or ""
    if needle:
        raw = " ".join([
            rec.get("dueRaw") or "",
            ((rec.get("deadline") or {}).get("feed") or {}).get("raw") or "",
        ])
        if needle not in raw:
            return False
    return True


def _conflict_note(feed_raw: str, verification: dict) -> str:
    parsed = "The solicitation PDF was parsed." if verification.get("parsedPdf") else (
        "This ingest did not parse the solicitation PDF, so the feed deadline was not replaced."
    )
    reported = verification.get("reportedDeadlineRaw") or "a different time"
    ref = verification.get("documentRef") or "a separate note"
    return (
        f"Deadline conflict: the feed says {feed_raw}. "
        f"A verification note reports {reported} ({ref}). {parsed} "
        "Confirm the controlling time on the official notice."
    )
