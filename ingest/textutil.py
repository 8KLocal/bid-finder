"""Plain-text cleanup for notice fields. No HTML is rendered from these strings."""

from __future__ import annotations

import html
import re

_SCRIPT = re.compile(r"(?is)<script\b[^>]*>.*?</script>")
_STYLE = re.compile(r"(?is)<style\b[^>]*>.*?</style>")
_TAG = re.compile(r"(?s)<[^>]+>")
_CTRL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]")
_WS = re.compile(r"\s+")


def sanitize(value, limit: int | None = None) -> str:
    text = html.unescape(str(value or ""))
    text = _SCRIPT.sub(" ", text)
    text = _STYLE.sub(" ", text)
    text = _TAG.sub(" ", text)
    text = text.replace("\x00", "")
    text = _CTRL.sub("", text)
    text = _WS.sub(" ", text).strip()
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def csv_cell(value) -> str:
    text = sanitize(value, 2000)
    if text[:1] in ("=", "+", "-", "@"):
        return "'" + text
    return text
