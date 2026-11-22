(function () {
  "use strict";

  const DATA = window.TET_SHOWCASE_DATA;
  if (!DATA) return;

  const COMPANIES = DATA.companies || [];
  const OPERATING = COMPANIES.filter((c) => c.availability_status === "ready");
  const BY_TICKER = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c]));
  const RISKS = DATA.risks || [];
  const STRATEGIES = DATA.strategies || [];
  const TREASURY = DATA.treasury || {};
  const M1 = DATA.m1_replay || {};

  const STATE = {
    tab: "overview",
    selectedTicker: "AAPL",
    statementPeriod: "TTM",
    screenerPreset: "all",
    screenerQuery: "",
    screenerMinOpMargin: "",
    screenerMinScore: "",
    screenerPosFcf: false,
    screenerNetCash: false,
    screenerSortKey: "score",
    screenerSortDir: "desc",
    peerTickers: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "SPY"],
    scoreTicker: "MSFT",
    compareA: "AAPL",
    compareB: "MSFT",
    riskSeverity: "all",
    riskCategory: "all",
    riskTicker: "all",
    riskQuery: "",
    treasuryIdx: Math.max(0, (TREASURY.history || []).length - 1),
    replayMode: "as_of",
  };

  function esc(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeSecUrl(url) {
    if (typeof url !== "string") return null;
    if (url.startsWith("https://www.sec.gov/") || url.startsWith("https://home.treasury.gov/")) {
      return url;
    }
    return null;
  }

  function num(val) {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function fmtBillions(valStr) {
    const n = num(valStr);
    if (n === null) return "—";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
    return sign + "$" + abs.toLocaleString("en-US");
  }

  function fmtPct(valStr, signed) {
    const n = num(valStr);
    if (n === null) return "—";
    const prefix = signed && n > 0 ? "+" : "";
    return prefix + n.toFixed(2) + "%";
  }

  function fmtRatio(valStr) {
    const n = num(valStr);
    if (n === null) return "—";
    return n.toFixed(2) + "x";
  }

  function sevClass(sev) {
    const s = (sev || "info").toLowerCase();
    if (s === "high") return "pill-high";
    if (s === "medium") return "pill-medium";
    if (s === "low") return "pill-low";
    return "pill-info";
  }

  function daysBetween(dateA, dateB) {
    if (!dateA || !dateB) return null;
    const a = Date.parse(dateA + "T00:00:00Z");
    const b = Date.parse(dateB + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round(Math.abs(a - b) / 86400000);
  }

  function headlinePeriod(company) {
    if (!company) return null;
    if (company.ttm) return company.ttm;
    const aps = company.annual_periods || [];
    return aps.length ? aps[aps.length - 1] : null;
  }

  function metricVal(company, periodKey, metricKey) {
    const p = periodKey === "TTM" ? headlinePeriod(company) : (company.annual_periods || []).find((x) => x.period_key === periodKey);
    return p && p.metrics && p.metrics[metricKey] ? p.metrics[metricKey] : null;
  }

  // ---------- Header & Tab Switching ----------
  function renderHeaderMeta() {
    const el = document.getElementById("header-meta");
    if (!el) return;
    const m = DATA.meta;
    el.innerHTML =
      '<span class="meta-chip">Snapshot <strong>' + esc(m.snapshot_date) + "</strong></span>" +
      '<span class="meta-chip">Universe <strong>' + esc(m.operating_count) + " SEC + " + esc(m.etf_boundary_count) + " ETF</strong></span>" +
      '<span class="meta-chip">Status <strong>FROZEN (' + esc(m.version) + ")</strong></span>";
  }

  function switchTab(tabName) {
    STATE.tab = tabName;
    const tabs = Array.from(document.querySelectorAll("#main-tablist .nav-tab"));
    tabs.forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.hidden = panel.id !== "panel-" + tabName;
    });
    renderActiveTab();
  }

  function inspectCompany(ticker) {
    if (!BY_TICKER[ticker]) return;
    STATE.selectedTicker = ticker;
    STATE.statementPeriod = "TTM";
    switchTab("company");
  }

  function setupTabs() {
    const tablist = document.getElementById("main-tablist");
    const tabs = Array.from(tablist.querySelectorAll(".nav-tab"));
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
      btn.addEventListener("keydown", (ev) => {
        const idx = tabs.indexOf(btn);
        let next = null;
        if (ev.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
        else if (ev.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
        else if (ev.key === "Home") next = tabs[0];
        else if (ev.key === "End") next = tabs[tabs.length - 1];
        if (next) {
          ev.preventDefault();
          next.focus();
          switchTab(next.dataset.tab);
        }
      });
    });
  }

  // ---------- Original SVG Charts ----------
  function renderFlowBarsSvg(company) {
    const periods = (company.annual_periods || []).slice(-5);
    if (!periods.length) return '<p class="muted">No annual flow history available.</p>';
    const W = 620, H = 230, padL = 58, padR = 16, padT = 20, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const vals = [];
    periods.forEach((p) => {
      ["revenue", "net_income", "free_cash_flow"].forEach((k) => {
        const v = num(p.metrics && p.metrics[k] && p.metrics[k].val);
        if (v !== null) vals.push(v / 1e9);
      });
    });
    const maxV = Math.max(10, ...vals, 0);
    const minV = Math.min(0, ...vals);
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const zeroY = yOf(0);
    const groupW = plotW / periods.length;
    const barW = Math.min(22, (groupW - 18) / 3);

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1e2a3d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#7e91ac" font-size="10.5" text-anchor="end" font-family="monospace">$' + gv.toFixed(0) + 'B</text>';
    }
    grid += '<line x1="' + padL + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + zeroY.toFixed(1) + '" stroke="#3b4f6e" stroke-width="1.2" />';

    const colors = { revenue: "#5b9cf6", net_income: "#d9a441", free_cash_flow: "#34c77b" };
    let bars = "";
    periods.forEach((p, idx) => {
      const cx = padL + idx * groupW + groupW / 2;
      const startX = cx - (barW * 3 + 6) / 2;
      ["revenue", "net_income", "free_cash_flow"].forEach((k, bi) => {
        const raw = num(p.metrics && p.metrics[k] && p.metrics[k].val);
        if (raw === null) return;
        const v = raw / 1e9;
        const y = v >= 0 ? yOf(v) : zeroY;
        const h = Math.max(1.5, Math.abs(yOf(v) - zeroY));
        const x = startX + bi * (barW + 3);
        const fill = k === "free_cash_flow" && v < 0 ? "#eb5757" : colors[k];
        bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + fill + '"><title>' + esc(p.period_label + " " + k + ": " + fmtBillions(raw)) + "</title></rect>";
      });
      bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="#93a4bc" font-size="11" text-anchor="middle" font-family="monospace">' + esc(p.period_label) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Annual Revenue, Net Income, and Free Cash Flow for ' + esc(company.ticker) + '">' +
      grid + bars +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="legend-dot" style="background:#5b9cf6"></i>Revenue</span>' +
      '<span><i class="legend-dot" style="background:#d9a441"></i>Net Income</span>' +
      '<span><i class="legend-dot" style="background:#34c77b"></i>Free Cash Flow (red if negative)</span>' +
      "</div></div>"
    );
  }

  function renderMarginLinesSvg(company) {
    const periods = (company.annual_periods || []).slice(-5);
    if (!periods.length) return '<p class="muted">No margin history available.</p>';
    const W = 620, H = 230, padL = 52, padR = 30, padT = 20, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const seriesKeys = [
      { key: "gross_margin_pct", label: "Gross Margin", color: "#5b9cf6" },
      { key: "operating_margin_pct", label: "Operating Margin", color: "#d9a441" },
      { key: "fcf_margin_pct", label: "FCF Margin", color: "#34c77b" },
    ];
    const allV = [];
    periods.forEach((p) => {
      seriesKeys.forEach((s) => {
        const v = num(p.ratios && p.ratios[s.key]);
        if (v !== null) allV.push(v);
      });
    });
    const maxV = Math.max(20, ...allV, 0);
    const minV = Math.min(0, ...allV);
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const xOf = (i) => periods.length === 1 ? padL + plotW / 2 : padL + (i / (periods.length - 1)) * plotW;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1e2a3d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#7e91ac" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(0) + "%</text>";
    }

    let paths = "";
    seriesKeys.forEach((s) => {
      const pts = [];
      periods.forEach((p, idx) => {
        const v = num(p.ratios && p.ratios[s.key]);
        if (v !== null) pts.push({ x: xOf(idx), y: yOf(v), v, lbl: p.period_label });
      });
      if (pts.length > 1) {
        const d = pts.map((pt, i) => (i === 0 ? "M" : "L") + pt.x.toFixed(1) + "," + pt.y.toFixed(1)).join(" ");
        paths += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.2" />';
      }
      pts.forEach((pt) => {
        paths += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="3.6" fill="' + s.color + '"><title>' + esc(pt.lbl + " " + s.label + ": " + pt.v.toFixed(2) + "%") + "</title></circle>";
      });
    });

    let xLabels = "";
    periods.forEach((p, idx) => {
      xLabels += '<text x="' + xOf(idx).toFixed(1) + '" y="' + (H - 10) + '" fill="#93a4bc" font-size="11" text-anchor="middle" font-family="monospace">' + esc(p.period_label) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Annual Gross, Operating, and Free Cash Flow Margins for ' + esc(company.ticker) + '">' +
      grid + paths + xLabels +
      "</svg>" +
      '<div class="chart-legend">' +
      seriesKeys.map((s) => '<span><i class="legend-dot" style="background:' + s.color + '"></i>' + esc(s.label) + "</span>").join("") +
      "</div></div>"
    );
  }

  function renderTreasuryCurveSvg(curvePoints) {
    if (!curvePoints || !curvePoints.length) return "";
    const W = 680, H = 250, padL = 52, padR = 20, padT = 22, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const vals = curvePoints.map((c) => num(c.rate_pct)).filter((v) => v !== null);
    const minV = Math.floor((Math.min(...vals) - 0.3) * 2) / 2;
    const maxV = Math.ceil((Math.max(...vals) + 0.3) * 2) / 2;
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const xOf = (i) => padL + (i / (curvePoints.length - 1)) * plotW;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1e2a3d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#7e91ac" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(2) + "%</text>";
    }

    const pts = curvePoints.map((c, i) => ({ x: xOf(i), y: yOf(num(c.rate_pct)), lbl: c.label, v: num(c.rate_pct) }));
    const lineD = pts.map((pt, i) => (i === 0 ? "M" : "L") + pt.x.toFixed(1) + "," + pt.y.toFixed(1)).join(" ");
    const areaD = lineD + " L" + pts[pts.length - 1].x.toFixed(1) + "," + (H - padB) + " L" + pts[0].x.toFixed(1) + "," + (H - padB) + " Z";
    let dots = "";
    pts.forEach((pt) => {
      dots += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="4" fill="#d9a441" stroke="#080c12" stroke-width="1.5"><title>' + esc(pt.lbl + ": " + pt.v.toFixed(2) + "%") + "</title></circle>";
      dots += '<text x="' + pt.x.toFixed(1) + '" y="' + (H - 10) + '" fill="#93a4bc" font-size="10.5" text-anchor="middle" font-family="monospace">' + esc(pt.lbl) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="U.S. Treasury Daily Par Yield Curve on 2026-11-10">' +
      grid +
      '<path d="' + areaD + '" fill="rgba(217,164,65,0.12)" />' +
      '<path d="' + lineD + '" fill="none" stroke="#d9a441" stroke-width="2.4" />' +
      dots +
      "</svg></div>"
    );
  }

  function renderTreasuryHistorySvg(history, activeIdx) {
    if (!history || !history.length) return "";
    const W = 680, H = 250, padL = 52, padR = 20, padT = 20, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const allV = [];
    history.forEach((row) => {
      ["m3", "y2", "y10"].forEach((k) => {
        const v = num(row[k]);
        if (v !== null) allV.push(v);
      });
    });
    const minV = Math.floor((Math.min(...allV) - 0.25) * 2) / 2;
    const maxV = Math.ceil((Math.max(...allV) + 0.25) * 2) / 2;
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const xOf = (i) => padL + (i / Math.max(1, history.length - 1)) * plotW;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1e2a3d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#7e91ac" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(2) + "%</text>";
    }

    const lines = [
      { key: "y10", label: "10Y", color: "#d9a441" },
      { key: "y2", label: "2Y", color: "#5b9cf6" },
      { key: "m3", label: "3M", color: "#34c77b" },
    ];
    let paths = "";
    lines.forEach((s) => {
      const pts = [];
      history.forEach((row, idx) => {
        const v = num(row[s.key]);
        if (v !== null) pts.push(xOf(idx).toFixed(1) + "," + yOf(v).toFixed(1));
      });
      if (pts.length > 1) {
        paths += '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + s.color + '" stroke-width="2" />';
      }
    });

    const cx = xOf(activeIdx);
    const activeRow = history[activeIdx];
    const marker = '<line x1="' + cx.toFixed(1) + '" y1="' + padT + '" x2="' + cx.toFixed(1) + '" y2="' + (H - padB) + '" stroke="#e7edf5" stroke-width="1.2" stroke-dasharray="3 3" />';
    const labelIdx = [0, Math.floor(history.length / 3), Math.floor((2 * history.length) / 3), history.length - 1];
    let xTicks = "";
    labelIdx.forEach((i) => {
      xTicks += '<text x="' + xOf(i).toFixed(1) + '" y="' + (H - 10) + '" fill="#93a4bc" font-size="10.5" text-anchor="middle" font-family="monospace">' + esc(history[i].rate_date) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Historical U.S. Treasury 10Y, 2Y, and 3M Rates from ' + esc(history[0].rate_date) + " to " + esc(history[history.length - 1].rate_date) + '">' +
      grid + paths + marker + xTicks +
      "</svg>" +
      '<div class="chart-legend">' +
      lines.map((s) => '<span><i class="legend-dot" style="background:' + s.color + '"></i>' + s.label + " (" + esc(activeRow[s.key]) + "%)</span>").join("") +
      '<span class="muted">Selected date: <strong class="mono">' + esc(activeRow.rate_date) + "</strong></span>" +
      "</div></div>"
    );
  }

  function renderM1BarsSvg(replay) {
    const bars = replay.selected || [];
    const signals = replay.signals || [];
    const threshold = signals.length ? num(signals[0].threshold) : 15;
    const W = 680, H = 240, padL = 50, padR = 24, padT = 22, padB = 38;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const minP = 7, maxP = 16.5;
    const yOf = (v) => padT + ((maxP - v) / (maxP - minP)) * plotH;
    const slotW = plotW / Math.max(1, bars.length);

    let grid = "";
    for (let p = 8; p <= 16; p += 2) {
      const y = yOf(p);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1e2a3d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#7e91ac" font-size="10.5" text-anchor="end" font-family="monospace">' + p.toFixed(0) + "</text>";
    }

    // Threshold line across bar 4
    const thY = yOf(threshold);
    const thColor = signals.length ? "#34c77b" : "#eb5757";
    let svgBody =
      '<line x1="' + padL + '" y1="' + thY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + thY.toFixed(1) + '" stroke="' + thColor + '" stroke-width="1.6" stroke-dasharray="5 4" />' +
      '<text x="' + (W - padR) + '" y="' + (thY - 6).toFixed(1) + '" fill="' + thColor + '" font-size="11" text-anchor="end" font-family="monospace">Prior 3-bar max high = ' + threshold + "</text>";

    bars.forEach((b, idx) => {
      const cx = padL + idx * slotW + slotW / 2;
      const hi = num(b.high), lo = num(b.low), op = num(b.open), cl = num(b.close);
      const isRevised = b.revision > 1;
      const isSignalBar = idx === 3 && signals.length > 0;
      const color = isSignalBar ? "#34c77b" : (isRevised ? "#d9a441" : "#5b9cf6");
      const topBody = yOf(Math.max(op, cl));
      const botBody = yOf(Math.min(op, cl));
      const bodyH = Math.max(4, botBody - topBody);
      svgBody += '<line x1="' + cx.toFixed(1) + '" y1="' + yOf(hi).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + yOf(lo).toFixed(1) + '" stroke="' + color + '" stroke-width="2.2" />';
      svgBody += '<rect x="' + (cx - 16).toFixed(1) + '" y="' + topBody.toFixed(1) + '" width="32" height="' + bodyH.toFixed(1) + '" rx="3" fill="' + color + '" fill-opacity="0.3" stroke="' + color + '" stroke-width="1.8" />';
      svgBody += '<text x="' + cx.toFixed(1) + '" y="' + (yOf(hi) - 6).toFixed(1) + '" fill="#e7edf5" font-size="10.5" text-anchor="middle" font-family="monospace">H:' + esc(b.high) + " C:" + esc(b.close) + " (r" + esc(b.revision) + ")</text>";
      const tShort = (b.start || "").slice(11, 16) + "Z";
      svgBody += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="#93a4bc" font-size="11" text-anchor="middle" font-family="monospace">' + esc(tShort) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic 1-minute bar revision chart comparing Latest vs As-Of breakout evaluation">' +
      grid + svgBody +
      "</svg></div>"
    );
  }

  // ---------- View 1: Overview ----------
  function renderOverview() {
    const m = DATA.meta;
    const latestTr = TREASURY.latest || {};
    const watch = COMPANIES.filter((c) => c.universe_role === "watchlist");
    const el = document.getElementById("panel-overview");

    el.innerHTML =
      '<div class="section-head"><div>' +
      "<h2>Institutional Research Overview</h2>" +
      "<p>Frozen historical portfolio showcase of Trading Edge Terminal (M2 Unit 4) — SEC EDGAR fundamentals, U.S. Treasury macro curves, and synthetic M1 point-in-time replay.</p>" +
      "</div></div>" +

      '<div class="notice notice-amber">' +
      "<strong>FROZEN PROJECT BOUNDARY:</strong> " + esc(m.disclaimer) +
      "</div>" +

      '<div class="kpi-grid">' +
      '<div class="kpi-card"><div class="kpi-label">SEC Operating Companies</div><div class="kpi-value">' + esc(m.operating_count) + '</div><div class="kpi-detail">Plus 1 ETF boundary (SPY excluded from GAAP scoring)</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">U.S. Treasury Observations</div><div class="kpi-value">' + esc(m.treasury_observation_count) + '</div><div class="kpi-detail">10Y: ' + esc(latestTr.y10) + '% · 10Y–2Y: ' + esc(latestTr.spread_10y_2y) + '% (' + esc(latestTr.rate_date) + ")</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">Structured Risk Findings</div><div class="kpi-value">' + esc(m.risk_findings_count) + '</div><div class="kpi-detail">Source-backed 7-field GAAP audit rules</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Private Repo Offline Tests</div><div class="kpi-value">' + esc(m.verified_offline_tests) + '/250</div><div class="kpi-detail">Stdlib-only Python unittest suite verified offline</div></div>' +
      "</div>" +

      '<div class="card">' +
      "<h3>Core Watchlist Snapshot (Dated 2026-11-12)</h3>" +
      '<p class="card-sub">Click any entity to open its full SEC EDGAR XBRL statement breakdown, SVG charts, and filing citations.</p>' +
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Ticker</th><th>Issuer</th><th>Latest Form</th><th class=\"num\">TTM Revenue</th><th class=\"num\">Op Margin</th><th class=\"num\">TTM FCF</th><th class=\"num\">Accounting Score</th><th>Action</th>" +
      "</tr></thead><tbody>" +
      watch.map((c) => {
        const isReady = c.availability_status === "ready";
        const rev = isReady && c.ttm && c.ttm.metrics.revenue ? c.ttm.metrics.revenue.display : "—";
        const opm = isReady && c.ttm && c.ttm.ratios ? fmtPct(c.ttm.ratios.operating_margin_pct) : "—";
        const fcf = isReady && c.ttm && c.ttm.metrics.free_cash_flow ? c.ttm.metrics.free_cash_flow.display : "—";
        const fcfClass = isReady && c.ttm && c.ttm.metrics.free_cash_flow && num(c.ttm.metrics.free_cash_flow.val) < 0 ? " neg" : "";
        const sc = c.research_score && c.research_score.total_score !== null ? c.research_score.total_score + " / 100" : "Excluded (ETF)";
        return (
          "<tr>" +
          '<td class="mono"><strong>' + esc(c.ticker) + "</strong></td>" +
          "<td>" + esc(c.name) + "</td>" +
          '<td>' + (isReady ? '<span class="pill pill-reported">' + esc(c.reporting_context.latest_form) + "</span> " + esc(c.reporting_context.latest_filing_date) : '<span class="pill pill-info">ETF / Fund</span>') + "</td>" +
          '<td class="num">' + esc(rev) + "</td>" +
          '<td class="num">' + esc(opm) + "</td>" +
          '<td class="num' + fcfClass + '">' + esc(fcf) + "</td>" +
          '<td class="num">' + esc(sc) + "</td>" +
          '<td><button class="btn btn-sm" data-inspect="' + esc(c.ticker) + '">Inspect →</button></td>' +
          "</tr>"
        );
      }).join("") +
      "</tbody></table></div></div>" +

      '<div class="grid-3">' +
      '<div class="card"><h3>SEC EDGAR Provenance</h3><p class="muted">All corporate statements derive from public-domain U.S. SEC EDGAR XBRL <code>companyfacts</code> and <code>submissions</code> retrieved on 2026-11-12, preserving exact <code>[REPORTED]</code> vs. <code>[DERIVED]</code> formulas and accession URLs.</p><button class="btn btn-sm" data-jump="company">Explore Statements →</button></div>' +
      '<div class="card"><h3>U.S. Treasury Macro Curve</h3><p class="muted">Historical Daily Treasury Par Yield Curve rates spanning <code>1M</code>–<code>30Y</code> maturities (latest observation 2026-11-10) with interactive historical spread scrubbing (<code>10Y–2Y</code>, <code>10Y–3M</code>).</p><button class="btn btn-sm" data-jump="treasury">Open Yield Curve →</button></div>' +
      '<div class="card"><h3>Synthetic M1 As-Of Replay</h3><p class="muted">100% synthetic 1-minute bar revision workbench illustrating how a delayed bar correction changes a breakout evaluation without look-ahead bias or invented trading profits.</p><button class="btn btn-sm" data-jump="replay">Run Revision Replay →</button></div>' +
      "</div>";

    el.querySelectorAll("[data-inspect]").forEach((b) => {
      b.addEventListener("click", () => inspectCompany(b.dataset.inspect));
    });
    el.querySelectorAll("[data-jump]").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.jump));
    });
  }

  // ---------- View 2: Company Research ----------
  function renderCompany() {
    const el = document.getElementById("panel-company");
    const c = BY_TICKER[STATE.selectedTicker] || OPERATING[0];
    const isReady = c.availability_status === "ready";

    const chips = COMPANIES.map((item) => {
      const cls = "ticker-chip" + (item.ticker === c.ticker ? " active" : "") + (item.asset_type === "ETF" ? " etf" : "");
      return '<button class="' + cls + '" data-ticker="' + esc(item.ticker) + '">' + esc(item.ticker) + "</button>";
    }).join("");

    let body = "";
    if (!isReady) {
      body =
        '<div class="notice notice-blue">' +
        "<strong>Explicit Coverage Boundary (" + esc(c.ticker) + " — " + esc(c.name) + "):</strong> " + esc(c.availability_note) +
        "</div>" +
        '<div class="card"><h3>Why ' + esc(c.ticker) + ' Has Zero Fabricated Metrics</h3>' +
        "<p class=\"muted\">Trading Edge Terminal classifies ETF/trust vehicles separately from corporate GAAP operating issuers. Rather than imputing placeholder revenues, margins, or scores, the terminal reports <code>insufficient_data</code> across screening and accounting-score modules.</p></div>";
    } else {
      const hp = headlinePeriod(c) || { metrics: {}, ratios: {} };
      const periodOpts = (c.ttm ? [{ key: "TTM", label: c.ttm.period_label }] : []).concat(
        (c.annual_periods || []).slice().reverse().map((ap) => ({ key: ap.period_key, label: ap.period_label }))
      );
      if (!periodOpts.some((o) => o.key === STATE.statementPeriod)) STATE.statementPeriod = periodOpts[0] ? periodOpts[0].key : "TTM";
      const activePeriod = (STATE.statementPeriod === "TTM" ? c.ttm : (c.annual_periods || []).find((x) => x.period_key === STATE.statementPeriod)) || hp;
      const rc = c.reporting_context || {};
      const secHref = safeSecUrl(rc.latest_sec_url);

      const metricLabels = [
        ["revenue", "Revenue"],
        ["gross_profit", "Gross Profit"],
        ["operating_income", "Operating Income"],
        ["net_income", "Net Income"],
        ["operating_cash_flow", "Operating Cash Flow"],
        ["capex", "Capital Expenditures"],
        ["free_cash_flow", "Free Cash Flow"],
        ["cash_and_short_term_investments", "Cash & Short-Term Inv."],
        ["total_debt", "Total Debt"],
        ["net_debt", "Net Debt"],
        ["stockholders_equity", "Stockholders' Equity"],
        ["shares_diluted", "Diluted Shares"],
      ];

      const rowsHtml = metricLabels.map(([k, lbl]) => {
        const m = activePeriod && activePeriod.metrics ? activePeriod.metrics[k] : null;
        if (!m) return "";
        const badge = m.is_calculated
          ? '<span class="pill pill-derived">DERIVED</span>'
          : '<span class="pill pill-reported">REPORTED</span>';
        const note = m.formula_note || (m.xbrl_tag ? "SEC XBRL tag: " + m.xbrl_tag : "Reported GAAP disclosure");
        return (
          "<tr>" +
          "<td><strong>" + esc(lbl) + "</strong></td>" +
          '<td class="num">' + esc(m.display || fmtBillions(m.val)) + "</td>" +
          "<td>" + badge + "</td>" +
          '<td class="mono muted">' + esc(m.xbrl_tag || m.derivation_method || "—") + "</td>" +
          '<td class="muted">' + esc(note) + "</td>" +
          '<td class="mono muted">' + esc(m.filed_date || activePeriod.filed_date || "—") + "</td>" +
          "</tr>"
        );
      }).join("");

      const r = (activePeriod && activePeriod.ratios) || {};
      const filingsHtml = (c.filings || []).map((f) => {
        const href = safeSecUrl(f.sec_url);
        return (
          "<tr>" +
          '<td><span class="pill pill-reported">' + esc(f.form) + "</span></td>" +
          '<td class="mono">' + esc(f.filing_date) + "</td>" +
          '<td class="mono">' + esc(f.report_date) + "</td>" +
          '<td class="mono">' + esc(f.accession_number) + "</td>" +
          "<td>" + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">SEC EDGAR ↗</a>' : "—") + "</td>" +
          "</tr>"
        );
      }).join("");

      body =
        '<div class="card">' +
        '<div class="section-head" style="margin-bottom:10px"><div>' +
        "<h3>" + esc(c.ticker) + " — " + esc(c.name) + "</h3>" +
        '<p class="muted">CIK <span class="mono">' + esc(c.cik) + "</span> · " + esc(c.exchange || "US") + " · " + esc(c.sic_description || "Operating Company") + " · FY End: <span class=\"mono\">" + esc(rc.fiscal_year_end || "—") + "</span></p>" +
        "</div><div>" +
        (secHref ? '<a class="btn btn-sm" href="' + esc(secHref) + '" target="_blank" rel="noopener noreferrer">Latest ' + esc(rc.latest_form) + " (" + esc(rc.latest_filing_date) + ") ↗</a>" : "") +
        "</div></div>" +
        '<div class="kpi-grid" style="margin-bottom:0">' +
        '<div class="kpi-card"><div class="kpi-label">Headline Revenue</div><div class="kpi-value">' + esc((hp.metrics.revenue && hp.metrics.revenue.display) || "—") + '</div><div class="kpi-detail">YoY: ' + esc(fmtPct(c.growth.revenue_yoy_pct, true)) + " · 3Y CAGR: " + esc(fmtPct(c.growth.revenue_3y_cagr_pct, true)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Operating Margin</div><div class="kpi-value">' + esc(fmtPct(hp.ratios && hp.ratios.operating_margin_pct)) + '</div><div class="kpi-detail">Gross: ' + esc(fmtPct(hp.ratios && hp.ratios.gross_margin_pct)) + " · Net: " + esc(fmtPct(hp.ratios && hp.ratios.net_margin_pct)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Headline Free Cash Flow</div><div class="kpi-value">' + esc((hp.metrics.free_cash_flow && hp.metrics.free_cash_flow.display) || "—") + '</div><div class="kpi-detail">FCF Margin: ' + esc(fmtPct(hp.ratios && hp.ratios.fcf_margin_pct)) + " · Conv: " + esc(fmtPct(hp.ratios && hp.ratios.fcf_conversion_pct)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Net Debt &amp; Score</div><div class="kpi-value">' + esc((hp.metrics.net_debt && hp.metrics.net_debt.display) || "—") + '</div><div class="kpi-detail">Score: ' + esc(c.research_score.total_score) + "/100 (" + esc(c.research_score.band) + ")</div></div>" +
        "</div></div>" +

        '<div class="grid-2">' +
        '<div class="card"><h3>Annual Scale: Revenue, Net Income &amp; FCF</h3>' + renderFlowBarsSvg(c) + "</div>" +
        '<div class="card"><h3>Annual Margin Trajectory (%)</h3>' + renderMarginLinesSvg(c) + "</div>" +
        "</div>" +

        '<div class="card">' +
        '<div class="section-head" style="margin-bottom:12px"><div><h3>Normalized Statement &amp; XBRL Provenance</h3>' +
        '<p class="muted">Window: <span class="mono">' + esc(activePeriod.period_start + " → " + activePeriod.period_end) + "</span> · Gross " + esc(fmtPct(r.gross_margin_pct)) + " · Op " + esc(fmtPct(r.operating_margin_pct)) + " · Net " + esc(fmtPct(r.net_margin_pct)) + " · D/E " + esc(fmtRatio(r.debt_to_equity)) + "</p></div>" +
        '<div class="control-group"><label for="stmt-period-select">Reporting Period</label><select id="stmt-period-select">' +
        periodOpts.map((o) => '<option value="' + esc(o.key) + '"' + (o.key === STATE.statementPeriod ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") +
        "</select></div></div>" +
        '<div class="table-wrap"><table><thead><tr><th>Metric</th><th class="num">Value</th><th>Provenance</th><th>XBRL Tag / Method</th><th>Formula / Notes</th><th>Filed</th></tr></thead><tbody>' +
        rowsHtml +
        "</tbody></table></div></div>" +

        '<div class="card"><h3>Recent Substantive SEC Filings</h3>' +
        '<div class="table-wrap"><table><thead><tr><th>Form</th><th>Filing Date</th><th>Period End</th><th>Accession Number</th><th>Source</th></tr></thead><tbody>' +
        filingsHtml +
        "</tbody></table></div></div>";
    }

    el.innerHTML =
      '<div class="section-head"><div><h2>Company Research (SEC EDGAR XBRL)</h2>' +
      "<p>Select any of the 17 acquired operating equities or the SPY ETF coverage boundary (2026-11-12 historical snapshot).</p></div></div>" +
      '<div class="chip-row" aria-label="Select company">' + chips + "</div>" +
      body;

    el.querySelectorAll("[data-ticker]").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.selectedTicker = b.dataset.ticker;
        STATE.statementPeriod = "TTM";
        renderCompany();
      });
    });
    const sel = document.getElementById("stmt-period-select");
    if (sel) {
      sel.addEventListener("change", () => {
        STATE.statementPeriod = sel.value;
        renderCompany();
      });
    }
  }

  // ---------- View 3: Screener & Peers ----------
  function matchesPreset(c, presetId) {
    if (presetId === "all") return true;
    const strat = STRATEGIES.find((s) => s.strategy_id === presetId);
    if (!strat) return true;
    const cr = strat.criteria || {};
    const ttm = headlinePeriod(c) || {};
    const m = ttm.metrics || {};
    const r = ttm.ratios || {};
    const g = c.growth || {};
    const fcf = num(m.free_cash_flow && m.free_cash_flow.val);
    const netDebt = num(m.net_debt && m.net_debt.val);
    const de = num(r.debt_to_equity);
    const opm = num(r.operating_margin_pct);
    const fcfm = num(r.fcf_margin_pct);
    const fcfc = num(r.fcf_conversion_pct);
    const revYoy = num(g.revenue_yoy_pct);
    const riskCount = RISKS.filter((rk) => rk.ticker === c.ticker && (rk.severity === "high" || rk.severity === "medium")).length;

    const checks = [];
    if (cr.require_net_cash) checks.push(netDebt !== null && netDebt <= 0);
    if (cr.require_positive_fcf) checks.push(fcf !== null && fcf > 0);
    if (cr.max_debt_to_equity !== undefined) checks.push(de !== null && de <= num(cr.max_debt_to_equity));
    if (cr.min_fcf_margin_pct !== undefined) checks.push(fcfm !== null && fcfm >= num(cr.min_fcf_margin_pct));
    if (cr.min_fcf_conversion_pct !== undefined) checks.push(fcfc !== null && fcfc >= num(cr.min_fcf_conversion_pct));
    if (cr.min_operating_margin_pct !== undefined) checks.push(opm !== null && opm >= num(cr.min_operating_margin_pct));
    if (cr.min_revenue_yoy_pct !== undefined) checks.push(revYoy !== null && revYoy >= num(cr.min_revenue_yoy_pct));
    if (cr.max_filing_age_days !== undefined) checks.push(c.filing_age_days !== null && c.filing_age_days <= num(cr.max_filing_age_days));
    if (cr.max_fcf_usd !== undefined) checks.push(fcf !== null && fcf <= num(cr.max_fcf_usd));
    if (cr.max_revenue_yoy_pct !== undefined) checks.push(revYoy !== null && revYoy <= num(cr.max_revenue_yoy_pct));
    if (cr.min_high_or_medium_risks !== undefined) checks.push(riskCount >= num(cr.min_high_or_medium_risks));

    if (!checks.length) return true;
    return cr.match_mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
  }

  function renderScreener() {
    const el = document.getElementById("panel-screener");
    const q = STATE.screenerQuery.trim().toLowerCase();
    const minOp = num(STATE.screenerMinOpMargin);
    const minSc = num(STATE.screenerMinScore);

    let rows = OPERATING.filter((c) => {
      if (!matchesPreset(c, STATE.screenerPreset)) return false;
      if (q && !(c.ticker.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q))) return false;
      const hp = headlinePeriod(c) || { metrics: {}, ratios: {} };
      const opm = num(hp.ratios && hp.ratios.operating_margin_pct);
      const sc = num(c.research_score && c.research_score.total_score);
      const fcf = num(hp.metrics.free_cash_flow && hp.metrics.free_cash_flow.val);
      const nd = num(hp.metrics.net_debt && hp.metrics.net_debt.val);
      if (minOp !== null && (opm === null || opm < minOp)) return false;
      if (minSc !== null && (sc === null || sc < minSc)) return false;
      if (STATE.screenerPosFcf && !(fcf !== null && fcf > 0)) return false;
      if (STATE.screenerNetCash && !(nd !== null && nd <= 0)) return false;
      return true;
    });

    const sortVal = (c, key) => {
      const hp = headlinePeriod(c) || { metrics: {}, ratios: {} };
      if (key === "ticker") return c.ticker;
      if (key === "score") return num(c.research_score && c.research_score.total_score) ?? -999;
      if (key === "revenue") return num(hp.metrics.revenue && hp.metrics.revenue.val) ?? -1e18;
      if (key === "op_margin") return num(hp.ratios && hp.ratios.operating_margin_pct) ?? -999;
      if (key === "fcf") return num(hp.metrics.free_cash_flow && hp.metrics.free_cash_flow.val) ?? -1e18;
      if (key === "net_debt") return num(hp.metrics.net_debt && hp.metrics.net_debt.val) ?? 1e18;
      return 0;
    };
    rows.sort((a, b) => {
      const av = sortVal(a, STATE.screenerSortKey);
      const bv = sortVal(b, STATE.screenerSortKey);
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return STATE.screenerSortDir === "asc" ? cmp : -cmp;
    });

    const activeStrat = STRATEGIES.find((s) => s.strategy_id === STATE.screenerPreset);
    const arrow = (k) => STATE.screenerSortKey === k ? (STATE.screenerSortDir === "asc" ? " ▲" : " ▼") : "";

    // Peer comparison & fiscal alignment warnings
    const selectedPeers = STATE.peerTickers.map((t) => BY_TICKER[t]).filter(Boolean);
    const readyPeers = selectedPeers.filter((c) => c.availability_status === "ready");
    const periodEnds = readyPeers.map((c) => ({ t: c.ticker, d: c.reporting_context.headline_period_end })).filter((x) => x.d);
    let maxOffset = 0, offsetPair = "";
    for (let i = 0; i < periodEnds.length; i++) {
      for (let j = i + 1; j < periodEnds.length; j++) {
        const diff = daysBetween(periodEnds[i].d, periodEnds[j].d);
        if (diff !== null && diff > maxOffset) {
          maxOffset = diff;
          offsetPair = periodEnds[i].t + " (" + periodEnds[i].d + ") vs " + periodEnds[j].t + " (" + periodEnds[j].d + ")";
        }
      }
    }
    const peerWarnings = [];
    if (maxOffset > 45) {
      peerWarnings.push("Fiscal-period alignment offset of " + maxOffset + " days detected (" + offsetPair + ") — compare cross-company TTM periods cautiously.");
    }
    const uncoveredPeers = selectedPeers.filter((c) => c.availability_status !== "ready").map((c) => c.ticker);
    if (uncoveredPeers.length) {
      peerWarnings.push("Non-operating / ETF entity included in peer selection (" + uncoveredPeers.join(", ") + ") — omitted from corporate GAAP averages without imputation.");
    }

    el.innerHTML =
      '<div class="section-head"><div><h2>Financial Screener &amp; Peer Comparison</h2>' +
      "<p>Deterministic GAAP screening across 17 acquired SEC operating companies (SPY excluded cleanly) plus alignment-aware peer comparison.</p></div></div>" +

      '<div class="card">' +
      "<h3>Evidence-Based Financial Screener (" + rows.length + " / " + OPERATING.length + " matched)</h3>" +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="scr-preset">Strategy Preset</label><select id="scr-preset">' +
      '<option value="all"' + (STATE.screenerPreset === "all" ? " selected" : "") + ">All 17 Operating Companies</option>" +
      STRATEGIES.map((s) => '<option value="' + esc(s.strategy_id) + '"' + (STATE.screenerPreset === s.strategy_id ? " selected" : "") + ">" + esc(s.name) + "</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="scr-search">Search Ticker / Name</label><input id="scr-search" type="search" placeholder="e.g. NVDA, Microsoft" value="' + esc(STATE.screenerQuery) + '" /></div>' +
      '<div class="control-group"><label for="scr-opm">Min Op Margin %</label><input id="scr-opm" type="number" step="1" placeholder="e.g. 20" value="' + esc(STATE.screenerMinOpMargin) + '" style="width:120px" /></div>' +
      '<div class="control-group"><label for="scr-score">Min Score</label><input id="scr-score" type="number" step="5" placeholder="e.g. 70" value="' + esc(STATE.screenerMinScore) + '" style="width:110px" /></div>' +
      '<button class="btn" id="scr-pos-fcf" aria-pressed="' + (STATE.screenerPosFcf ? "true" : "false") + '">Positive FCF</button>' +
      '<button class="btn" id="scr-net-cash" aria-pressed="' + (STATE.screenerNetCash ? "true" : "false") + '">Net Cash Only</button>' +
      '<button class="btn" id="scr-reset">Reset</button>' +
      "</div>" +
      (activeStrat ? '<div class="notice notice-blue" style="margin-bottom:12px"><strong>' + esc(activeStrat.name) + ":</strong> " + esc(activeStrat.description) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr>' +
      '<th><button class="sort-btn" data-sort="ticker">Ticker' + arrow("ticker") + "</button></th>" +
      "<th>Company</th>" +
      '<th class="num"><button class="sort-btn" data-sort="score">Score' + arrow("score") + "</button></th>" +
      '<th class="num"><button class="sort-btn" data-sort="revenue">TTM Revenue' + arrow("revenue") + "</button></th>" +
      '<th class="num"><button class="sort-btn" data-sort="op_margin">Op Margin' + arrow("op_margin") + "</button></th>" +
      '<th class="num"><button class="sort-btn" data-sort="fcf">TTM FCF' + arrow("fcf") + "</button></th>" +
      '<th class="num"><button class="sort-btn" data-sort="net_debt">Net Debt' + arrow("net_debt") + "</button></th>" +
      "<th>Filing</th><th>Detail</th>" +
      "</tr></thead><tbody>" +
      (rows.length ? rows.map((c) => {
        const hp = headlinePeriod(c) || { metrics: {}, ratios: {} };
        const fcfVal = num(hp.metrics.free_cash_flow && hp.metrics.free_cash_flow.val);
        return (
          "<tr>" +
          '<td class="mono"><strong>' + esc(c.ticker) + "</strong></td>" +
          "<td>" + esc(c.name) + "</td>" +
          '<td class="num">' + esc(c.research_score.total_score) + "</td>" +
          '<td class="num">' + esc(hp.metrics.revenue ? hp.metrics.revenue.display : "—") + "</td>" +
          '<td class="num">' + esc(fmtPct(hp.ratios && hp.ratios.operating_margin_pct)) + "</td>" +
          '<td class="num' + (fcfVal !== null && fcfVal < 0 ? " neg" : "") + '">' + esc(hp.metrics.free_cash_flow ? hp.metrics.free_cash_flow.display : "—") + "</td>" +
          '<td class="num">' + esc(hp.metrics.net_debt ? hp.metrics.net_debt.display : "—") + "</td>" +
          '<td class="mono muted">' + esc(c.reporting_context.latest_filing_date) + "</td>" +
          '<td><button class="btn btn-sm" data-inspect="' + esc(c.ticker) + '">Inspect</button></td>' +
          "</tr>"
        );
      }).join("") : '<tr><td colspan="9" class="muted">No operating companies match the active screening criteria.</td></tr>') +
      "</tbody></table></div>" +
      '<p class="muted" style="margin:10px 0 0;font-size:12.5px">Excluded from operating screen: <strong>SPY</strong> (<code>etf_or_fund</code> — non-corporate trust). Screening rules are descriptive accounting filters only.</p>' +
      "</div>" +

      '<div class="card">' +
      "<h3>Interactive Peer Comparison (" + selectedPeers.length + " selected)</h3>" +
      '<p class="card-sub">Toggle companies below to compare TTM GAAP fundamentals side by side with automatic fiscal-calendar offset detection (&gt; 45 days).</p>' +
      '<div class="peer-picker">' +
      COMPANIES.map((c) => {
        const checked = STATE.peerTickers.includes(c.ticker) ? " checked" : "";
        return '<label class="peer-toggle"><input type="checkbox" data-peer="' + esc(c.ticker) + '"' + checked + " />" + esc(c.ticker) + "</label>";
      }).join("") +
      "</div>" +
      (peerWarnings.length ? '<div class="notice notice-amber"><strong>Cohort Alignment Notices:</strong><ul style="margin:6px 0 0;padding-left:18px">' + peerWarnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul></div>" : "") +
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Ticker</th><th>Period End</th><th class=\"num\">Revenue</th><th class=\"num\">Gross %</th><th class=\"num\">Op %</th><th class=\"num\">FCF Margin %</th><th class=\"num\">FCF / NI %</th><th class=\"num\">Debt / Eq</th><th class=\"num\">Score</th>" +
      "</tr></thead><tbody>" +
      selectedPeers.map((c) => {
        if (c.availability_status !== "ready") {
          return '<tr><td class="mono"><strong>' + esc(c.ticker) + '</strong></td><td colspan="8" class="muted">ETF / Fund entity — corporate GAAP ratios not applicable (non-imputed).</td></tr>';
        }
        const hp = headlinePeriod(c) || { metrics: {}, ratios: {} };
        return (
          "<tr>" +
          '<td class="mono"><strong>' + esc(c.ticker) + "</strong></td>" +
          '<td class="mono muted">' + esc(c.reporting_context.headline_period_end) + "</td>" +
          '<td class="num">' + esc(hp.metrics.revenue ? hp.metrics.revenue.display : "—") + "</td>" +
          '<td class="num">' + esc(fmtPct(hp.ratios && hp.ratios.gross_margin_pct)) + "</td>" +
          '<td class="num">' + esc(fmtPct(hp.ratios && hp.ratios.operating_margin_pct)) + "</td>" +
          '<td class="num">' + esc(fmtPct(hp.ratios && hp.ratios.fcf_margin_pct)) + "</td>" +
          '<td class="num">' + esc(fmtPct(hp.ratios && hp.ratios.fcf_conversion_pct)) + "</td>" +
          '<td class="num">' + esc(fmtRatio(hp.ratios && hp.ratios.debt_to_equity)) + "</td>" +
          '<td class="num">' + esc(c.research_score.total_score) + "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody></table></div></div>";

    document.getElementById("scr-preset").addEventListener("change", (ev) => { STATE.screenerPreset = ev.target.value; renderScreener(); });
    document.getElementById("scr-search").addEventListener("input", (ev) => { STATE.screenerQuery = ev.target.value; renderScreener(); });
    document.getElementById("scr-opm").addEventListener("input", (ev) => { STATE.screenerMinOpMargin = ev.target.value; renderScreener(); });
    document.getElementById("scr-score").addEventListener("input", (ev) => { STATE.screenerMinScore = ev.target.value; renderScreener(); });
    document.getElementById("scr-pos-fcf").addEventListener("click", () => { STATE.screenerPosFcf = !STATE.screenerPosFcf; renderScreener(); });
    document.getElementById("scr-net-cash").addEventListener("click", () => { STATE.screenerNetCash = !STATE.screenerNetCash; renderScreener(); });
    document.getElementById("scr-reset").addEventListener("click", () => {
      STATE.screenerPreset = "all"; STATE.screenerQuery = ""; STATE.screenerMinOpMargin = ""; STATE.screenerMinScore = ""; STATE.screenerPosFcf = false; STATE.screenerNetCash = false;
      renderScreener();
    });
    el.querySelectorAll("[data-sort]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.sort;
        if (STATE.screenerSortKey === k) STATE.screenerSortDir = STATE.screenerSortDir === "asc" ? "desc" : "asc";
        else { STATE.screenerSortKey = k; STATE.screenerSortDir = k === "ticker" ? "asc" : "desc"; }
        renderScreener();
      });
    });
    el.querySelectorAll("[data-inspect]").forEach((b) => b.addEventListener("click", () => inspectCompany(b.dataset.inspect)));
    el.querySelectorAll("[data-peer]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const t = cb.dataset.peer;
        if (cb.checked && !STATE.peerTickers.includes(t)) STATE.peerTickers.push(t);
        if (!cb.checked) STATE.peerTickers = STATE.peerTickers.filter((x) => x !== t);
        renderScreener();
      });
    });
  }

  // ---------- View 4: Accounting Score ----------
  function renderScore() {
    const el = document.getElementById("panel-score");
    const c = BY_TICKER[STATE.scoreTicker] || OPERATING[0];
    const rs = c.research_score || {};
    const compA = BY_TICKER[STATE.compareA] || OPERATING[0];
    const compB = BY_TICKER[STATE.compareB] || OPERATING[1];

    const breakdownHtml = (rs.total_score === null || rs.total_score === undefined || !(rs.components && rs.components.length))
      ? '<div class="notice notice-blue"><strong>' + esc(c.ticker) + " — " + esc(rs.band) + ":</strong> " + esc(rs.status_note || "Insufficient GAAP operating weight coverage (< 50%).") + "</div>"
      : '<div class="kpi-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px">' +
        '<div class="kpi-card"><div class="kpi-label">Composite Score</div><div class="kpi-value">' + esc(rs.total_score) + ' / 100</div><div class="kpi-detail">' + esc(rs.band) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Weight Coverage</div><div class="kpi-value">' + esc(rs.coverage_pct) + '%</div><div class="kpi-detail">' + esc(rs.observed_points) + " / " + esc(rs.evaluated_max_weight) + " evaluated pts</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Model Version</div><div class="kpi-value" style="font-size:15px">m2u3-accounting-v1</div><div class="kpi-detail">Rule-based GAAP heuristic · Non-advisory</div></div>' +
        "</div>" +
        (rs.components || []).map((comp) => {
          const pct = num(comp.component_pct) || 0;
          const crList = (comp.criteria || []).map((cr) =>
            "<li><strong>" + esc(cr.label) + ":</strong> <span class=\"mono\">" + esc(cr.earned_points) + "/" + esc(cr.max_points) + "</span> — " + esc(cr.explanation) + " <span class=\"muted\">(" + esc(cr.observed_input || "—") + ")</span></li>"
          ).join("");
          return (
            '<div class="score-row">' +
            '<div class="score-head"><strong>' + esc(comp.label) + '</strong><span class="mono">' + esc(comp.earned_points) + " / " + esc(comp.evaluated_max_weight) + " pts (" + esc(comp.component_pct) + "%)</span></div>" +
            '<div class="score-track"><div class="score-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>' +
            '<ul class="criteria-list">' + crList + "</ul>" +
            "</div>"
          );
        }).join("");

    // Two-company component delta table
    const mapA = Object.fromEntries(((compA.research_score && compA.research_score.components) || []).map((x) => [x.key, x]));
    const mapB = Object.fromEntries(((compB.research_score && compB.research_score.components) || []).map((x) => [x.key, x]));
    const methComps = (DATA.methodology && DATA.methodology.components) || [];
    const totalDelta = (num(compA.research_score.total_score) ?? 0) - (num(compB.research_score.total_score) ?? 0);

    const deltaRows = methComps.map((mc) => {
      const aPts = mapA[mc.key] ? num(mapA[mc.key].earned_points) : null;
      const bPts = mapB[mc.key] ? num(mapB[mc.key].earned_points) : null;
      const d = aPts !== null && bPts !== null ? aPts - bPts : null;
      const dStr = d === null ? "—" : (d > 0 ? "+" : "") + d.toFixed(1);
      const cls = d === null ? "" : (d > 0 ? " pos" : (d < 0 ? " neg" : ""));
      return (
        "<tr>" +
        "<td><strong>" + esc(mc.label) + "</strong> <span class=\"muted\">(/" + esc(mc.max_weight) + ")</span></td>" +
        '<td class="num">' + (aPts !== null ? aPts.toFixed(1) : "—") + "</td>" +
        '<td class="num">' + (bPts !== null ? bPts.toFixed(1) : "—") + "</td>" +
        '<td class="num' + cls + '">' + esc(dStr) + "</td>" +
        "</tr>"
      );
    }).join("");

    el.innerHTML =
      '<div class="section-head"><div><h2>Explainable Accounting Score (m2u3-accounting-score-v1)</h2>' +
      "<p>Transparent 7-component GAAP research heuristic — missing metrics drop out of the denominator rather than receiving fabricated scores.</p></div></div>" +

      '<div class="notice notice-amber"><strong>Non-Advisory Disclosure:</strong> Accounting scores summarize historical SEC GAAP disclosures only. They are <strong>not</strong> BUY/SELL/HOLD recommendations, valuation models, or predictors of future stock returns.</div>' +

      '<div class="card">' +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="score-ticker-sel">Inspect Entity</label><select id="score-ticker-sel">' +
      COMPANIES.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === c.ticker ? " selected" : "") + ">" + esc(x.ticker + " — " + x.name) + "</option>").join("") +
      "</select></div></div>" +
      breakdownHtml +
      "</div>" +

      '<div class="card">' +
      "<h3>Two-Company Component Delta Comparison</h3>" +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="cmp-a">Company A</label><select id="cmp-a">' +
      OPERATING.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === compA.ticker ? " selected" : "") + ">" + esc(x.ticker) + " (" + esc(x.research_score.total_score) + ")</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="cmp-b">Company B</label><select id="cmp-b">' +
      OPERATING.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === compB.ticker ? " selected" : "") + ">" + esc(x.ticker) + " (" + esc(x.research_score.total_score) + ")</option>").join("") +
      "</select></div>" +
      '<span class="meta-chip">Net Delta (' + esc(compA.ticker + " − " + compB.ticker) + '): <strong>' + (totalDelta > 0 ? "+" : "") + totalDelta.toFixed(1) + " pts</strong></span>" +
      "</div>" +
      '<div class="table-wrap"><table><thead><tr><th>Component</th><th class="num">' + esc(compA.ticker) + '</th><th class="num">' + esc(compB.ticker) + '</th><th class="num">Delta (A − B)</th></tr></thead><tbody>' +
      deltaRows +
      "</tbody></table></div></div>";

    document.getElementById("score-ticker-sel").addEventListener("change", (ev) => { STATE.scoreTicker = ev.target.value; renderScore(); });
    document.getElementById("cmp-a").addEventListener("change", (ev) => { STATE.compareA = ev.target.value; renderScore(); });
    document.getElementById("cmp-b").addEventListener("change", (ev) => { STATE.compareB = ev.target.value; renderScore(); });
  }

  // ---------- View 5: Risk Inspector ----------
  function renderRisks() {
    const el = document.getElementById("panel-risks");
    const categories = Array.from(new Set(RISKS.map((r) => r.category).filter(Boolean))).sort();
    const tickers = Array.from(new Set(RISKS.map((r) => r.ticker).filter(Boolean))).sort();
    const q = STATE.riskQuery.trim().toLowerCase();

    const filtered = RISKS.filter((r) => {
      if (STATE.riskSeverity !== "all" && (r.severity || "").toLowerCase() !== STATE.riskSeverity) return false;
      if (STATE.riskCategory !== "all" && r.category !== STATE.riskCategory) return false;
      if (STATE.riskTicker !== "all" && r.ticker !== STATE.riskTicker) return false;
      if (q && !(r.title.toLowerCase().includes(q) || r.explanation.toLowerCase().includes(q) || r.rule_id.toLowerCase().includes(q) || (r.ticker || "").toLowerCase().includes(q))) return false;
      return true;
    });

    el.innerHTML =
      '<div class="section-head"><div><h2>Rule-Based Risk Inspector (' + filtered.length + " / " + RISKS.length + " findings)</h2>" +
      "<p>Deterministic, filing-backed GAAP &amp; macro rules with explicit verification instructions and rule limitations.</p></div></div>" +

      '<div class="notice notice-blue"><strong>Bounded Rule Caveat:</strong> These 21 automated rules evaluate specific historical GAAP accounting thresholds and data-coverage checks only. Absence of a finding does <strong>not</strong> imply low investment risk, solvency, or valuation attractiveness.</div>' +

      '<div class="card"><div class="controls-bar">' +
      '<div class="control-group"><label for="rk-sev">Severity</label><select id="rk-sev">' +
      ["all", "high", "medium", "low", "info"].map((s) => '<option value="' + s + '"' + (STATE.riskSeverity === s ? " selected" : "") + ">" + s.toUpperCase() + "</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="rk-cat">Category</label><select id="rk-cat"><option value="all">ALL</option>' +
      categories.map((cat) => '<option value="' + esc(cat) + '"' + (STATE.riskCategory === cat ? " selected" : "") + ">" + esc(cat) + "</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="rk-tkr">Ticker</label><select id="rk-tkr"><option value="all">ALL</option>' +
      tickers.map((t) => '<option value="' + esc(t) + '"' + (STATE.riskTicker === t ? " selected" : "") + ">" + esc(t) + "</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="rk-q">Search</label><input id="rk-q" type="search" placeholder="rule, ticker, text..." value="' + esc(STATE.riskQuery) + '" /></div>' +
      '<button class="btn" id="rk-reset">Reset</button>' +
      "</div>" +

      (filtered.length ? filtered.map((r) => {
        const secHref = safeSecUrl(r.sec_url);
        return (
          '<div class="risk-card">' +
          '<div class="risk-card-head">' +
          '<div><span class="pill ' + sevClass(r.severity) + '">' + esc((r.severity || "info").toUpperCase()) + '</span> <strong class="mono">' + esc(r.ticker) + "</strong> · <strong>" + esc(r.title) + "</strong></div>" +
          '<span class="mono muted">' + esc(r.rule_id) + " · " + esc(r.category) + "</span>" +
          "</div>" +
          '<p style="margin:0">' + esc(r.explanation) + "</p>" +
          '<div class="risk-meta-grid">' +
          "<div><strong>What Rule Measures</strong>" + esc(r.rule_measures) + "</div>" +
          "<div><strong>Rule Limitations &amp; Caveats</strong>" + esc(r.limitations) + "</div>" +
          "<div><strong>How to Verify</strong>" + esc(r.how_to_verify) + "</div>" +
          "<div><strong>Reporting Period &amp; Citation</strong>" + esc((r.reporting_periods || []).join("; ")) + (secHref ? ' · <a href="' + esc(secHref) + '" target="_blank" rel="noopener noreferrer">SEC Filing ↗</a>' : "") + "</div>" +
          "</div></div>"
        );
      }).join("") : '<p class="muted">No risk findings match the selected filters.</p>') +
      "</div>";

    document.getElementById("rk-sev").addEventListener("change", (ev) => { STATE.riskSeverity = ev.target.value; renderRisks(); });
    document.getElementById("rk-cat").addEventListener("change", (ev) => { STATE.riskCategory = ev.target.value; renderRisks(); });
    document.getElementById("rk-tkr").addEventListener("change", (ev) => { STATE.riskTicker = ev.target.value; renderRisks(); });
    document.getElementById("rk-q").addEventListener("input", (ev) => { STATE.riskQuery = ev.target.value; renderRisks(); });
    document.getElementById("rk-reset").addEventListener("click", () => {
      STATE.riskSeverity = "all"; STATE.riskCategory = "all"; STATE.riskTicker = "all"; STATE.riskQuery = "";
      renderRisks();
    });
  }

  // ---------- View 6: Treasury Macro ----------
  function renderTreasury() {
    const el = document.getElementById("panel-treasury");
    const history = TREASURY.history || [];
    const idx = Math.max(0, Math.min(history.length - 1, STATE.treasuryIdx));
    const cur = history[idx] || TREASURY.latest || {};
    const d1m = (TREASURY.deltas && TREASURY.deltas["1M"]) || {};
    const d1y = (TREASURY.deltas && TREASURY.deltas["1Y"]) || {};

    el.innerHTML =
      '<div class="section-head"><div><h2>U.S. Treasury Macro Yield Curve</h2>' +
      "<p>Historical Daily Treasury Par Yield Curve Rates (U.S. Department of the Treasury public-domain dataset; snapshot ends " + esc(TREASURY.latest.rate_date) + ").</p></div></div>" +

      '<div class="kpi-grid">' +
      '<div class="kpi-card"><div class="kpi-label">Selected Date (' + esc(cur.rate_date) + ') — 10Y</div><div class="kpi-value">' + esc(cur.y10) + '%</div><div class="kpi-detail">Latest 1M Δ: ' + esc(d1m.y10_bps) + " bps · 1Y Δ: +" + esc(d1y.y10_bps) + " bps</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">2Y Treasury Yield</div><div class="kpi-value">' + esc(cur.y2) + '%</div><div class="kpi-detail">3M Bill: ' + esc(cur.m3) + "% · 30Y Bond: " + esc(cur.y30) + "%</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">10Y − 2Y Spread</div><div class="kpi-value">' + esc(cur.spread_10y_2y) + '%</div><div class="kpi-detail">' + (num(cur.spread_10y_2y) < 0 ? "Inverted curve (< 0%)" : "Positive slope (>= 0%)") + "</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">10Y − 3M Spread</div><div class="kpi-value">' + esc(cur.spread_10y_3m) + '%</div><div class="kpi-detail">' + esc(TREASURY.regime_note) + "</div></div>" +
      "</div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Full 13-Tenor Par Yield Curve (' + esc(TREASURY.latest.rate_date) + ")</h3>" +
      '<p class="card-sub">Units: annualized percentage yield (%). Exact <code>Decimal</code> parsing from Treasury CSV.</p>' +
      renderTreasuryCurveSvg(TREASURY.curve_points) + "</div>" +

      '<div class="card"><h3>260-Day Historical Yield Trajectory (' + esc(history[0].rate_date) + " → " + esc(history[history.length - 1].rate_date) + ")</h3>" +
      '<div class="controls-bar" style="margin-bottom:10px">' +
      '<label for="tr-slider" style="font-size:12px;color:var(--muted)">Inspect Date:</label>' +
      '<input id="tr-slider" type="range" min="0" max="' + (history.length - 1) + '" value="' + idx + '" style="flex:1;min-width:150px" />' +
      '<button class="btn btn-sm" data-tr-jump="0">Earliest</button>' +
      '<button class="btn btn-sm" data-tr-jump="' + Math.floor(history.length / 2) + '">Midpoint</button>' +
      '<button class="btn btn-sm" data-tr-jump="' + (history.length - 1) + '">Latest</button>' +
      "</div>" +
      renderTreasuryHistorySvg(history, idx) + "</div>" +
      "</div>" +

      '<div class="card"><h3>Curve Tenor &amp; Spread Table (' + esc(TREASURY.latest.rate_date) + ")</h3>" +
      '<div class="table-wrap"><table><thead><tr>' +
      (TREASURY.curve_points || []).map((c) => '<th class="num">' + esc(c.label) + "</th>").join("") +
      "</tr></thead><tbody><tr>" +
      (TREASURY.curve_points || []).map((c) => '<td class="num">' + esc(c.rate_pct) + "%</td>").join("") +
      "</tr></tbody></table></div>" +
      '<p class="muted" style="margin:10px 0 0;font-size:12.5px">Source: U.S. Department of the Treasury (<code>home.treasury.gov</code>, public-domain historical series; <code>465</code> total acquired dates from <code>' + esc(TREASURY.earliest_date) + "</code>).</p></div>";

    document.getElementById("tr-slider").addEventListener("input", (ev) => { STATE.treasuryIdx = Number(ev.target.value); renderTreasury(); });
    el.querySelectorAll("[data-tr-jump]").forEach((b) => b.addEventListener("click", () => { STATE.treasuryIdx = Number(b.dataset.trJump); renderTreasury(); }));
  }

  // ---------- View 7: Synthetic M1 Revision Replay ----------
  function renderReplay() {
    const el = document.getElementById("panel-replay");
    const isAsOf = STATE.replayMode === "as_of";
    const rep = isAsOf ? M1.as_of : M1.latest;
    const signals = rep.signals || [];

    const histRows = (rep.history || []).flatMap((h) =>
      (h.revisions || []).map((rv) => (
        "<tr>" +
        '<td class="mono">' + esc(h.start) + "</td>" +
        '<td class="mono">r' + esc(rv.revision) + "</td>" +
        '<td class="num">' + esc(rv.open) + " / " + esc(rv.high) + " / " + esc(rv.low) + " / " + esc(rv.close) + "</td>" +
        '<td class="mono">' + esc(rv.known_at) + "</td>" +
        '<td class="mono muted">' + esc((rv.payload_id || "").slice(0, 14)) + "…</td>" +
        "<td>" + (rv.revision > 1 ? '<span class="pill pill-derived">LATE CORRECTION</span>' : '<span class="pill pill-synth">INITIAL</span>') + "</td>" +
        "</tr>"
      ))
    ).join("");

    el.innerHTML =
      '<div class="section-head"><div><h2>Synthetic M1 Revision &amp; As-Of Replay</h2>' +
      "<p>100% fabricated offline fixture (<code>fixtures/m1_revisions.json</code>) demonstrating deterministic anti-lookahead evaluation.</p></div></div>" +

      '<div class="notice notice-red"><strong>SYNTHETIC ENGINEERING PROOF ONLY:</strong> All OHLCV prices below are fabricated integers (<code>fixture:TEST</code>). This deterministic 3-bar breakout rule (<code>close[t] &gt; max(high[t-3..t-1])</code>) is <strong>not</strong> a validated or profitable trading strategy, uses zero real exchange quotes, and generates zero orders.</div>' +

      '<div class="card">' +
      '<div class="controls-bar">' +
      '<button class="btn" id="rep-asof" aria-pressed="' + (isAsOf ? "true" : "false") + '">As-Of Snapshot (' + esc(M1.as_of_cutoff) + ')</button>' +
      '<button class="btn" id="rep-latest" aria-pressed="' + (!isAsOf ? "true" : "false") + '">Latest Retrospective View</button>' +
      '<span class="meta-chip">Breakout Events: <strong>' + signals.length + "</strong></span>" +
      '<span class="meta-chip">Duplicates Ignored: <strong>' + (rep.duplicates || []).length + "</strong></span>" +
      '<span class="meta-chip">Calendar: <strong>' + esc(rep.calendar && rep.calendar.id) + "</strong></span>" +
      "</div>" +

      (signals.length
        ? '<div class="notice notice-blue"><strong>As-Of Result (' + esc(M1.as_of_cutoff) + '):</strong> At <code>14:34:02Z</code>, the delayed correction to bar <code>14:32Z</code> (arriving at <code>14:35:00Z</code>) was not yet known. Prior 3-bar max high was <strong>12</strong>, so close <strong>13 &gt; 12</strong> emitted <strong>1 deterministic breakout event</strong> (<code>logical_id: ' + esc(signals[0].logical_id.slice(0, 16)) + "…</code>).</div>"
        : '<div class="notice notice-amber"><strong>Latest Retrospective Result:</strong> Revision <code>r2</code> of bar <code>14:32Z</code> arrived at <code>14:35:00Z</code>, revising its high from <code>12 → 15</code>. Under the latest view, close <code>13</code> no longer exceeds prior max high <code>15</code>, so <strong>0 breakouts</strong> qualify — while all revisions remain preserved in the audit ledger.</div>') +

      renderM1BarsSvg(rep) +
      "</div>" +

      '<div class="card"><h3>Full Immutable Revision Audit Ledger (Both Modes Preserve Complete History)</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Bar Start (UTC)</th><th>Revision</th><th class="num">O / H / L / C</th><th>Known At (UTC)</th><th>Payload Hash</th><th>Type</th></tr></thead><tbody>' +
      histRows +
      "</tbody></table></div></div>";

    document.getElementById("rep-asof").addEventListener("click", () => { STATE.replayMode = "as_of"; renderReplay(); });
    document.getElementById("rep-latest").addEventListener("click", () => { STATE.replayMode = "latest"; renderReplay(); });
  }

  // ---------- View 8: Architecture & Evidence ----------
  function renderArchitecture() {
    const el = document.getElementById("panel-architecture");
    el.innerHTML =
      '<div class="section-head"><div><h2>Architecture, Verification Evidence &amp; Frozen Boundaries</h2>' +
      "<p>High-level system design of the private Python stdlib workstation and the sanitized static showcase boundary.</p></div></div>" +

      '<div class="card"><h3>System Architecture (Original Vector Diagram)</h3>' +
      '<div class="chart-box">' +
      '<svg viewBox="0 0 920 260" role="img" aria-label="Trading Edge Terminal architecture showing Private M0/M1 Engine, Private M2 SEC/Treasury Research Workstation, and Sanitized Public Static Showcase Boundary">' +
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#5b9cf6" /></marker></defs>' +
      '<rect x="16" y="20" width="260" height="96" rx="8" fill="#151f30" stroke="#5b9cf6" stroke-width="1.5" />' +
      '<text x="30" y="45" fill="#e7edf5" font-size="13" font-weight="700">Public Federal Data Sources</text>' +
      '<text x="30" y="66" fill="#93a4bc" font-size="11.5">• SEC EDGAR XBRL &amp; Submissions</text>' +
      '<text x="30" y="84" fill="#93a4bc" font-size="11.5">• U.S. Treasury Par Yield CSVs</text>' +
      '<text x="30" y="102" fill="#6e819c" font-size="10.5">Rate-limited &lt;= 4 req/s · SHA-256 Cache</text>' +

      '<rect x="16" y="140" width="260" height="96" rx="8" fill="#151f30" stroke="#a78bfa" stroke-width="1.5" />' +
      '<text x="30" y="165" fill="#e7edf5" font-size="13" font-weight="700">M0 / M1 Synthetic Replay Engine</text>' +
      '<text x="30" y="186" fill="#93a4bc" font-size="11.5">• Decimal OHLCV &amp; NYSE 2026-27 RTH</text>' +
      '<text x="30" y="204" fill="#93a4bc" font-size="11.5">• Append-only Revision / As-Of Ledger</text>' +
      '<text x="30" y="222" fill="#6e819c" font-size="10.5">100% Synthetic · Unit 3B Feeds NO-GO</text>' +

      '<rect x="330" y="42" width="260" height="172" rx="8" fill="#151f30" stroke="#d9a441" stroke-width="1.6" />' +
      '<text x="344" y="68" fill="#d9a441" font-size="13" font-weight="700">Private Workstation (FROZEN)</text>' +
      '<text x="344" y="90" fill="#e7edf5" font-size="11.5">Python 3.9+ Stdlib Only ($0 Deps)</text>' +
      '<text x="344" y="110" fill="#93a4bc" font-size="11.5">• SQLite research-v3 (Decimal TEXT)</text>' +
      '<text x="344" y="128" fill="#93a4bc" font-size="11.5">• TTM/FY Normalization &amp; 21 Risk Rules</text>' +
      '<text x="344" y="146" fill="#93a4bc" font-size="11.5">• Screener, Explainable Score &amp; Alerts</text>' +
      '<text x="344" y="164" fill="#93a4bc" font-size="11.5">• 127.0.0.1 Loopback Server + CSRF</text>' +
      '<text x="344" y="192" fill="#34c77b" font-size="11">Verified: 250 / 250 Offline Tests PASS</text>' +

      '<rect x="644" y="42" width="260" height="172" rx="8" fill="#101722" stroke="#34c77b" stroke-width="1.6" stroke-dasharray="5 3" />' +
      '<text x="658" y="68" fill="#34c77b" font-size="13" font-weight="700">Sanitized Static Showcase (This Site)</text>' +
      '<text x="658" y="90" fill="#e7edf5" font-size="11.5">Zero Backend · Zero Live Calls</text>' +
      '<text x="658" y="110" fill="#93a4bc" font-size="11.5">• Dated 2026-11-12 SEC/Treasury JSON</text>' +
      '<text x="658" y="128" fill="#93a4bc" font-size="11.5">• Exact M1 Synthetic Replay Outputs</text>' +
      '<text x="658" y="146" fill="#93a4bc" font-size="11.5">• Zero Local Paths / Zero Private Source</text>' +
      '<text x="658" y="164" fill="#93a4bc" font-size="11.5">• Zero Brokerage / Zero Paid Infra ($0)</text>' +
      '<text x="658" y="192" fill="#d9a441" font-size="11">Independent Parity Checks Verified</text>' +

      '<line x1="276" y1="68" x2="328" y2="95" stroke="#5b9cf6" stroke-width="1.8" marker-end="url(#arr)" />' +
      '<line x1="276" y1="188" x2="328" y2="160" stroke="#5b9cf6" stroke-width="1.8" marker-end="url(#arr)" />' +
      '<line x1="590" y1="128" x2="642" y2="128" stroke="#5b9cf6" stroke-width="1.8" marker-end="url(#arr)" />' +
      "</svg></div></div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Verification Evidence Ledger</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Verification Layer</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      '<tr><td>Private Python Suite</td><td>224 M0/M1 + 26 M2 stdlib tests (offline)</td><td><span class="pill pill-low">250/250 PASS</span></td></tr>' +
      '<tr><td>Static Showcase Parity</td><td>18 entities, 22 risks, 260 Treasury dates, M1 replay</td><td><span class="pill pill-low">VERIFIED</span></td></tr>' +
      '<tr><td>Privacy &amp; License Gate</td><td>Zero local paths, zero emails, zero third-party feeds, public-domain snapshot</td><td><span class="pill pill-low">CLEAN</span></td></tr>' +
      '<tr><td>Live Stock Feeds &amp; Orders</td><td>Brokerage execution, live quotes, trading edge profitability</td><td><span class="pill pill-high">NOT IMPLEMENTED</span></td></tr>' +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Explicit Frozen Limitations</h3>' +
      '<ul class="criteria-list" style="font-size:13.5px;color:var(--fg)">' +
      "<li><strong>Frozen Historical Milestone:</strong> Active development is permanently discontinued; snapshot data dated <code>2026-11-12</code> will not auto-refresh.</li>" +
      "<li><strong>No Stock Prices or Valuations:</strong> Tracks SEC GAAP filings and U.S. Treasury rates only — zero stock quotes, P/E multiples, or total-return backtests.</li>" +
      "<li><strong>Non-Advisory Posture:</strong> Accounting scores, screening presets, and risk findings are deterministic research heuristics, never investment advice.</li>" +
      "<li><strong>Synthetic Breakout Proof:</strong> M1 replay uses fabricated numbers and does not claim a profitable trading strategy.</li>" +
      "</ul></div></div>";
  }

  function renderActiveTab() {
    if (STATE.tab === "overview") renderOverview();
    else if (STATE.tab === "company") renderCompany();
    else if (STATE.tab === "screener") renderScreener();
    else if (STATE.tab === "score") renderScore();
    else if (STATE.tab === "risks") renderRisks();
    else if (STATE.tab === "treasury") renderTreasury();
    else if (STATE.tab === "replay") renderReplay();
    else if (STATE.tab === "architecture") renderArchitecture();
  }

  renderHeaderMeta();
  setupTabs();
  renderOverview();
})();
