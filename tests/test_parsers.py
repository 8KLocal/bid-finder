import datetime as dt
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ingest.deadlines import (  # noqa: E402
    instant,
    parse_rss_close,
    parse_sam_deadline,
    parse_socrata_timestamp,
    still_open,
)
from ingest.dedup import dedup  # noqa: E402
from ingest.records import build_record  # noqa: E402
from ingest.sources.sam_csv import parse_sam_csv  # noqa: E402
from ingest.textutil import csv_cell, sanitize  # noqa: E402
from ingest.verify import apply_verifications  # noqa: E402

NOW = dt.datetime(2026, 11, 9, 1, 20, tzinfo=dt.timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures"


class DeadlineTests(unittest.TestCase):
    def test_sam_offset_is_kept(self):
        parsed = parse_sam_deadline("2026-12-01T15:00:00-05:00")
        self.assertTrue(parsed["feed"]["confident"])
        self.assertEqual(parsed["feed"]["offset"], "-05:00")
        self.assertEqual(parsed["feed"]["raw"], "2026-12-01T15:00:00-05:00")
        self.assertTrue(still_open(parsed, NOW))

    def test_expired_sam_deadline_is_closed(self):
        parsed = parse_sam_deadline("2020-01-01T00:00:00Z")
        self.assertFalse(still_open(parsed, NOW))

    def test_naive_sam_deadline_is_not_called_utc(self):
        parsed = parse_sam_deadline("2026-12-01T15:00:00")
        self.assertFalse(parsed["feed"]["confident"])
        self.assertNotIn("UTC", parsed["feed"]["timezone"])
        self.assertIn("not labeled UTC", parsed["feed"]["assumption"])
        self.assertIsNotNone(instant(parsed))

    def test_rss_midnight_and_afternoon(self):
        midnight = parse_rss_close("Project closes Dec 04, 2026 12:00 AM EST.")
        afternoon = parse_rss_close("Project closes Nov 17, 2026 3:30 PM EST.")
        self.assertEqual(midnight["feed"]["raw"], "Dec 04, 2026 12:00 AM EST")
        self.assertEqual(midnight["feed"]["iso"], "2026-12-04T00:00:00-05:00")
        self.assertEqual(afternoon["feed"]["iso"], "2026-11-17T15:30:00-05:00")
        self.assertFalse(midnight["feed"]["pdfParsed"])
        self.assertTrue(midnight["feed"]["confident"])

    def test_july_et_uses_daylight_time(self):
        parsed = parse_rss_close("Project closes Jul 04, 2026 3:30 PM ET.")
        self.assertTrue(parsed["feed"]["iso"].endswith("-04:00"))

    def test_socrata_timestamp_is_an_assumption(self):
        parsed = parse_socrata_timestamp("2026-11-09T11:00:00.000")
        self.assertFalse(parsed["feed"]["confident"])
        self.assertEqual(parsed["feed"]["timezone"], "America/New_York")
        self.assertEqual(parsed["feed"]["raw"], "2026-11-09T11:00:00.000")
        self.assertIn("-05:00", parsed["feed"]["iso"])
        self.assertIn("no timezone", parsed["feed"]["assumption"])

    def test_missing_rss_close_stays_unknown(self):
        parsed = parse_rss_close("No clock in this item.")
        self.assertEqual(parsed["feed"]["precision"], "unknown")
        self.assertTrue(still_open(parsed, NOW))


class ParserTests(unittest.TestCase):
    def test_sam_csv_filters_and_keeps_fields(self):
        records, stats = parse_sam_csv(str(FIXTURES / "sam_sample.csv"), NOW)
        ids = {rec["id"] for rec in records}
        self.assertEqual(ids, {"aaa111", "bbb222", "ccc333", "hhh888"})
        self.assertGreater(stats["skippedNaics"], 0)
        self.assertGreater(stats["skippedType"], 0)
        self.assertGreater(stats["skippedDeadline"], 0)
        web = next(rec for rec in records if rec["id"] == "aaa111")
        self.assertEqual(web["solicitation"], "SOL-100")
        self.assertEqual(web["link"], "https://sam.gov/opp/aaa111/view")
        self.assertEqual(web["naics"], "541511")
        self.assertTrue(web["featured"])
        self.assertIn("software", web["categories"])
        self.assertEqual(web["setAside"], "None")
        design = next(rec for rec in records if rec["id"] == "ccc333")
        self.assertIn("design", design["categories"])
        self.assertNotEqual(design["setAside"], "None")

    def test_sam_cp1252_apostrophe(self):
        path = FIXTURES / "sam_cp1252.csv"
        title = "Vendor\u2019s website help"
        header = "NoticeId,Title,Sol#,Department/Ind.Agency,Sub-Tier,Office,PostedDate,Type,ResponseDeadLine,NaicsCode,Active,SetASide,SetASideCode,PopCity,PopState,PrimaryContactEmail,Description\n"
        row = f"zzz999,{title},SOL-9,Dept,Sub,Office,2026-11-01,Solicitation,2026-12-01T15:00:00-05:00,541511,Yes,,,City,NY,a@example.gov,Desc\n"
        path.write_bytes(header.encode("cp1252") + row.encode("cp1252"))
        try:
            records, _stats = parse_sam_csv(str(path), NOW)
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(records[0]["title"], "Vendor\u2019s website help")

    def test_sanitize_strips_markup(self):
        self.assertEqual(sanitize("<script>alert(1)</script><b>Hello</b>"), "Hello")
        self.assertTrue(csv_cell("=HYPERLINK(\"x\")").startswith("'"))

    def test_bonfire_categories_deadlines_and_links(self):
        from ingest.sources.bonfire import ORGS, parse_bonfire_rss

        records, stats = parse_bonfire_rss(
            (FIXTURES / "bonfire_suffolk.rss").read_bytes(), ORGS[0], NOW
        )
        self.assertEqual(stats["scanned"], 4)
        self.assertEqual(stats["skippedLink"], 1)
        self.assertEqual(stats["skippedCategory"], 1)
        by_sol = {rec["solicitation"]: rec for rec in records}
        self.assertEqual(set(by_sol), {"2026-20", "2026-25"})
        emr = by_sol["2026-20"]
        self.assertIn("software", emr["categories"])
        self.assertEqual(emr["due"], "2026-11-17T15:30:00-05:00")
        self.assertEqual(emr["dueRaw"], "Nov 17, 2026 3:30 PM EST")
        self.assertEqual(emr["link"], "https://suffolkcountyny.bonfirehub.com/opportunities/255420")
        self.assertIn("Health Services", emr["subTier"])
        tourism = by_sol["2026-25"]
        self.assertIn("marketing", tourism["categories"])
        self.assertEqual(tourism["due"], "2026-12-04T00:00:00-05:00")
        self.assertFalse(tourism["deadline"]["feed"]["pdfParsed"])

    def test_nyc_rows_filter_and_do_not_invent_passport_links(self):
        from ingest.sources.nyc_crol import parse_nyc_rows

        rows = [
            {
                "request_id": "20261109001",
                "start_date": "2026-11-01T00:00:00.000",
                "agency_name": "Parks and Recreation",
                "short_title": "Website redesign and graphic design services",
                "selection_method_description": "Competitive Sealed Proposals",
                "pin": "PIN-WEB-1",
                "due_date": "2026-12-01T15:00:00.000",
                "additional_description_1": "<p>Bid Addendum has been released in PASSPort.</p>",
                "email": "parks@example.gov",
                "document_links": {"url": "https://evil.example/file.pdf"},
            },
            {
                "request_id": "20261109002",
                "short_title": "Replacement of concrete curbs",
                "due_date": "2026-12-01T15:00:00.000",
                "pin": "PIN-CURB",
            },
            {
                "request_id": "not-an-id",
                "short_title": "Software maintenance",
                "due_date": "2026-12-01T15:00:00.000",
            },
            {
                "request_id": "20261109003",
                "short_title": "Software maintenance",
                "due_date": "2020-01-01T00:00:00.000",
                "pin": "OLD",
            },
        ]
        records, stats = parse_nyc_rows(rows, NOW)
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec["canonicalId"], "PIN-WEB-1")
        self.assertEqual(rec["link"], "https://a856-cityrecord.nyc.gov/RequestDetail/20261109001")
        self.assertEqual(rec["portalUrl"], "")
        self.assertTrue(rec["addenda"])
        self.assertIn("not downloaded", rec["addenda"][0]["note"])
        self.assertIn("PASSPort", rec["provenance"]["note"])
        self.assertNotIn("passport.cityofnewyork.us", rec["link"])
        self.assertEqual(stats["skippedCategory"], 1)
        self.assertEqual(stats["skippedClosed"], 1)
        self.assertEqual(stats["skippedId"], 1)

    def test_portal_boilerplate_is_not_a_website_project(self):
        from ingest.categories import categories_for_text
        from ingest.sources.nyc_crol import parse_nyc_rows

        self.assertEqual(categories_for_text(
            "Replacement of concrete curbs",
            "Submit on PASSPort at the following website: https://passport.cityofnewyork.us/page",
        ), [])
        self.assertEqual(categories_for_text("Municipal website redesign", ""), ["website"])
        self.assertEqual(categories_for_text(
            "Coney Island Cyclone roller coaster RFP",
            "Download the RFP on Parks' website. Join on your computer, mobile app or room device: https://teams.microsoft.com/meet/x",
        ), [])
        self.assertIn("software", categories_for_text(
            "Payroll managed services",
            "The vendor shall replace the legacy software used for payroll.",
        ))
        rows = [{
            "request_id": "20261109009",
            "short_title": "Standing construction list",
            "due_date": "2999-12-31T08:00:00.000",
            "pin": "LONG",
            "additional_description_1": "Software development services for a public website.",
        }]
        records, stats = parse_nyc_rows(rows, NOW)
        self.assertEqual(records, [])
        self.assertEqual(stats["skippedPlaceholder"], 1)

    def test_nyc_keeps_official_document_host(self):
        from ingest.sources.nyc_crol import _document_link

        kept = _document_link({
            "url": "https://a856-cityrecord.nyc.gov/Search/GetFile?RequestID=1&amp;DocumentID=2"
        })
        self.assertTrue(kept.startswith("https://a856-cityrecord.nyc.gov/"))
        self.assertIn("DocumentID=2", kept)
        self.assertEqual(_document_link({"url": "http://a856-cityrecord.nyc.gov/x"}), "")


