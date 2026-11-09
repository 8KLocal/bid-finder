"""Deadline parsing that keeps the feed's own text and clock.

A timezone is attached only when the feed states an offset or abbreviation.
Assumptions are labeled and never described as a parsed solicitation PDF.
"""

from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
PT = ZoneInfo("America/Los_Angeles")

_OFFSETS = {
    "EST": "-05:00",
    "EDT": "-04:00",
    "CST": "-06:00",
    "CDT": "-05:00",
    "MST": "-07:00",
    "MDT": "-06:00",
    "PST": "-08:00",
    "PDT": "-07:00",
    "ET": None,
    "UTC": "+00:00",
    "GMT": "+00:00",
}
_EASTERN = {"EST", "EDT", "ET"}
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_RSS_DATE = re.compile(
    r"closes\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+"
    r"\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]M(?:\s+[A-Z]{2,4})?)",
    re.I,
)
_CLOCK = re.compile(
    r"^(?P<mon>[A-Za-z]{3})[a-z]*\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*(?P<ampm>AM|PM)(?:\s+(?P<tz>[A-Z]{2,4}))?$",
    re.I,
)


def feed_deadline(*, raw: str, iso: str = "", timezone: str = "", offset: str = "",
                  precision: str = "datetime", confident: bool = False,
                  source: str = "", assumption: str = "", pdf_parsed: bool = False) -> dict:
    return {
        "feed": {
            "raw": raw or "",
            "iso": iso or "",
            "timezone": timezone or "",
            "offset": offset or "",
            "precision": precision,
            "confident": bool(confident),
            "source": source,
            "assumption": assumption or "",
            "pdfParsed": bool(pdf_parsed),
        },
        "verification": None,
        "conflict": False,
        "conflictNote": "",
        "controlling": "feed",
    }


def parse_sam_deadline(raw: str) -> dict:
    text = (raw or "").strip()
    if not text:
        return feed_deadline(raw="", precision="unknown", source="csv")
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return feed_deadline(raw=text, precision="unknown", source="csv",
                             assumption="The extract deadline was not an ISO timestamp.")
    if parsed.tzinfo is None:
        latest = parsed.replace(tzinfo=PT)
        return feed_deadline(
            raw=text,
            iso=latest.isoformat(),
            timezone="",
            precision="datetime-unspecified",
            confident=False,
            source="csv",
            assumption="The extract deadline had no timezone. Open/closed uses America/Los_Angeles so a still-open Pacific deadline is not dropped. It is not labeled UTC.",
        )
    offset = parsed.strftime("%z")
    offset = offset[:3] + ":" + offset[3:] if len(offset) == 5 else ""
    zone = "UTC" if text.endswith("Z") or offset == "+00:00" else ""
    return feed_deadline(
        raw=text,
        iso=parsed.isoformat(),
        timezone=zone,
        offset=offset,
        precision="datetime",
        confident=True,
        source="csv",
    )


def parse_rss_close(description: str) -> dict:
    match = _RSS_DATE.search(description or "")
    if not match:
        return feed_deadline(
            raw="",
            precision="unknown",
            source="rss",
            assumption="The RSS item did not include a close time. The feed lists currently open notices; confirm the deadline on the official opportunity.",
        )
    raw = re.sub(r"\s+", " ", match.group(1)).strip()
    clock = _CLOCK.match(raw)
    if not clock:
        return feed_deadline(raw=raw, precision="unknown", source="rss", confident=False)
    month = _MONTHS[clock.group("mon").lower()[:3]]
    day = int(clock.group("day"))
    year = int(clock.group("year"))
    hour = int(clock.group("hour"))
    minute = int(clock.group("minute"))
    ampm = clock.group("ampm").upper()
    if ampm == "AM":
        hour = 0 if hour == 12 else hour
    elif hour != 12:
        hour += 12
    tz_label = (clock.group("tz") or "").upper()
    offset = _OFFSETS.get(tz_label)
    timezone = "America/New_York" if tz_label in _EASTERN else ""
    if tz_label == "ET":
        aware = dt.datetime(year, month, day, hour, minute, tzinfo=ET)
        iso = aware.isoformat()
        offset = aware.strftime("%z")
        offset = offset[:3] + ":" + offset[3:]
    elif offset:
        iso = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00{offset}"
    else:
        return feed_deadline(
            raw=raw,
            precision="datetime-unspecified",
            confident=False,
            source="rss",
            assumption="The RSS close time had no recognizable timezone abbreviation.",
        )
    return feed_deadline(
        raw=raw,
        iso=iso,
        timezone=timezone,
        offset=offset,
        precision="datetime",
        confident=True,
        source="rss",
    )


def parse_socrata_timestamp(raw: str, *, assume_zone: str = "America/New_York") -> dict:
    text = (raw or "").strip()
    if not text:
        return feed_deadline(raw="", precision="unknown", source="socrata")
    cleaned = text[:-1] if text.endswith("Z") else text
    # Socrata calendar values often look like 2026-11-09T11:00:00.000 with no offset.
    naive = cleaned.split(".")[0]
    try:
        parsed = dt.datetime.fromisoformat(cleaned)
    except ValueError:
        return feed_deadline(raw=text, precision="unknown", source="socrata")
    if parsed.tzinfo is not None or text.endswith("Z"):
        aware = parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
        offset = aware.strftime("%z")
        offset = offset[:3] + ":" + offset[3:] if len(offset) == 5 else "+00:00"
        return feed_deadline(
            raw=text,
            iso=aware.isoformat(),
            timezone="UTC" if text.endswith("Z") else "",
            offset=offset,
            precision="datetime",
            confident=True,
            source="socrata",
        )
    zone = ZoneInfo(assume_zone)
    aware = parsed.replace(tzinfo=zone)
    offset = aware.strftime("%z")
    offset = offset[:3] + ":" + offset[3:]
    return feed_deadline(
        raw=text,
        iso=aware.isoformat(),
        timezone=assume_zone,
        offset=offset,
        precision="datetime",
        confident=False,
        source="socrata",
        assumption=(
            "City Record due_date has no timezone. It is filtered and displayed as "
            f"{assume_zone}. Confirm the clock time on the official notice."
        ),
    )


def instant(deadline: dict) -> dt.datetime | None:
    iso = ((deadline or {}).get("feed") or {}).get("iso") or ""
    if not iso:
        return None
    try:
        parsed = dt.datetime.fromisoformat(iso)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(dt.timezone.utc)


def still_open(deadline: dict, now: dt.datetime) -> bool:
    when = instant(deadline)
    if when is None:
        # Unknown deadlines from an "open notices" feed stay visible.
        precision = ((deadline or {}).get("feed") or {}).get("precision")
        return precision == "unknown"
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    return when >= now.astimezone(dt.timezone.utc)


def iso_conflict(a: str, b: str) -> bool:
    if not a or not b:
        return False
    try:
        left = dt.datetime.fromisoformat(a)
        right = dt.datetime.fromisoformat(b)
    except ValueError:
        return a != b
    if left.tzinfo is None or right.tzinfo is None:
        return False
    return abs((left - right).total_seconds()) > 60
