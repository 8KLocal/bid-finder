#!/usr/bin/env python3
"""Refresh data/bids.json from public primary sources.

The SAM.gov Contract Opportunities CSV (no API key) is still the federal
source. Suffolk County's Bonfire RSS and NYC City Record solicitations are
added beside it. Pass a CSV path to parse a local extract instead of downloading.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingest.pipeline import main

if __name__ == "__main__":
    raise SystemExit(main())
