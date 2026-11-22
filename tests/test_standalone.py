"""Independent standalone integrity tests for Trading Edge Terminal static showcase.

Runs with zero access to the private engineering repository, zero private environment
variables, zero network calls, and Python 3.9+ standard library only.
"""
from decimal import Decimal
import json
import re
import subprocess
import unittest
from pathlib import Path

DEMO_ROOT = Path(__file__).resolve().parent.parent
DOCS = DEMO_ROOT / "docs"
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
UTC_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")


def load_data():
    raw = (DOCS / "data.js").read_text(encoding="utf-8")
    m = re.search(r"Object\.freeze\((.*)\);\s*$", raw, re.S)
    assert m, "Unable to parse window.TET_SHOWCASE_DATA"
    return json.loads(m.group(1))


class TestStandalonePublicShowcase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_data()

    def test_schema_and_record_counts(self):
        required_top = {"meta", "methodology", "strategies", "companies", "risks", "treasury", "m1_replay"}
        self.assertTrue(required_top.issubset(self.data.keys()))
        meta = self.data["meta"]
        self.assertRegex(meta["snapshot_date"], ISO_DATE_RE)
        self.assertEqual(meta["snapshot_date"], "2026-11-12")
        self.assertRegex(meta["generated_utc"], UTC_TS_RE)
        self.assertEqual(meta["operating_count"], 17)
        self.assertEqual(meta["etf_boundary_count"], 1)
        self.assertEqual(len(self.data["companies"]), 18)
        self.assertEqual(len(self.data["risks"]), 22)
        self.assertEqual(len(self.data["strategies"]), 4)
        self.assertEqual(len(self.data["treasury"]["curve_points"]), 13)
        self.assertEqual(len(self.data["treasury"]["history"]), 260)

    def test_company_accounting_internal_consistency_and_boundaries(self):
        operating = [c for c in self.data["companies"] if c["availability_status"] == "ready"]
        etfs = [c for c in self.data["companies"] if c["asset_type"] == "ETF"]
        self.assertEqual(len(operating), 17)
        self.assertEqual(len(etfs), 1)
        self.assertEqual(etfs[0]["ticker"], "SPY")
        self.assertIsNone(etfs[0]["research_score"]["total_score"])
        self.assertEqual(etfs[0]["research_score"]["score_status"], "insufficient_data")

        # Verify COST FY2026 fallback case
        cost = next(c for c in operating if c["ticker"] == "COST")
        self.assertIsNone(cost["ttm"])
        self.assertEqual(cost["reporting_context"]["headline_period_label"], "FY2026")
        self.assertEqual(len(cost["annual_periods"]), 5)

        for c in operating:
            self.assertRegex(c["cik"], r"^\d{10}$")
            rc = c["reporting_context"]
            self.assertRegex(rc["latest_filing_date"], ISO_DATE_RE)
            self.assertEqual(rc["currency"], "USD")
            hp = c["ttm"] or c["annual_periods"][-1]
            self.assertIsNotNone(hp)
            m = hp["metrics"]
            r = hp["ratios"]

            # All numeric metric values parse as finite Decimal
            for mk, mv in m.items():
                dval = Decimal(str(mv["val"]))
                self.assertTrue(dval.is_finite(), f"Non-finite {mk} in {c['ticker']}")
                self.assertIsInstance(mv["is_calculated"], bool)

            # FCF == OCF - CapEx (exact integer/Decimal arithmetic)
            if all(k in m for k in ("operating_cash_flow", "capex", "free_cash_flow")):
                ocf = Decimal(str(m["operating_cash_flow"]["val"]))
                capex = Decimal(str(m["capex"]["val"]))
                fcf = Decimal(str(m["free_cash_flow"]["val"]))
                self.assertEqual(fcf, ocf - capex, f"FCF mismatch for {c['ticker']}")

            # Net Debt == Total Debt - Cash & Short-Term Investments
            if all(k in m for k in ("total_debt", "cash_and_short_term_investments", "net_debt")):
                td = Decimal(str(m["total_debt"]["val"]))
                cash = Decimal(str(m["cash_and_short_term_investments"]["val"]))
                nd = Decimal(str(m["net_debt"]["val"]))
                self.assertEqual(nd, td - cash, f"Net Debt mismatch for {c['ticker']}")

            # Operating Margin ratio consistency within rounding tolerance (0.05 pct pts)
            if "revenue" in m and "operating_income" in m and r.get("operating_margin_pct") is not None:
                rev = Decimal(str(m["revenue"]["val"]))
                oi = Decimal(str(m["operating_income"]["val"]))
                if rev > 0:
                    expected_opm = (oi / rev) * Decimal("100")
                    actual_opm = Decimal(str(r["operating_margin_pct"]))
                    self.assertLessEqual(abs(expected_opm - actual_opm), Decimal("0.05"), f"OpMargin drift for {c['ticker']}")

            # Accounting score bounds & 7 components
            rs = c["research_score"]
            self.assertIn(rs["score_status"], ("complete", "partial_coverage"))
            sc = Decimal(str(rs["total_score"]))
            self.assertGreaterEqual(sc, Decimal("0"))
            self.assertLessEqual(sc, Decimal("100"))
            self.assertEqual(len(rs["components"]), 7)

    def test_treasury_spread_arithmetic_and_chronology(self):
        tr = self.data["treasury"]
        hist = tr["history"]
        prev_date = None
        for row in hist:
            dt = row["rate_date"]
            self.assertRegex(dt, ISO_DATE_RE)
            if prev_date is not None:
                self.assertLess(prev_date, dt, f"Treasury dates not strictly ascending at {dt}")
            prev_date = dt
            y10 = Decimal(str(row["y10"]))
            y2 = Decimal(str(row["y2"]))
            m3 = Decimal(str(row["m3"]))
            self.assertEqual(Decimal(str(row["spread_10y_2y"])), y10 - y2)
            self.assertEqual(Decimal(str(row["spread_10y_3m"])), y10 - m3)
        latest = tr["latest"]
        self.assertEqual(latest["rate_date"], hist[-1]["rate_date"])
        self.assertEqual(Decimal(str(latest["spread_10y_2y"])), Decimal(str(latest["y10"])) - Decimal(str(latest["y2"])))

    def test_synthetic_m1_replay_invariants(self):
        m1 = self.data["m1_replay"]
        self.assertRegex(m1["as_of_cutoff"], UTC_TS_RE)
        self.assertEqual(len(m1["latest"]["signals"]), 0)
        self.assertEqual(len(m1["as_of"]["signals"]), 1)
        sig = m1["as_of"]["signals"][0]
        self.assertEqual(sig["origin"], "synthetic")
        self.assertEqual(Decimal(sig["close"]), Decimal("13"))
        self.assertEqual(Decimal(sig["threshold"]), Decimal("12"))
        self.assertGreater(Decimal(sig["close"]), Decimal(sig["threshold"]))
        # Verify delayed revision r2 changed bar 14:32Z high from 12 to 15
        bar_32_latest = next(b for b in m1["latest"]["selected"] if b["start"].endswith("14:32:00Z"))
        bar_32_asof = next(b for b in m1["as_of"]["selected"] if b["start"].endswith("14:32:00Z"))
        self.assertEqual(bar_32_asof["revision"], 1)
        self.assertEqual(Decimal(bar_32_asof["high"]), Decimal("12"))
        self.assertEqual(bar_32_latest["revision"], 2)
        self.assertEqual(Decimal(bar_32_latest["high"]), Decimal("15"))

    def test_html_js_structure_links_and_accessibility(self):
        index_html = (DOCS / "index.html").read_text(encoding="utf-8")
        expected_tabs = ["overview", "company", "screener", "score", "risks", "treasury", "replay", "architecture"]
        for t in expected_tabs:
            self.assertIn(f'id="tab-{t}"', index_html)
            self.assertIn(f'id="panel-{t}"', index_html)

        # Verify all local asset href/src links resolve inside docs/
        for page in ("index.html", "notices.html"):
            txt = (DOCS / page).read_text(encoding="utf-8")
            for ref in re.findall(r'(?:href|src)="([^"]+)"', txt):
                if ref.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                self.assertTrue((DOCS / ref).is_file(), f"Broken local reference {ref!r} in {page}")

        # Verify accepted fixes remain present in app.js
        app_js = (DOCS / "app.js").read_text(encoding="utf-8")
        self.assertIn("function headlinePeriod(", app_js)
        self.assertIn("padR = 30", app_js)
        self.assertIn("rs.total_score === null", app_js)

        for js_file in ("data.js", "app.js"):
            res = subprocess.run(["node", "--check", str(DOCS / js_file)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)

    def test_privacy_non_affiliation_and_no_invented_license(self):
        self.assertFalse((DEMO_ROOT / "LICENSE").exists(), "No root LICENSE should exist without owner authorization")
        forbidden = [
            r"/" + "Users/",
            r"github\.com/erturkeryavuz/Trading-Edge-Terminal",
            r"github\.com/erturkeryavuz/GoSil",
            r"ghp_[A-Za-z0-9_]{20,}",
            r"PRIVATE KEY",
            r"Co-Authored-By",
        ]
        for path in [DEMO_ROOT / "README.md", *DOCS.rglob("*")]:
            if not path.is_file():
                continue
            txt = path.read_text(encoding="utf-8")
            for pat in forbidden:
                self.assertIsNone(re.search(pat, txt, re.I), f"Forbidden pattern {pat!r} in {path.name}")
        notices_html = (DOCS / "notices.html").read_text(encoding="utf-8")
        notices_md = (DOCS / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        for doc in (notices_html, notices_md):
            self.assertIn("17 U.S.C. § 105", doc)
            self.assertIn("2026-11-12", doc)
            self.assertIn("not", doc.lower())


if __name__ == "__main__":
    unittest.main()