class DedupTests(unittest.TestCase):
    def _sam(self, notice_id, sol, posted, due, agency="Department of Example"):
        deadline = parse_sam_deadline(due)
        return build_record(
            source="sam-public-csv",
            source_name="SAM",
            record_id=notice_id,
            title=f"Notice {notice_id}",
            solicitation=sol,
            agency=agency,
            posted=posted,
            deadline=deadline,
            link=f"https://sam.gov/opp/{notice_id}/view",
            jurisdiction="federal",
        )

    def test_same_solicitation_becomes_addenda(self):
        older = self._sam("old", "SOL-100", "2026-10-01", "2026-11-20T15:00:00-05:00")
        newer = self._sam("new", "SOL-100", "2026-11-01", "2026-12-01T15:00:00-05:00")
        other = self._sam("other", "SOL-200", "2026-11-02", "2026-12-05T15:00:00-05:00")
        rows, stats = dedup([older, newer, other])
        self.assertEqual(len(rows), 2)
        self.assertEqual(stats["clustersMerged"], 1)
        primary = next(rec for rec in rows if rec["solicitation"] == "SOL-100")
        self.assertEqual(primary["id"], "new")
        self.assertEqual(primary["due"], "2026-12-01T15:00:00-05:00")
        self.assertEqual(len(primary["addenda"]), 1)
        self.assertEqual(primary["addenda"][0]["noticeId"], "old")
        self.assertTrue(primary["deadline"]["conflict"])

    def test_blank_solicitation_does_not_merge(self):
        a = self._sam("a1", "", "2026-11-01", "2026-12-01T15:00:00-05:00")
        b = self._sam("b1", "", "2026-11-02", "2026-12-02T15:00:00-05:00")
        rows, _stats = dedup([a, b])
        self.assertEqual(len(rows), 2)

    def test_different_agencies_do_not_merge(self):
        a = self._sam("a1", "SOL-100", "2026-11-01", "2026-12-01T15:00:00-05:00", "Alpha Agency")
        b = self._sam("b1", "SOL-100", "2026-11-02", "2026-12-01T15:00:00-05:00", "Beta Agency")
        rows, _stats = dedup([a, b])
        self.assertEqual(len(rows), 2)

    def test_cross_source_same_solicitation_merges_once(self):
        sam = self._sam("sam1", "SOL-55555", "2026-11-01", "2026-12-01T15:00:00-05:00", "Suffolk County")
        other = build_record(
            source="bonfire-suffolkcountyny",
            source_name="Bonfire",
            record_id="999",
            title="County software",
            solicitation="SOL-55555",
            agency="Suffolk County",
            posted="2026-11-03",
            deadline=parse_sam_deadline("2026-12-01T15:00:00-05:00"),
            link="https://suffolkcountyny.bonfirehub.com/opportunities/999",
            jurisdiction="local",
            categories=["software"],
            featured=True,
        )
        rows, stats = dedup([sam, other])
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["addendaAttached"], 1)
        self.assertTrue(rows[0]["featured"])
        self.assertIn("software", rows[0]["categories"])


