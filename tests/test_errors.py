import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.security import (  # noqa: E402
    RateLimiter,
    SecurityError,
    bonfire_policy_for,
    fetch,
    nyc_policy,
    sam_api_policy,
    sam_csv_policy,
    validate_url,
)
from ingest.sources.sam_api import KEY_DISABLED, NOT_CONFIGURED, load_sam_api  # noqa: E402


class AllowlistTests(unittest.TestCase):
    def test_sam_extract_and_s3_redirect_only(self):
        page = "https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public"
        s3 = "https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
        fallback = "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
        self.assertTrue(sam_csv_policy(page, "start"))
        self.assertTrue(sam_csv_policy(s3, "redirect"))
        self.assertTrue(sam_csv_policy(fallback, "start"))
        self.assertFalse(sam_csv_policy("https://evil.example/file.csv", "redirect"))
        self.assertFalse(sam_csv_policy("http://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/x.csv", "start"))
        self.assertFalse(sam_csv_policy("https://sam.gov/api/prod/opportunities/v2/search", "start"))

    def test_other_feeds_are_pinned(self):
        self.assertTrue(sam_api_policy("https://api.sam.gov/opportunities/v2/search?limit=1", "start"))
        self.assertFalse(sam_api_policy("https://api.sam.gov/opportunities/v2/search", "redirect"))
        policy = bonfire_policy_for(["suffolkcountyny"])
        self.assertTrue(policy("https://suffolkcountyny.bonfirehub.com/opportunities/rss", "start"))
        self.assertFalse(policy("https://other.bonfirehub.com/opportunities/rss", "start"))
        self.assertFalse(policy("https://suffolkcountyny.bonfirehub.com/portal/", "start"))
        self.assertTrue(nyc_policy("https://data.cityofnewyork.us/resource/dg92-zbpx.json?$limit=1", "start"))
        self.assertFalse(nyc_policy("https://data.cityofnewyork.us/resource/other.json", "start"))

    def test_private_and_credentialed_urls_are_refused(self):
        def allow_all(_url, _phase):
            return True

        def resolver(_host, _port, type=None):
            return ["8.8.8.8"]

        with self.assertRaises(SecurityError):
            validate_url("http://sam.gov/x", phase="start", policy=allow_all, resolver=resolver)
        with self.assertRaises(SecurityError):
            validate_url("https://user:pass@sam.gov/x", phase="start", policy=allow_all, resolver=resolver)
        with self.assertRaises(SecurityError):
            validate_url("https://127.0.0.1/latest", phase="start", policy=allow_all, resolver=resolver)
        with self.assertRaises(SecurityError):
            validate_url(
                "https://metadata.example/latest",
                phase="start",
                policy=allow_all,
                resolver=lambda host, port, type=None: ["169.254.169.254"],
            )
        validate_url("https://sam.gov/x", phase="start", policy=allow_all, resolver=resolver)

    def test_redirect_to_private_host_is_not_fetched(self):
        calls = []

        class Response:
            def __init__(self):
                self.status = 303
                self.headers = {"Location": "http://127.0.0.1/secret"}
                self.closed = False

            def read(self, n=-1):
                return b""

            def close(self):
                self.closed = True

            def geturl(self):
                return "https://sam.gov/start"

            def getcode(self):
                return 303

        def opener(req, timeout=None):
            calls.append(req.full_url)
            return Response()

        page = "https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public"
        with self.assertRaises(SecurityError):
            fetch(
                page,
                policy=sam_csv_policy,
                limiter=RateLimiter(min_interval=0, sleep=lambda _s: None),
                opener=opener,
                resolver=lambda host, port, type=None: ["8.8.8.8"],
                max_bytes=1000,
            )
        self.assertEqual(len(calls), 1)

    def test_rate_limit_caps_the_run(self):
        limiter = RateLimiter(min_interval=0, max_requests=1, sleep=lambda _s: None)
        limiter.wait("sam.gov")
        with self.assertRaises(SecurityError):
            limiter.wait("sam.gov")


class SamApiTests(unittest.TestCase):
    def test_missing_key_invents_nothing_and_does_not_call_network(self):
        def opener(*_args, **_kwargs):
            raise AssertionError("network was called")

        result = load_sam_api(
            __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            env={},
            opener=opener,
        )
        self.assertEqual(result["status"], "config-required")
        self.assertEqual(result["records"], [])
        self.assertIn("not configured", result["message"])
        self.assertIn("No records were fetched or invented", result["message"])
        self.assertEqual(result["message"], NOT_CONFIGURED)

    def test_key_without_enable_flag_does_not_call_network(self):
        def opener(*_args, **_kwargs):
            raise AssertionError("network was called")

        result = load_sam_api(
            __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            env={"SAM_API_KEY": "secret-key-value"},
            opener=opener,
        )
        self.assertEqual(result["status"], "config-required")
        self.assertEqual(result["records"], [])
        self.assertEqual(result["message"], KEY_DISABLED)
        self.assertNotIn("secret-key-value", result["message"])

    def test_enabled_key_uses_one_call_and_redacts_errors(self):
        seen = []

        def opener(req, timeout=None):
            seen.append(req.full_url)
            raise RuntimeError("boom secret-key-value")

        now = __import__("datetime").datetime(2026, 11, 9, tzinfo=__import__("datetime").timezone.utc)
        result = load_sam_api(
            now,
            env={"SAM_API_KEY": "secret-key-value", "SAM_API_ENABLE": "1"},
            limiter=RateLimiter(min_interval=0, sleep=lambda _s: None),
            opener=opener,
            resolver=lambda host, port, type=None: ["8.8.8.8"],
        )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["records"], [])
        self.assertEqual(len(seen), 1)
        self.assertIn("api.sam.gov", seen[0])
        self.assertNotIn("secret-key-value", result["error"])
        self.assertIn("[redacted]", result["error"])


if __name__ == "__main__":
    unittest.main()
