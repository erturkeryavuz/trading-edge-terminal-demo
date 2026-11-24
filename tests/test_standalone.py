"""Independent standalone integrity & contract tests for Trading Edge Terminal.

Runs with zero access to the private engineering repository, zero private environment
variables, zero network calls, and Python 3.9+ standard library + Node syntax check only.
"""
from decimal import Decimal
import json
import re
import struct
import subprocess
import unittest
from pathlib import Path

DEMO_ROOT = Path(__file__).resolve().parent.parent
DOCS = DEMO_ROOT / "docs"
MEDIA = DEMO_ROOT / "media"
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
UTC_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")


def load_data():
    raw = (DOCS / "data.js").read_text(encoding="utf-8")
    m = re.search(r"Object\.freeze\((.*)\);\s*$", raw, re.S)
    assert m, "Unable to parse window.TET_SHOWCASE_DATA"
    return json.loads(m.group(1))


def png_dimensions(path: Path):
    head = path.read_bytes()[:24]
    assert head[:8] == b"\x89PNG\r\n\x1a\n", f"Not a valid PNG: {path}"
    return struct.unpack(">II", head[16:24])


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

            for mk, mv in m.items():
                dval = Decimal(str(mv["val"]))
                self.assertTrue(dval.is_finite(), f"Non-finite {mk} in {c['ticker']}")
                self.assertIsInstance(mv["is_calculated"], bool)

            # FCF == OCF - CapEx (exact Decimal arithmetic)
            if all(k in m for k in ("operating_cash_flow", "capex", "free_cash_flow")):
                self.assertEqual(
                    Decimal(str(m["free_cash_flow"]["val"])),
                    Decimal(str(m["operating_cash_flow"]["val"])) - Decimal(str(m["capex"]["val"])),
                    f"FCF mismatch for {c['ticker']}",
                )

            # Net Debt == Total Debt - Cash & Short-Term Investments
            if all(k in m for k in ("total_debt", "cash_and_short_term_investments", "net_debt")):
                self.assertEqual(
                    Decimal(str(m["net_debt"]["val"])),
                    Decimal(str(m["total_debt"]["val"])) - Decimal(str(m["cash_and_short_term_investments"]["val"])),
                    f"Net Debt mismatch for {c['ticker']}",
                )

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
        bar_32_latest = next(b for b in m1["latest"]["selected"] if b["start"].endswith("14:32:00Z"))
        bar_32_asof = next(b for b in m1["as_of"]["selected"] if b["start"].endswith("14:32:00Z"))
        self.assertEqual(bar_32_asof["revision"], 1)
        self.assertEqual(Decimal(bar_32_asof["high"]), Decimal("12"))
        self.assertEqual(bar_32_latest["revision"], 2)
        self.assertEqual(Decimal(bar_32_latest["high"]), Decimal("15"))
        self.assertEqual(m1["latest"]["calendar"]["version"], "US-RTH-2026-2027/v1")

    def test_html_js_structure_tutorial_and_accessibility(self):
        index_html = (DOCS / "index.html").read_text(encoding="utf-8")
        expected_tabs = ["overview", "company", "screener", "evaluation", "treasury", "replay", "architecture"]
        for t in expected_tabs:
            self.assertIn(f'id="tab-{t}"', index_html)
            self.assertIn(f'id="panel-{t}"', index_html)

        # Watch Tutorial dock, phase pills, and playback controls present
        for elem_id in ("btnWatchTutorial", "tutorialDock", "tutPhasePills", "btnTutPrev", "btnTutPlayPause", "btnTutNext", "btnTutRestart", "btnTutExit"):
            self.assertIn(f'id="{elem_id}"', index_html)

        # Verify all local asset href/src links resolve inside docs/
        for page in ("index.html", "notices.html"):
            txt = (DOCS / page).read_text(encoding="utf-8")
            for ref in re.findall(r'(?:href|src)="([^"]+)"', txt):
                if ref.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                self.assertTrue((DOCS / ref).is_file(), f"Broken local reference {ref!r} in {page}")

        # Verify key application contracts in app.js & styles.css
        app_js = (DOCS / "app.js").read_text(encoding="utf-8")
        css = (DOCS / "styles.css").read_text(encoding="utf-8")
        for token in (
            "function headlinePeriod(",
            "function operatingMarginDeltaPp(",
            "function fmtSignedBps(",
            "padR = 30",
            "rs.total_score === null",
            "rep.calendar.version",
            "window.__TET_TUTORIAL__",
            "clearTutorialTimers",
            "restoreState",
            "prefersReducedMotion",
            "resolveActivePhasesForStage",
            "isElementFullyInClearViewport",
            "goToPhase",
            "as-of-chart",
            "latest-chart",
            "replay-chart-box",
        ):
            self.assertIn(token, app_js)
        self.assertIn("position: sticky;", css)
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn(".tut-phase-btn", css)

        for js_file in ("data.js", "app.js"):
            res = subprocess.run(["node", "--check", str(DOCS / js_file)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)

    def test_sequential_tutorial_stage_contracts(self):
        app_js = (DOCS / "app.js").read_text(encoding="utf-8")
        # All 7 logical stages remain preserved with explicit sequential sub-phases
        for stage_id in (
            '"overview"',
            '"company-fundamentals"',
            '"screener-peers"',
            '"scoring-diff"',
            '"risk-audit"',
            '"treasury-macro"',
            '"revision-replay"',
        ):
            self.assertIn(f"id: {stage_id}", app_js)
        # Stage 7 Revision Replay must explicitly cover As-Of result, As-Of chart, Latest result, and Latest chart
        for phase_id in ('"as-of-result"', '"as-of-chart"', '"latest-result"', '"latest-chart"'):
            self.assertIn(f"id: {phase_id}", app_js)
        # Every demonstrated target anchor referenced by tutorial phases exists in app.js markup
        for anchor in (
            'id="ov-watchlist-card"',
            'id="ov-treasury-card"',
            'id="company-flow-card"',
            'id="company-margin-card"',
            'id="company-stmt-card"',
            'id="screener-table-wrap"',
            'id="screener-peer-warnings"',
            'id="score-compare-table"',
            'id="score-breakdown-kpis"',
            'id="risk-first-card"',
            'id="treasury-curve-card"',
            'id="treasury-history-card"',
            'id="replay-controls"',
            'id="replay-notice"',
            'id="replay-chart-box"',
        ):
            self.assertIn(anchor, app_js, f"Missing tutorial target anchor {anchor}")

    def test_artwork_dimensions_and_data_grounding(self):
        hero_png = MEDIA / "trading-edge-terminal-readme-hero.png"
        social_png = MEDIA / "trading-edge-terminal-social-preview.png"
        hero_svg = MEDIA / "src" / "trading-edge-terminal-readme-hero.svg"
        social_svg = MEDIA / "src" / "trading-edge-terminal-social-preview.svg"
        for p in (hero_png, social_png, hero_svg, social_svg):
            self.assertTrue(p.is_file(), f"Missing artwork asset {p}")

        self.assertEqual(png_dimensions(hero_png), (1600, 900))
        self.assertEqual(png_dimensions(social_png), (1280, 640))

        # Verify artwork SVG values match docs/data.js and exclude process/test counts
        latest = self.data["treasury"]["latest"]
        for svg_p in (hero_svg, social_svg):
            txt = svg_p.read_text(encoding="utf-8")
            self.assertIn(latest["y10"] + "%", txt)
            self.assertIn("+" + latest["spread_10y_2y"] + "%", txt)
            self.assertIn("2026-11-10", txt)
            self.assertIn("MSFT", txt)
            self.assertIn("AAPL", txt)
            self.assertIn("NVDA", txt)
            for banned_promo in ("250/250", "M2 Unit", "m2u3", "m2-unit4", "7 stages", "Phase"):
                self.assertNotIn(banned_promo, txt, f"Promotional leakage {banned_promo!r} in {svg_p.name}")

    def test_privacy_non_affiliation_and_no_invented_license(self):
        self.assertFalse((DEMO_ROOT / "LICENSE").exists(), "No root LICENSE should exist without owner authorization")
        forbidden = [
            r"/" + "Users/",
            r"github\.com/erturkeryavuz/Trading-Edge-Terminal",
            r"github\.com/erturkeryavuz/GoSil",
            r"ghp_[A-Za-z0-9_]{20,}",
            r"sk-[A-Za-z0-9_-]{20,}",
            r"PRIVATE KEY",
            r"Co-Authored-By",
        ]
        scan_files = [DEMO_ROOT / "README.md", *DOCS.rglob("*"), *(MEDIA / "src").rglob("*.svg")]
        for path in scan_files:
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
