"""Cluster notices that are the same solicitation and keep the others as addenda."""

from __future__ import annotations

import re

from ingest.deadlines import iso_conflict

_BAD_SOL = {"", "NA", "N/A", "NONE", "TBD", "NULL", "UNKNOWN"}
_AGENCY_STOP = {
    "COUNTY", "CITY", "DEPARTMENT", "OF", "THE", "AND", "OFFICE", "STATE",
    "NEW", "YORK", "SERVICES", "SERVICE",
}


def normalize_sol(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip().upper())


def normalize_agency(value: str) -> str:
    text = re.sub(r"[^A-Z0-9]+", " ", (value or "").upper())
    return re.sub(r"\s+", " ", text).strip()


def _usable_sol(sol: str) -> bool:
    return len(sol) >= 3 and sol not in _BAD_SOL


def _agency_compatible(left: str, right: str) -> bool:
    if not left or not right:
        return False
    if left == right or left in right or right in left:
        return True
    stop = _AGENCY_STOP
    a = {tok for tok in left.split() if tok not in stop}
    b = {tok for tok in right.split() if tok not in stop}
    if not a or not b:
        return False
    shared = a & b
    return len(shared) >= 1 and len(shared) / max(len(a), len(b)) >= 0.5


def _posted_key(rec: dict) -> tuple:
    return (rec.get("posted") or "", rec.get("id") or "")


def _as_addendum(rec: dict) -> dict:
    return {
        "noticeId": rec.get("id") or "",
        "source": rec.get("source") or "",
        "posted": rec.get("posted") or "",
        "type": rec.get("type") or "",
        "title": rec.get("title") or "",
        "link": rec.get("link") or "",
        "dueRaw": rec.get("dueRaw") or "",
        "due": rec.get("due") or "",
        "note": "Another notice with the same solicitation number. The document was not downloaded.",
    }


def _flag_deadline(primary: dict, others: list[dict]) -> None:
    primary_iso = ((primary.get("deadline") or {}).get("feed") or {}).get("iso") or ""
    disagree = []
    for other in others:
        other_iso = ((other.get("deadline") or {}).get("feed") or {}).get("iso") or ""
        if iso_conflict(primary_iso, other_iso):
            disagree.append(other.get("dueRaw") or other_iso)
    if not disagree:
        return
    deadline = primary.setdefault("deadline", {})
    deadline["conflict"] = True
    extra = (
        "Notices for this solicitation number publish different deadlines. "
        "The due date shown is from the newest posted notice. Confirm on the official notice."
    )
    note = deadline.get("conflictNote") or ""
    deadline["conflictNote"] = (note + " " + extra).strip()


def dedup(records: list[dict]) -> tuple[list[dict], dict]:
    """Return clustered opportunities and a small stats dict."""
    by_uid = {}
    for rec in records:
        uid = rec.get("uid") or f"{rec.get('source')}:{rec.get('id')}"
        rec["uid"] = uid
        current = by_uid.get(uid)
        if current is None or _posted_key(rec) >= _posted_key(current):
            by_uid[uid] = rec
    items = list(by_uid.values())

    groups: list[list[dict]] = []
    index: list[tuple[str, str, str]] = []
    for rec in items:
        sol = normalize_sol(rec.get("solicitation") or "")
        agency = normalize_agency(rec.get("agency") or "")
        placed = False
        if _usable_sol(sol) and agency:
            for i, (gsol, gagency, gsource) in enumerate(index):
                if sol != gsol or not gagency:
                    continue
                same_source = rec.get("source") == gsource
                if same_source and agency == gagency:
                    groups[i].append(rec)
                    placed = True
                    break
                if (not same_source) and len(sol) >= 5 and _agency_compatible(agency, gagency):
                    groups[i].append(rec)
                    placed = True
                    break
        if not placed:
            groups.append([rec])
            index.append((sol, agency, rec.get("source") or ""))

    merged = 0
    addenda = 0
    out = []
    for group in groups:
        group.sort(key=_posted_key, reverse=True)
        primary = group[0]
        others = group[1:]
        if others:
            merged += 1
            existing = list(primary.get("addenda") or [])
            seen = {item.get("noticeId") for item in existing}
            seen.add(primary.get("id"))
            for other in others:
                if other.get("id") in seen:
                    continue
                existing.append(_as_addendum(other))
                seen.add(other.get("id"))
                addenda += 1
                also = primary.setdefault("alsoSeen", [])
                also.append({
                    "source": other.get("source"),
                    "recordId": other.get("id"),
                    "link": other.get("link"),
                    "retrievedAt": (other.get("provenance") or {}).get("retrievedAt", ""),
                })
            primary["addenda"] = existing
            cats = set(primary.get("categories") or [])
            for other in others:
                cats.update(other.get("categories") or [])
                if other.get("featured"):
                    primary["featured"] = True
            primary["categories"] = sorted(cats)
            _flag_deadline(primary, others)
        out.append(primary)
    out.sort(key=lambda rec: rec.get("due") or "9999")
    return out, {
        "input": len(records),
        "output": len(out),
        "clustersMerged": merged,
        "addendaAttached": addenda,
    }