class VerificationTests(unittest.TestCase):
    def test_reported_conflict_does_not_replace_rss_time_or_claim_pdf_parse(self):
        from ingest.sources.bonfire import ORGS, parse_bonfire_rss

        records, _stats = parse_bonfire_rss(
            (FIXTURES / "bonfire_suffolk.rss").read_bytes(), ORGS[0], NOW
        )
        notes = json.loads((ROOT / "data" / "deadline-verifications.json").read_text())
        updated, log = apply_verifications(records, notes["verifications"])
        tourism = next(rec for rec in updated if rec["solicitation"] == "2026-25")
        self.assertEqual(tourism["due"], "2026-12-04T00:00:00-05:00")
        self.assertEqual(tourism["dueRaw"], "Dec 04, 2026 12:00 AM EST")
        self.assertTrue(tourism["deadline"]["conflict"])
        self.assertEqual(tourism["deadline"]["controlling"], "feed")
        self.assertFalse(tourism["deadline"]["verification"]["parsedPdf"])
        self.assertFalse(tourism["deadline"]["verification"]["independentlyParsedByIngest"])
        self.assertIn("did not parse", tourism["deadline"]["conflictNote"])
        self.assertIn("3:30 PM", tourism["deadline"]["conflictNote"])
        self.assertIn("12:00 AM EST", tourism["deadline"]["conflictNote"])
        emr = next(rec for rec in updated if rec["solicitation"] == "2026-20")
        self.assertFalse(emr["deadline"]["conflict"])
        self.assertTrue(log)

    def test_stale_feed_text_does_not_keep_the_old_conflict(self):
        deadline = parse_rss_close("Project closes Dec 04, 2026 3:30 PM EST.")
        rec = build_record(
            source="bonfire-suffolkcountyny",
            source_name="Bonfire",
            record_id="261802",
            title="Marketing",
            solicitation="2026-25",
            agency="Suffolk County",
            deadline=deadline,
            jurisdiction="local",
            org="suffolkcountyny",
            link="https://suffolkcountyny.bonfirehub.com/opportunities/261802",
        )
        item = {
            "id": "suffolk-2026-25-rss-vs-reported-rfp",
            "source": "bonfire-suffolkcountyny",
            "org": "suffolkcountyny",
            "solicitation": "2026-25",
            "feedRawContains": "Dec 04, 2026 12:00 AM EST",
            "reportedDeadlineRaw": "3:30 PM",
            "method": "source-research-note",
            "parsedPdf": False,
        }
        updated, log = apply_verifications([rec], [item])
        self.assertFalse(updated[0]["deadline"]["conflict"])
        self.assertEqual(log, [])

    def test_bad_verification_file_is_rejected(self):
        from ingest.verify import load_verifications

        path = FIXTURES / "bad-verifications.json"
        path.write_text("{", encoding="utf-8")
        try:
            with self.assertRaises(ValueError):
                load_verifications(path)
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
