"""Category tags for website, app, software, design, and marketing work.

Matching is phrase-based so a civil-engineering "design" notice is not treated
as graphic design. Add a phrase here to extend a category; sources opt in.
"""

from __future__ import annotations

import re

FEATURED = {
    "541511": "Custom Computer Programming",
    "541512": "Computer Systems Design",
    "541519": "Other Computer Related Services",
    "518210": "Hosting & Data Processing",
    "541430": "Graphic Design",
    "541810": "Advertising Agencies",
    "541613": "Marketing Consulting",
    "541820": "Public Relations",
}
# Same keep-set as the original SAM filter.
PREFIXES = ("5415", "5418", "51821", "54143", "54161", "51211", "541990")
SKIP_TYPES = {
    "Award Notice",
    "Justification",
    "Sale of Surplus Property",
    "Consolidate/(Substantially) Bundle",
}

CATEGORY_LABELS = {
    "website": "Websites",
    "app": "Apps",
    "software": "Software",
    "design": "Design",
    "marketing": "Marketing",
}

_PHRASES = {
    "website": [
        r"\bwebsites?\s+(?:re)?design\b",
        r"\bwebsite\s+redesign\b",
        r"\b(?:re)?design(?:ing)?\s+(?:a\s+|the\s+|our\s+)?(?:public\s+|city\s+|municipal\s+)?websites?\b",
        r"\bwebsites?\s+development\b",
        r"\bdevelop(?:ing)?\s+(?:a\s+|the\s+)?(?:public\s+|municipal\s+)?websites?\b",
        r"\bnew\s+(?:public\s+|municipal\s+|city\s+)?websites?\b",
        r"\bweb\s+sites?\s+(?:re)?design\b",
        r"\bweb\s*-?\s*design\b",
        r"\bweb\s*-?\s*development\b",
        r"\bweb\s+apps?\b",
        r"\bweb\s+applications?\b",
        r"\bwordpress\b",
        r"\bcontent management\b",
    ],
    "app": [
        r"\bmobile\s+apps?\b(?!\s+or\s+room)",
        r"\bmobile\s+applications?\b",
        r"\bapplication\s+development\b",
        r"\bapp\s+development\b",
    ],
    "software": [
        r"\bsoftware\b",
        r"\bsaas\b",
        r"\belectronic medical records?\b",
        r"\bemr\b",
        r"\behr\b",
        r"\binformation technology\b",
        r"\bcomputer programming\b",
        r"\bsoftware development\b",
        r"\bdata processing\b",
        r"\bcloud computing\b",
        r"\bweb hosting\b",
    ],
    "design": [
        r"\bgraphic\s+design\b",
        r"\bvisual\s+design\b",
        r"\bui\s*/\s*ux\b",
        r"\bux\s+design\b",
        r"\buser experience\b",
        r"\bbrand\s+design\b",
        r"\billustration\b",
    ],
    "marketing": [
        r"\bmarketing\b",
        r"\badvertising\b",
        r"\bpublic relations\b",
        r"\bbranding\b",
        r"\bsocial media\b",
        r"\bmedia campaign\b",
        r"\bpromotion\b",
    ],
}
_COMPILED = {
    key: re.compile("|".join(phrases), re.I) for key, phrases in _PHRASES.items()
}

_NAICS = {
    "541511": ["software", "app"],
    "541512": ["software"],
    "541519": ["software"],
    "518210": ["software"],
    "541430": ["design"],
    "541810": ["marketing"],
    "541613": ["marketing"],
    "541820": ["marketing"],
    "541830": ["marketing"],
    "541840": ["marketing"],
    "541850": ["marketing"],
    "541860": ["marketing"],
    "541870": ["marketing"],
    "541890": ["marketing"],
}


def keep_sam_naics(naics: str) -> bool:
    code = (naics or "").strip()
    return code in FEATURED or code.startswith(PREFIXES)


def match_categories(text: str) -> list[str]:
    found = [key for key, pattern in _COMPILED.items() if pattern.search(text or "")]
    return found


# Sentences that only point at a portal page are not a website project.
_BOILER = re.compile(
    r"(?i)(?:"
    r"[^.!?\n]*\b(?:websites?|web\s*sites?)\b[^.!?\n]*"
    r"\b(?:portal|city\s+record|obtain|copy|available|https?|www\.|visit|following|search|download)\b"
    r"[^.!?\n]*"
    r"|[^.!?\n]*\b(?:portal|city\s+record|obtain|copy|available|https?|www\.|visit|following|search|download)\b"
    r"[^.!?\n]*\b(?:websites?|web\s*sites?)\b[^.!?\n]*"
    r"|[^.!?\n]*\bon\s+\w+(?:['’]s)?\s+website\b[^.!?\n]*"
    r"|[^.!?\n]*teams\.microsoft\.com[^.!?\n]*"
    r"|[^.!?\n]*\bmobile\s+app\s+or\s+room\s+device\b[^.!?\n]*"
    r")"
)
_BOILER_REV = _BOILER


def categories_for_text(title: str, summary: str = "") -> list[str]:
    """Match the title, plus description text that is not portal boilerplate."""
    cleaned = _BOILER.sub(" ", summary or "")
    cleaned = _BOILER_REV.sub(" ", cleaned)
    return match_categories(f"{title or ''} {cleaned}")


def categories_for_sam(naics: str, title: str) -> list[str]:
    found = set(_NAICS.get(naics, []))
    if naics.startswith("5418"):
        found.add("marketing")
    if naics.startswith("54143"):
        found.add("design")
    if naics.startswith("54151") or naics.startswith("51821"):
        found.add("software")
    found.update(match_categories(title or ""))
    return [key for key in CATEGORY_LABELS if key in found]
