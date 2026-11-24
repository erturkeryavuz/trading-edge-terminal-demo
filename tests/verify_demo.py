"""Automated offline verification for the Trading Edge Terminal portfolio demo."""
import json
import os
import re
import subprocess
import unittest
from pathlib import Path

DEMO_ROOT = Path(__file__).resolve().parent.parent
DOCS = DEMO_ROOT / "docs"
MEDIA = DEMO_ROOT / "media"
PRIVATE_TET_ENV = os.environ.get("TET_PRIVATE_SOURCE_DIR", "").strip()
PRIVATE_TET = Path(PRIVATE_TET_ENV) if PRIVATE_TET_ENV else None


def load_showcase_data():
    raw = (DOCS / "data.js").read_text(encoding="utf-8")
    m = re.search(r"Object\.freeze\((.*)\);\s*$", raw, re.S)
    assert m, "Could not parse window.TET_SHOWCASE_DATA from docs/data.js"
    return json.loads(m.group(1))


class TestTradingEdgeShowcase(unittest.TestCase):
    def test_required_files_exist(self):
        for rel in [
            "README.md",
            "docs/index.html",
            "docs/styles.css",
            "docs/data.js",
            "docs/app.js",
            "docs/notices.html",
            "docs/THIRD-PARTY-NOTICES.md",
            "media/trading-edge-terminal-readme-hero.png",
            "media/trading-edge-terminal-social-preview.png",
            "media/src/trading-edge-terminal-readme-hero.svg",
            "media/src/trading-edge-terminal-social-preview.svg",
        ]:
            self.assertTrue((DEMO_ROOT / rel).is_file(), f"Missing {rel}")

    def test_js_syntax_valid_with_node(self):
        for fn in ["data.js", "app.js"]:
            res = subprocess.run(["node", "--check", str(DOCS / fn)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, f"node --check failed on {fn}: {res.stderr}")

    def test_zero_secrets_local_paths_or_cross_project_leaks(self):
        banned = [
            r"/" + "Users/",
            r"ghp_[A-Za-z0-9_]{20,}",
            r"sk-[A-Za-z0-9_-]{20,}",
            r"PRIVATE KEY",
            r"erturkeryavuz@gmail\.com",
            r"\b(imf|ws_xru|pgold|psilver|akbank)\b",
            r"Co-Authored-By",
        ]
        scan_files = list(DOCS.rglob("*")) + [DEMO_ROOT / "README.md"] + list((MEDIA / "src").rglob("*.svg"))
        for path in scan_files:
            if not path.is_file():
                continue
            txt = path.read_text(encoding="utf-8")
            for pat in banned:
                self.assertIsNone(
                    re.search(pat, txt, re.I),
                    f"Disallowed pattern {pat!r} matched in {path.relative_to(DEMO_ROOT)}",
                )
        self.assertNotIn("/" + "Users/erturkeryavuz", (DEMO_ROOT / "tests" / "verify_demo.py").read_text(encoding="utf-8"))

    def test_zero_external_runtime_scripts_or_trackers(self):
        html = (DOCS / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("cdn.", html.lower())
        self.assertNotIn("fonts.googleapis", html.lower())
        self.assertNotIn("onclick=", html.lower())
        self.assertIn("prefers-reduced-motion", (DOCS / "styles.css").read_text(encoding="utf-8"))

    def test_data_integrity_and_source_parity(self):
        data = load_showcase_data()
        self.assertEqual(data["meta"]["snapshot_date"], "2026-11-12")
        self.assertEqual(data["meta"]["operating_count"], 17)
        self.assertEqual(data["meta"]["etf_boundary_count"], 1)
        self.assertEqual(len(data["companies"]), 18)
        self.assertEqual(len(data["strategies"]), 4)
        self.assertEqual(len(data["treasury"]["curve_points"]), 13)
        self.assertEqual(len(data["treasury"]["history"]), 260)

        spy = next(c for c in data["companies"] if c["ticker"] == "SPY")
        self.assertEqual(spy["asset_type"], "ETF")
        self.assertIsNone(spy["research_score"]["total_score"])

        if PRIVATE_TET and (PRIVATE_TET / "demo-research" / "research.json").is_file():
            src_json = PRIVATE_TET / "demo-research" / "research.json"
            src = json.loads(src_json.read_text(encoding="utf-8"))
            src_all = {c["ticker"]: c for c in src["companies"] + src["universe_companies"]}
            for c in data["companies"]:
                sc = src_all[c["ticker"]]
                self.assertEqual(c["research_score"]["total_score"], sc["research_score"]["total_score"])
                if c["availability_status"] == "ready":
                    hp = c["ttm"] or c["annual_periods"][-1]
                    shp = sc["ttm"] or sc["annual_periods"][-1]
                    self.assertEqual(hp["metrics"]["revenue"]["val"], shp["metrics"]["revenue"]["val"])
                    self.assertEqual(hp["ratios"]["operating_margin_pct"], shp["ratios"]["operating_margin_pct"])
            self.assertEqual(data["treasury"]["latest"]["y10"], src["treasury"]["latest"]["y10"])
            self.assertEqual(data["treasury"]["latest"]["spread_10y_2y"], src["treasury"]["latest"]["spread_10y_2y"])

    def test_synthetic_m1_replay_determinism(self):
        data = load_showcase_data()
        m1 = data["m1_replay"]
        self.assertEqual(len(m1["latest"]["signals"]), 0)
        self.assertEqual(len(m1["as_of"]["signals"]), 1)
        sig = m1["as_of"]["signals"][0]
        self.assertEqual(sig["origin"], "synthetic")
        self.assertEqual(sig["close"], "13")
        self.assertEqual(sig["threshold"], "12")
        self.assertEqual(sig["decision_known_at"], "2026-01-05T14:34:02Z")

    def test_mandatory_scope_and_non_advisory_disclosures(self):
        for fn in ["index.html", "notices.html", "THIRD-PARTY-NOTICES.md"]:
            txt = (DOCS / fn).read_text(encoding="utf-8").lower()
            self.assertIn("not", txt)
            self.assertIn("sec edgar", txt)
            self.assertIn("treasury", txt)
            self.assertIn("synthetic", txt)
        readme = (DEMO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("media/trading-edge-terminal-readme-hero.png", readme)
        self.assertIn("https://erturkeryavuz.github.io/trading-edge-terminal-demo/", readme)
        self.assertNotIn("pending independent review and publication", readme.lower())


if __name__ == "__main__":
    unittest.main()
