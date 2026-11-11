#!/usr/bin/env python3
"""Scope rules for the public SAM.gov extract."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.fetch_bids import consider

NOW = dt.datetime(2026, 11, 10, tzinfo=dt.timezone.utc)
FUTURE = "2026-12-01T17:00:00-05:00"
PAST = "2026-10-01T17:00:00-05:00"


def row(**kw):
    base = {
        "NoticeId": "abc123",
        "Title": "Custom software development",
        "Sol#": "W123",
        "Department/Ind.Agency": "VETERANS AFFAIRS, DEPARTMENT OF",
        "Sub-Tier": "VETERANS AFFAIRS, DEPARTMENT OF",
        "Office": "TECHNOLOGY ACQUISITION CENTER",
        "PostedDate": "2026-11-01",
        "Type": "Solicitation",
        "SetASide": "Total Small Business Set-Aside (FAR 19.5)",
        "SetASideCode": "SBA",
        "ResponseDeadLine": FUTURE,
        "NaicsCode": "541511",
        "PopCity": "Austin",
        "PopState": "TX",
        "PopCountry": "USA",
        "Active": "Yes",
        "PrimaryContactEmail": "co@va.gov",
        "Description": "Build a public website and web application.",
    }
    base.update(kw)
    return base


class ConsiderTests(unittest.TestCase):
    def test_keeps_us_software_notice(self):
        bid = consider(row(), NOW)
        self.assertIsNotNone(bid)
        self.assertEqual(bid["scope"], "core")
        self.assertEqual(bid["link"], "https://sam.gov/opp/abc123/view")
        self.assertEqual(bid["agency"], "Veterans Affairs, Department of")
        self.assertIn("Small Business", bid["setAside"])

    def test_keeps_blank_country_as_domestic(self):
        self.assertIsNotNone(consider(row(PopCountry="", PopCity="", PopState=""), NOW))

    def test_drops_foreign_place_of_performance(self):
        self.assertIsNone(consider(row(PopCountry="CAF", PopCity="Bangui", PopState=""), NOW))

    def test_drops_award_notices_and_past_deadlines(self):
        self.assertIsNone(consider(row(Type="Award Notice"), NOW))
        self.assertIsNone(consider(row(ResponseDeadLine=PAST), NOW))
        self.assertIsNone(consider(row(Active="No"), NOW))

    def test_keeps_a_deadline_earlier_today_and_a_missing_deadline(self):
        # NOW is 2026-11-10 00:00 UTC, which is still 2026-11-09 in New York.
        same_day = consider(row(ResponseDeadLine="2026-11-09T08:00:00-05:00"), NOW)
        self.assertIsNotNone(same_day)
        self.assertEqual(same_day["deadline"], "2026-11-09T08:00:00-05:00")
        missing = consider(row(ResponseDeadLine=""), NOW)
        self.assertIsNotNone(missing)
        self.assertEqual(missing["deadline"], "")
        self.assertIsNone(consider(row(ResponseDeadLine="2026-11-08T23:00:00-05:00"), NOW))

    def test_related_code_needs_digital_language(self):
        kept = consider(row(
            NaicsCode="541990",
            Title="Remote software support services",
            Description="Help desk and web application support, telework authorized.",
        ), NOW)
        self.assertEqual(kept["scope"], "related")
        self.assertTrue(kept["remote"])
        other = consider(row(
            NaicsCode="541990",
            Title="FIRE FIGHTING EQUIPMENT INSPECTIONS",
            Description="Inspect extinguishers at the depot.",
        ), NOW)
        self.assertEqual(other["scope"], "general")
        self.assertEqual(other["source"], "SAM.gov")
        self.assertEqual(other["state"], "TX")
        self.assertEqual(other["url"], other["link"])

    def test_non_digital_naics_is_kept_as_general(self):
        bid = consider(row(
            NaicsCode="541810",
            Title="Advertising campaign",
            Description="Print and outdoor advertising.",
        ), NOW)
        self.assertEqual(bid["scope"], "general")
        self.assertEqual(bid["naics"], "541810")

    def test_notice_without_naics_is_kept(self):
        bid = consider(row(NaicsCode="", Title="Janitorial services for the courthouse"), NOW)
        self.assertEqual(bid["scope"], "general")
        self.assertEqual(bid["naics"], "")

    def test_it_token_is_case_sensitive(self):
        plain = consider(row(
            NaicsCode="541990",
            Title="Submit it by Friday",
            Description="A general facilities task. Please submit it on time.",
        ), NOW)
        self.assertEqual(plain["scope"], "general")
        kept = consider(row(
            NaicsCode="541611",
            Title="IT support for the public website",
            Description="Information technology help desk.",
        ), NOW)
        self.assertEqual(kept["scope"], "related")
        aircraft = consider(row(
            NaicsCode="541990",
            Title="Aircraft sustainment",
            Description="THIS IS NOT A REQUEST FOR PROPOSAL. IT DOES NOT CONSTITUTE A SOLICITATION. See the program website.",
        ), NOW)
        self.assertEqual(aircraft["scope"], "general")

    def test_strips_html_from_summary(self):
        bid = consider(row(Description="<p>Software&nbsp;development &amp; hosting</p>"), NOW)
        self.assertNotIn("<", bid["summary"])
        self.assertIn("Software development & hosting", bid["summary"])


if __name__ == "__main__":
    unittest.main()
