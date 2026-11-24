# Third-Party Data Notices, Provenance & Boundaries

This standalone static browser preview presents **Trading Edge Terminal** — an independent, frozen local-first U.S. financial research and market-observation engineering project by Ertürk Eryavuz. It is **not** live market data, **not** investment or financial advice, performs **no** brokerage execution, and is **not** affiliated with or endorsed by the U.S. Securities and Exchange Commission (SEC), the U.S. Department of the Treasury, NYSE, Nasdaq, or any listed company.

## 1. U.S. SEC EDGAR Public Filing Facts (Historical Snapshot: 2026-11-12)
- **Source:** U.S. Securities and Exchange Commission (SEC) EDGAR system (`https://data.sec.gov/api/xbrl/companyfacts/` and `https://data.sec.gov/submissions/`).
- **Records Included:** Minimal normalized numeric GAAP accounting facts (`revenue`, `gross_profit`, `operating_income`, `net_income`, `operating_cash_flow`, `capex`, `free_cash_flow`, `cash_and_short_term_investments`, `total_debt`, `net_debt`, `stockholders_equity`, `shares_diluted`), derived accounting ratios and growth metrics, filing accession numbers, filing dates, and form types for 17 U.S. operating companies (`AAPL`, `MSFT`, `NVDA`, `AMZN`, `GOOGL`, `ORCL`, `WMT`, `COST`, `CSCO`, `ADBE`, `PG`, `HD`, `CRM`, `INTC`, `TXN`, `KO`, `AMD`) plus explicit non-operating ETF coverage metadata for `SPY`.
- **Rights & Attribution Basis:** Only minimal factual numeric GAAP accounting disclosures, filing dates, form identifiers, CIKs, and official SEC EDGAR accession URLs are extracted; no issuer-authored filing narratives, exhibits, company logos, or personal executive records are bundled. (U.S. federal public-domain provisions under `17 U.S.C. § 105` apply to U.S. federal government works such as U.S. Treasury statistical publications rather than issuer-authored SEC prose.) Cited strictly for factual attribution with zero implied endorsement.
- **Snapshot Boundary:** All figures reflect a fixed historical snapshot retrieved on `2026-11-12` and are not updated live.

## 2. U.S. Department of the Treasury Par Yield Curve (Historical Snapshot: 2025-10-28 to 2026-11-10)
- **Source:** U.S. Department of the Treasury — Daily Treasury Par Yield Curve Rates (`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/`).
- **Records Included:** Dated daily par yield rates (`1M`–`30Y` tenors for `2026-11-10`, plus `260` dated `3M`/`2Y`/`10Y`/`30Y` and `10Y-2Y` / `10Y-3M` spread observations spanning `2025-10-28` through `2026-11-10`; total acquired historical series spans `2025-01-02` to `2026-11-10`, `465` observations).
- **Rights & Attribution Basis:** U.S. Federal Government statistical data generally in the U.S. public domain under `17 U.S.C. § 105`; cited to the U.S. Department of the Treasury without implying endorsement.

## 3. Synthetic Bar-Revision & Breakout Replay Fixture
- **Source:** 100% original fabricated numbers authored for `fixtures/m1_revisions.json` (`fixture:TEST`, four 1-minute synthetic bars on `2026-01-05` with one idempotent duplicate and one delayed high correction `12 → 15`).
- **Calendar Reference:** Bounded `2026–2027` NYSE Regular Trading Hours schedule (`US-RTH-2026-2027/v1`, `09:30–16:00 America/New_York`, 20 holidays, 3 early closes) verified against published NYSE/Nasdaq holiday schedules on `2026-11-04`.
- **Boundary:** Strictly an offline engineering proof of point-in-time `as-of` determinism — **not** real exchange prices and **not** a validated or profitable trading strategy.

## 4. Original Code, Visual Assets & License Status
- The original Python 3.9+ / SQLite Trading Edge Terminal engineering repository remains private and frozen; this static preview runs client-side in the browser from verified exported fixtures.
- All HTML, CSS, JavaScript, SVG brand graphics, SVG financial charts, and diagrams in this preview were authored originally with zero external runtime libraries, third-party fonts, trackers, or stock imagery.
- No open-source root `LICENSE` is declared without separate owner authorization.
