# Trading Edge Terminal — Frozen Historical Research Showcase

> **Status: FROZEN — Historical Research Showcase (M2 Unit 4 Snapshot, `2026-11-12`)**
>
> This standalone static repository presents the engineering capabilities of **Trading Edge Terminal** — a private, local-first U.S. financial research workstation whose active development has been discontinued. It is **not live market data**, **not financial or investment advice**, performs **no brokerage execution or trade routing**, and makes **no claim of trading profitability**.

---

## What This Showcase Demonstrates

This zero-backend static web application under [`docs/`](docs/) preserves the core analytical workflows of Trading Edge Terminal without exposing private repository history, local workspace paths, or raw bulk cache files:

1. **Company Research (SEC EDGAR XBRL Snapshot — `2026-11-12`):** Normalized TTM and multi-year Annual (`FY`) fundamentals across 17 U.S. operating companies (`AAPL`, `MSFT`, `NVDA`, `AMZN`, `GOOGL`, `ORCL`, `WMT`, `COST`, `CSCO`, `ADBE`, `PG`, `HD`, `CRM`, `INTC`, `TXN`, `KO`, `AMD`) plus `SPY` demonstrating explicit ETF/fund non-imputation boundaries, `[REPORTED]` vs. `[DERIVED]` metric attribution, exact SEC EDGAR accession links, and `Decimal`-scaled SVG charts.
2. **Financial Screener & Peer Comparison:** Four built-in accounting screening presets, custom numeric filters, sortable columns, direct drill-down, and multi-company peer comparison with automatic fiscal-period alignment offset warnings (`> 45` days).
3. **Explainable Accounting Score (`m2u3-accounting-score-v1`):** Transparent `0–100` 7-component GAAP research heuristic showing every weight, observed accounting input, missing-weight exclusion (`SPY`), and live two-company component delta diff — explicitly **not** a BUY/SELL/HOLD recommendation.
4. **Risk Inspector:** Source-backed, structured 7-field GAAP risk findings (`rule_id`, `category`, `explanation`, `rule_measures`, `limitations`, `how_to_verify`, SEC citations) with clear caveats on bounded rule coverage.
5. **Treasury Macro Context:** Dated U.S. Department of the Treasury Daily Par Yield Curve (`1M`–`30Y` on `2026-11-10`, `260` daily spread observations back to `2025-10-28`) with interactive historical date scrubbing and exact `10Y-2Y` / `10Y-3M` spreads.
6. **Synthetic M1 Revision Replay:** 100% synthetic fabricated 1-minute bar scenario comparing **Latest** (`0` breakouts after a delayed high correction `12 → 15`) versus **As-Of `2026-01-05T14:34:02Z`** (`1` breakout: close `13 > 12`) to demonstrate point-in-time anti-lookahead determinism.
7. **Architecture & Verification Evidence:** High-level system architecture diagram, data-provenance guarantees, `250/250` verified historical offline Python unit tests on the private engineering repo, and local static parity checks.

---

## Preview Locally (Zero Dependencies)

```bash
python3 -m http.server 8000 --directory docs
# Open http://127.0.0.1:8000/
```

Run the independent standalone verification suite (requires no private repository or environment variables):

```bash
python3 -B -m unittest discover -s tests -p "test_*.py" -v
python3 -B -m unittest discover -s tests -p "verify_*.py" -v
```

---

## Data Provenance, Boundaries & Limitations

- **Private Source Boundary:** The original `Trading-Edge-Terminal` Python/SQLite workstation repository remains **private and frozen**. This repository contains only the sanitized static showcase and verification checks.
- **Public-Domain Federal Snapshot:** Minimal normalized SEC EDGAR numeric facts and U.S. Treasury Daily Par Yield Curve rates reflect a fixed historical snapshot (`2026-11-12`) under U.S. federal public-domain provisions (`17 U.S.C. § 105`), with zero bulk filing attachments, zero third-party logos, and zero implied government endorsement. See [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md) and [`docs/notices.html`](docs/notices.html).
- **Synthetic M1 Data:** All bar-revision and breakout values in *Revision Replay* are fabricated numbers, not historical exchange quotes or a profitable trading strategy.
- **No Stock Prices / No Live Trading:** The terminal tracks historical SEC GAAP fundamentals and Treasury rates — never live equity quotes, valuation multiples, brokerage accounts, or automated orders.
- **License Status:** No root open-source license file is declared without separate owner authorization.
