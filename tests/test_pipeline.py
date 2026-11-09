import datetime as dt
import json
import shutil
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.pipeline import run  # noqa: E402
from ingest.security import FetchError, RateLimiter  # noqa: E402

NOW = dt.datetime(2026, 11, 9, 1, 20, tzinfo=dt.timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures"
RSS = (FIXTURES / "bonfire_suffolk.rss").read_bytes()


class FakeResponse:
    def __init__(self, status, body, url):
        self.status = status
        self.headers = {"Content-Type": "application/json", "Last-Modified": "Sun, 08 Nov 2026 04:30:19 GMT"}
        self._body = body if isinstance(body, bytes) else body.encode()
        self._url = url
        self._pos = 0

    def read(self, n=-1):
        if self._pos >= len(self._body):
            return b""
        if n is None or n < 0:
            chunk = self._body[self._pos:]
            self._pos = len(self._body)
            return chunk
        chunk = self._body[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk

    def close(self):
        pass

    def geturl(self):
        return self._url

    def getcode(self):
        return self.status


def resolver(host, port, type=None):
    return ["8.8.8.8"]


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = FIXTURES / "tmp-run"
        if self.tmp.exists():
            shutil.rmtree(self.tmp)
        (self.tmp / "data").mkdir(parents=True)
        shutil.copy(ROOT / "data" / "deadline-verifications.json", self.tmp / "data" / "deadline-verifications.json")

    def tearDown(self):
        if self.tmp.exists():
            shutil.rmtree(self.tmp)

    def _opener(self, fail_sam=False):
        nyc_rows = [{
            "request_id": "20261109001",
            "start_date": "2026-11-01T00:00:00.000",
            "agency_name": "Example Agency",
            "short_title": "Public website and software support",
            "selection_method_description": "Competitive Sealed Proposals",
            "pin": "PIN-1",
            "due_date": "2026-12-20T15:00:00.000",
            "additional_description_1": "Website support.",
            "email": "a@example.gov",
        }]

        def opener(req, timeout=None):
            url = req.full_url
            if "sam.gov" in url or "amazonaws.com" in url:
                if fail_sam:
                    raise FetchError("sam down")
                raise AssertionError(url)
            if "bonfirehub.com" in url:
                return FakeResponse(200, RSS, url)
            if "count(*)" in url or "count%28" in url:
                return FakeResponse(200, json.dumps([{"count": "45318"}]), url)
            if "data.cityofnewyork.us" in url:
                return FakeResponse(200, json.dumps(nyc_rows), url)
            raise AssertionError(url)

        return opener

    def test_local_sam_plus_feeds_writes_live_files_and_skips_demo(self):
        result = run(
            self.tmp,
            NOW,
            env={},
            sam_csv=str(FIXTURES / "sam_sample.csv"),
            limiter=RateLimiter(min_interval=0, sleep=lambda _s: None),
            opener=self._opener(),
            resolver=resolver,
        )
        self.assertEqual(result["status"], "success")
        bids = json.loads((self.tmp / "data" / "bids.json").read_text())
        self.assertFalse(bids["meta"]["demo"])
        self.assertEqual(bids["meta"]["kind"], "live")
        ids = {rec["id"] for rec in bids["bids"]}
        self.assertNotIn("demo-website-1", ids)
        self.assertIn("aaa111", ids)
        self.assertNotIn("bbb222", ids)  # older notice folded in
        self.assertTrue(any(rec["solicitation"] == "2026-25" and rec["deadline"]["conflict"] for rec in bids["bids"]))
        self.assertTrue(any(rec["source"] == "nyc-crol" for rec in bids["bids"]))
        sources = json.loads((self.tmp / "data" / "sources.json").read_text())
        by_id = {row["id"]: row for row in sources["sources"]}
        self.assertEqual(by_id["sam-opportunities-api"]["status"], "config-required")
        self.assertEqual(by_id["bidnet"]["status"], "unsupported")
        self.assertEqual(by_id["rfpmart"]["status"], "unsupported")
        self.assertEqual(by_id["planetbids"]["status"], "unsupported")
        self.assertEqual(by_id["nyc-passport"]["status"], "manual")
        self.assertEqual(by_id["nyscr"]["status"], "manual")
        self.assertIn("member agencies", by_id["bidnet"]["notes"])
        self.assertIn("crawler", by_id["rfpmart"]["notes"].lower())
        self.assertEqual(by_id["sam-opportunities-api"]["opportunities"], 0)
        runs = json.loads((self.tmp / "data" / "runs.json").read_text())
        self.assertEqual(runs["runs"][0]["status"], "success")
        self.assertIn("not been running", runs["runs"][0]["notes"])
        demo = json.loads((ROOT / "data" / "demo" / "opportunities.json").read_text())
        self.assertTrue(demo["meta"]["demo"])
        self.assertTrue(all(rec["demo"] for rec in demo["bids"]))

    def test_failed_sam_keeps_previous_open_notices(self):
        first = run(
            self.tmp,
            NOW,
            env={},
            sam_csv=str(FIXTURES / "sam_sample.csv"),
            limiter=RateLimiter(min_interval=0, sleep=lambda _s: None),
            opener=self._opener(),
            resolver=resolver,
        )
        self.assertGreater(first["count"], 0)
        second = run(
            self.tmp,
            NOW,
            env={},
            limiter=RateLimiter(min_interval=0, sleep=lambda _s: None),
            opener=self._opener(fail_sam=True),
            resolver=resolver,
        )
        self.assertEqual(second["status"], "partial")
        bids = json.loads((self.tmp / "data" / "bids.json").read_text())
        sam = [rec for rec in bids["bids"] if rec["source"] == "sam-public-csv"]
        self.assertTrue(sam)
        self.assertTrue(all(rec["provenance"].get("stale") for rec in sam))


if __name__ == "__main__":
    unittest.main()
