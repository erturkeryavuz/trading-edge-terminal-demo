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
    overviewTicker: "AAPL",
    selectedTicker: "AAPL",
    statementPeriod: "TTM",
    screenerPreset: "all",
    screenerPeriodMode: "TTM",
    screenerQuery: "",
    screenerMinOpMargin: "",
    screenerMinScore: "",
    screenerPosFcf: false,
    screenerNetCash: false,
    screenerSortKey: "score",
    screenerSortDir: "desc",
    peerTickers: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "SPY"],
    evalSubView: "score",
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

  function cloneState() {
    return {
      ...STATE,
      peerTickers: STATE.peerTickers.slice(),
    };
  }

  function restoreState(snap) {
    if (!snap) return;
    Object.keys(STATE).forEach((k) => {
      if (k === "peerTickers") STATE.peerTickers = (snap.peerTickers || []).slice();
      else if (k in snap) STATE[k] = snap[k];
    });
  }

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

  function fmtSignedBps(valStr) {
    const n = num(valStr);
    if (n === null) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(0) + " bps";
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

  function headlinePeriod(company, periodMode) {
    if (!company) return null;
    if (periodMode === "FY") {
      const aps = company.annual_periods || [];
      return aps.length ? aps[aps.length - 1] : null;
    }
    if (company.ttm) return company.ttm;
    const aps = company.annual_periods || [];
    return aps.length ? aps[aps.length - 1] : null;
  }

  function operatingMarginDeltaPp(company) {
    const aps = (company && company.annual_periods) || [];
    if (aps.length < 2) return null;
    const cur = num(aps[aps.length - 1].ratios && aps[aps.length - 1].ratios.operating_margin_pct);
    const prev = num(aps[aps.length - 2].ratios && aps[aps.length - 2].ratios.operating_margin_pct);
    if (cur === null || prev === null) return null;
    return cur - prev;
  }

  // ---------- Tab Navigation ----------
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

  function openEvaluation(subView, ticker) {
    STATE.evalSubView = subView === "risks" ? "risks" : "score";
    if (ticker && BY_TICKER[ticker]) {
      if (STATE.evalSubView === "score") STATE.scoreTicker = ticker;
      else STATE.riskTicker = ticker;
    }
    switchTab("evaluation");
  }

  function setupTabs() {
    const tablist = document.getElementById("main-tablist");
    if (!tablist) return;
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

  // ---------- Data-Grounded SVG Charts (Portfolio V3 Palette) ----------
  function renderFlowBarsSvg(company) {
    const periods = (company.annual_periods || []).slice(-5);
    if (!periods.length) return '<p class="muted">No annual flow history available.</p>';
    const W = 620, H = 224, padL = 56, padR = 16, padT = 18, padB = 32;
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
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">$' + gv.toFixed(0) + "B</text>";
    }
    grid += '<line x1="' + padL + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + zeroY.toFixed(1) + '" stroke="#474E5B" stroke-width="1.2" />';

    const colors = { revenue: "#758D92", net_income: "#B49A78", free_cash_flow: "#4E9F76" };
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
        const fill = k === "free_cash_flow" && v < 0 ? "#C95B5B" : colors[k];
        bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + fill + '"><title>' + esc(p.period_label + " " + k + ": " + fmtBillions(raw)) + "</title></rect>";
      });
      bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="#A4ABB6" font-size="11" text-anchor="middle" font-family="monospace">' + esc(p.period_label) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Annual Revenue, Net Income, and Free Cash Flow for ' + esc(company.ticker) + '">' +
      grid + bars +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="legend-dot" style="background:#758D92"></i>Revenue</span>' +
      '<span><i class="legend-dot" style="background:#B49A78"></i>Net Income</span>' +
      '<span><i class="legend-dot" style="background:#4E9F76"></i>Free Cash Flow (crimson if negative)</span>' +
      "</div></div>"
    );
  }

  function renderMarginLinesSvg(company) {
    const periods = (company.annual_periods || []).slice(-5);
    if (!periods.length) return '<p class="muted">No margin history available.</p>';
    const W = 620, H = 224, padL = 52, padR = 30, padT = 18, padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const seriesKeys = [
      { key: "gross_margin_pct", label: "Gross Margin", color: "#758D92" },
      { key: "operating_margin_pct", label: "Operating Margin", color: "#B49A78" },
      { key: "fcf_margin_pct", label: "FCF Margin", color: "#4E9F76" },
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
    const xOf = (i) => (periods.length === 1 ? padL + plotW / 2 : padL + (i / (periods.length - 1)) * plotW);

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(0) + "%</text>";
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
      xLabels += '<text x="' + xOf(idx).toFixed(1) + '" y="' + (H - 10) + '" fill="#A4ABB6" font-size="11" text-anchor="middle" font-family="monospace">' + esc(p.period_label) + "</text>";
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

  function renderTreasuryCurveSvg(curvePoints, compact) {
    if (!curvePoints || !curvePoints.length) return "";
    const W = compact ? 380 : 680;
    const H = compact ? 150 : 244;
    const padL = compact ? 42 : 52;
    const padR = compact ? 14 : 20;
    const padT = compact ? 14 : 20;
    const padB = compact ? 26 : 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const vals = curvePoints.map((c) => num(c.rate_pct)).filter((v) => v !== null);
    const minV = Math.floor((Math.min(...vals) - 0.3) * 2) / 2;
    const maxV = Math.ceil((Math.max(...vals) + 0.3) * 2) / 2;
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const xOf = (i) => padL + (i / (curvePoints.length - 1)) * plotW;

    let grid = "";
    const steps = compact ? 3 : 4;
    for (let i = 0; i <= steps; i++) {
      const gv = minV + (range * i) / steps;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#8E96A3" font-size="10" text-anchor="end" font-family="monospace">' + gv.toFixed(2) + "%</text>";
    }

    const pts = curvePoints.map((c, i) => ({ x: xOf(i), y: yOf(num(c.rate_pct)), lbl: c.label, v: num(c.rate_pct) }));
    const lineD = pts.map((pt, i) => (i === 0 ? "M" : "L") + pt.x.toFixed(1) + "," + pt.y.toFixed(1)).join(" ");
    const areaD = lineD + " L" + pts[pts.length - 1].x.toFixed(1) + "," + (H - padB) + " L" + pts[0].x.toFixed(1) + "," + (H - padB) + " Z";
    let dots = "";
    pts.forEach((pt, idx) => {
      dots += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="' + (compact ? "3" : "4") + '" fill="#B49A78" stroke="#101113" stroke-width="1.4"><title>' + esc(pt.lbl + ": " + pt.v.toFixed(2) + "%") + "</title></circle>";
      if (!compact || idx === 0 || idx === 2 || idx === 6 || idx === 10 || idx === pts.length - 1) {
        dots += '<text x="' + pt.x.toFixed(1) + '" y="' + (H - 8) + '" fill="#A4ABB6" font-size="10" text-anchor="middle" font-family="monospace">' + esc(pt.lbl) + "</text>";
      }
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="U.S. Treasury Daily Par Yield Curve on ' + esc(TREASURY.latest && TREASURY.latest.rate_date) + '">' +
      grid +
      '<path d="' + areaD + '" fill="rgba(180,154,120,0.13)" />' +
      '<path d="' + lineD + '" fill="none" stroke="#B49A78" stroke-width="2.3" />' +
      dots +
      "</svg></div>"
    );
  }

  function renderTreasuryHistorySvg(history, activeIdx) {
    if (!history || !history.length) return "";
    const W = 680, H = 244, padL = 52, padR = 20, padT = 18, padB = 34;
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
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(2) + "%</text>";
    }

    const lines = [
      { key: "y10", label: "10Y", color: "#B49A78" },
      { key: "y2", label: "2Y", color: "#758D92" },
      { key: "m3", label: "3M", color: "#4E9F76" },
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
    const marker = '<line x1="' + cx.toFixed(1) + '" y1="' + padT + '" x2="' + cx.toFixed(1) + '" y2="' + (H - padB) + '" stroke="#F1EDE5" stroke-width="1.2" stroke-dasharray="3 3" />';
    const labelIdx = [0, Math.floor(history.length / 3), Math.floor((2 * history.length) / 3), history.length - 1];
    let xTicks = "";
    labelIdx.forEach((i, pos) => {
      const anchor = pos === 0 ? "start" : (pos === labelIdx.length - 1 ? "end" : "middle");
      xTicks += '<text x="' + xOf(i).toFixed(1) + '" y="' + (H - 10) + '" fill="#A4ABB6" font-size="10.5" text-anchor="' + anchor + '" font-family="monospace">' + esc(history[i].rate_date) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Historical U.S. Treasury 10Y, 2Y, and 3M Rates from ' + esc(history[0].rate_date) + " to " + esc(history[history.length - 1].rate_date) + '">' +
      grid + paths + marker + xTicks +
      "</svg>" +
      '<div class="chart-legend">' +
      lines.map((s) => '<span><i class="legend-dot" style="background:' + s.color + '"></i>' + s.label + " (" + esc(activeRow[s.key]) + "%)</span>").join("") +
      '<span class="muted">Selected: <strong class="mono">' + esc(activeRow.rate_date) + "</strong></span>" +
      "</div></div>"
    );
  }

  function renderM1BarsSvg(replay) {
    const bars = replay.selected || [];
    const signals = replay.signals || [];
    const priorHighs = bars.slice(0, 3).map((b) => num(b.high)).filter((v) => v !== null);
    const threshold = signals.length ? num(signals[0].threshold) : (priorHighs.length ? Math.max(...priorHighs) : 15);
    const narrow = typeof window !== "undefined" && window.innerWidth <= 520;
    const W = narrow ? 540 : 920;
    const H = narrow ? 230 : 220;
    const padL = narrow ? 36 : 48;
    const padR = narrow ? 14 : 24;
    const padT = 22;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const minP = 7, maxP = 16.5;
    const yOf = (v) => padT + ((maxP - v) / (maxP - minP)) * plotH;
    const slotW = plotW / Math.max(1, bars.length);

    let grid = "";
    for (let p = 8; p <= 16; p += 2) {
      const y = yOf(p);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 7) + '" y="' + (y + 4).toFixed(1) + '" fill="#8E96A3" font-size="' + (narrow ? "12" : "11") + '" text-anchor="end" font-family="monospace">' + p.toFixed(0) + "</text>";
    }

    const thY = yOf(threshold);
    const thColor = signals.length ? "#4E9F76" : "#C95B5B";
    const thLabel = narrow ? "Max prior high = " + threshold : "Prior 3-bar max high = " + threshold;
    let svgBody =
      '<line x1="' + padL + '" y1="' + thY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + thY.toFixed(1) + '" stroke="' + thColor + '" stroke-width="1.6" stroke-dasharray="5 4" />' +
      '<text x="' + (padL + 6) + '" y="' + (thY - 6).toFixed(1) + '" fill="' + thColor + '" font-size="' + (narrow ? "12.5" : "11.5") + '" text-anchor="start" font-family="monospace">' + thLabel + "</text>";

    bars.forEach((b, idx) => {
      const cx = padL + idx * slotW + slotW / 2;
      const hi = num(b.high), lo = num(b.low), op = num(b.open), cl = num(b.close);
      const isRevised = b.revision > 1;
      const isSignalBar = idx === 3 && signals.length > 0;
      const color = isSignalBar ? "#4E9F76" : (isRevised ? "#C99A49" : "#758D92");
      const topBody = yOf(Math.max(op, cl));
      const botBody = yOf(Math.min(op, cl));
      const bodyH = Math.max(4, botBody - topBody);
      const halfW = narrow ? 13 : 17;
      svgBody += '<line x1="' + cx.toFixed(1) + '" y1="' + yOf(hi).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + yOf(lo).toFixed(1) + '" stroke="' + color + '" stroke-width="2.2" />';
      svgBody += '<rect x="' + (cx - halfW).toFixed(1) + '" y="' + topBody.toFixed(1) + '" width="' + (halfW * 2) + '" height="' + bodyH.toFixed(1) + '" rx="3" fill="' + color + '" fill-opacity="0.28" stroke="' + color + '" stroke-width="1.8" />';
      const barLbl = narrow ? ("H:" + b.high + " C:" + b.close) : ("H:" + b.high + " C:" + b.close + " (r" + b.revision + ")");
      svgBody += '<text x="' + cx.toFixed(1) + '" y="' + (yOf(hi) - 6).toFixed(1) + '" fill="#F1EDE5" font-size="' + (narrow ? "11.5" : "10.5") + '" text-anchor="middle" font-family="monospace">' + esc(barLbl) + "</text>";
      const tShort = (b.start || "").slice(11, 16) + "Z";
      svgBody += '<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" fill="#A4ABB6" font-size="' + (narrow ? "12" : "11") + '" text-anchor="middle" font-family="monospace">' + esc(tShort) + "</text>";
    });

    return (
      '<div class="chart-box" id="replay-chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic 1-minute bar revision chart comparing Latest vs As-Of breakout evaluation">' +
      grid + svgBody +
      "</svg></div>"
    );
  }

  function renderSpotlightComboSvg(company) {
    const periods = (company && company.annual_periods || []).slice(-5);
    if (!periods.length) return "";
    const narrow = typeof window !== "undefined" && window.innerWidth <= 520;
    const W = narrow ? 440 : 640;
    const H = narrow ? 205 : 226;
    const padL = narrow ? 48 : 54;
    const padR = narrow ? 42 : 48;
    const padT = 26;
    const padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const revs = periods.map((p) => num(p.metrics && p.metrics.revenue && p.metrics.revenue.val)).map((v) => (v !== null ? v / 1e9 : 0));
    const opms = periods.map((p) => num(p.ratios && p.ratios.operating_margin_pct));
    const validOpms = opms.filter((v) => v !== null);
    const maxRev = Math.max(20, ...revs) * 1.24;
    const minOpm = Math.max(0, Math.floor((Math.min(...validOpms, 10) - 6) / 5) * 5);
    const maxOpm = Math.ceil((Math.max(...validOpms, 30) + 6) / 5) * 5;
    const opmRange = Math.max(5, maxOpm - minOpm);

    const yRev = (v) => padT + ((maxRev - v) / maxRev) * plotH;
    const yOpm = (v) => padT + ((maxOpm - v) / opmRange) * plotH;
    const slotW = plotW / periods.length;
    const barW = Math.min(48, slotW * 0.48);

    let grid = "";
    for (let i = 0; i <= 3; i++) {
      const rv = (maxRev * i) / 3;
      const ov = minOpm + (opmRange * i) / 3;
      const y = yRev(rv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">$' + Math.round(rv) + "B</text>";
      grid += '<text x="' + (W - padR + 8) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#B49A78" font-size="10.5" text-anchor="start" font-family="monospace">' + Math.round(ov) + "%</text>";
    }

    let bars = "";
    const linePts = [];
    periods.forEach((p, idx) => {
      const cx = padL + idx * slotW + slotW / 2;
      const rv = revs[idx];
      const by = yRev(rv);
      const bh = Math.max(3, (padT + plotH) - by);
      const isLast = idx === periods.length - 1;
      const fill = isLast ? "#B49A78" : "#758D92";
      const op = isLast ? "0.92" : "0.52";
      bars += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="4" fill="' + fill + '" fill-opacity="' + op + '"><title>' + esc(p.period_label + " Revenue: $" + rv.toFixed(1) + "B") + "</title></rect>";
      bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" fill="' + (isLast ? "#F1EDE5" : "#A4ABB6") + '" font-size="11" font-weight="' + (isLast ? "700" : "500") + '" text-anchor="middle" font-family="monospace">' + esc(p.period_label) + "</text>";
      if (opms[idx] !== null) {
        linePts.push({ x: cx, y: yOpm(opms[idx]), v: opms[idx], fy: p.period_label, isLast });
      }
    });

    let lineSvg = "";
    if (linePts.length > 1) {
      const d = linePts.map((pt, i) => (i === 0 ? "M" : "L") + pt.x.toFixed(1) + "," + pt.y.toFixed(1)).join(" ");
      lineSvg += '<path d="' + d + '" fill="none" stroke="#F1EDE5" stroke-width="2.4" stroke-linejoin="round" />';
    }
    linePts.forEach((pt) => {
      lineSvg += '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="' + (pt.isLast ? "4.8" : "3.6") + '" fill="' + (pt.isLast ? "#B49A78" : "#F1EDE5") + '" stroke="#17191D" stroke-width="1.8"><title>' + esc(pt.fy + " Operating Margin: " + pt.v.toFixed(1) + "%") + "</title></circle>";
      if (pt.isLast) {
        const lblY = Math.max(13, pt.y - 11);
        lineSvg += '<text x="' + pt.x.toFixed(1) + '" y="' + lblY.toFixed(1) + '" fill="#F1EDE5" stroke="#15181E" stroke-width="4" stroke-linejoin="round" paint-order="stroke" font-size="11" font-weight="700" text-anchor="middle" font-family="monospace">' + pt.v.toFixed(1) + "%</text>";
      }
    });

    return (
      '<div class="chart-box" id="ov-focal-chart">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Five-year annual revenue and operating margin trajectory for ' + esc(company.name) + '">' +
      grid + bars + lineSvg +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="legend-dot" style="background:#758D92"></i>Annual Revenue ($B)</span>' +
      '<span><i class="legend-dot" style="background:#B49A78"></i>Latest Fiscal Year</span>' +
      '<span><i class="legend-dot" style="background:#F1EDE5"></i>Operating Margin (%)</span>' +
      "</div></div>"
    );
  }

  // ---------- View 1: Overview (Balanced Product-First Showcase) ----------
  function renderOverview() {
    const spotlightList = [
      { ticker: "AAPL", short: "Apple" },
      { ticker: "MSFT", short: "Microsoft" },
      { ticker: "NVDA", short: "NVIDIA" },
      { ticker: "GOOGL", short: "Alphabet" },
    ];
    const active = BY_TICKER[STATE.overviewTicker] || BY_TICKER.AAPL || OPERATING[0];
    const aps = (active && active.annual_periods) || [];
    const latestFy = aps.length ? aps[aps.length - 1] : headlinePeriod(active);
    const fyStart = aps.length ? aps[Math.max(0, aps.length - 5)].period_label : "";
    const fyEnd = latestFy ? latestFy.period_label : "";
    const revDisp = latestFy && latestFy.metrics && latestFy.metrics.revenue ? latestFy.metrics.revenue.display : "—";
    const opmDisp = latestFy && latestFy.ratios ? fmtPct(latestFy.ratios.operating_margin_pct) : "—";
    const yoyDisp = active && active.growth ? fmtPct(active.growth.revenue_yoy_pct, true) : "—";
    const scoreVal = active && active.research_score && active.research_score.total_score !== null ? active.research_score.total_score + " / 100" : "—";
    const tourActive = Boolean(typeof TUT !== "undefined" && TUT.active);

    const el = document.getElementById("panel-overview");
    el.innerHTML =
      '<div class="ov-hero-band" id="ov-hero-band">' +
      '<div class="ov-intro" id="ov-intro-block">' +
      '<h2 class="ov-headline">Understand businesses <em>behind the numbers.</em></h2>' +
      '<p class="ov-lead">Evaluate U.S. companies directly from primary financial filings, inspect every score and risk rule transparently, and explore historical Treasury rates and data revisions in one workspace.</p>' +
      '<div class="ov-actions">' +
      '<button type="button" class="btn btn-primary" id="btnOvStartTour"' + (tourActive ? " hidden" : "") + ">Start Guided Tour</button>" +
      '<button type="button" class="btn" id="btnOvExploreCompanies">Explore Companies</button>' +
      "</div>" +
      "</div>" +

      '<div class="ov-spotlight" id="ov-focal-stage">' +
      '<div class="ov-spot-head">' +
      '<div class="ov-spot-identity">' +
      "<h2>" + esc(active.name) + ' <span class="mono" style="color:var(--accent)">' + esc(active.ticker) + "</span></h2>" +
      "<span>5-Year Revenue &amp; Operating Margin (" + esc(fyStart + "–" + fyEnd) + ")</span>" +
      "</div>" +
      '<div class="ov-spot-tabs" role="group" aria-label="Sample company preview selector">' +
      spotlightList.map((item) =>
        '<button type="button" class="ov-spot-tab" data-ov-ticker="' + esc(item.ticker) + '" aria-pressed="' + (item.ticker === active.ticker ? "true" : "false") + '">' + esc(item.short) + "</button>"
      ).join("") +
      "</div></div>" +

      '<div class="ov-spot-summary" id="ov-spot-summary">' +
      '<span>' + esc(fyEnd) + ' Revenue <strong>' + esc(revDisp) + '</strong> <em class="muted">(' + esc(yoyDisp) + ' YoY)</em></span>' +
      '<span>Operating Margin <strong>' + esc(opmDisp) + "</strong></span>" +
      '<span>Accounting Score <strong>' + esc(scoreVal) + "</strong></span>" +
      "</div>" +

      renderSpotlightComboSvg(active) +

      '<div class="ov-spot-foot">' +
      "<span>Historical snapshot (Nov 2026) · Research only</span>" +
      '<button type="button" class="btn btn-sm" id="btnOvInspectActive">Open Full Profile →</button>' +
      "</div></div>" +
      "</div>" +

      '<div class="ov-wf-section">' +
      '<div class="ov-wf-heading">Research Workflows</div>' +
      '<div class="ov-workflow-grid" id="ov-workflow-strip">' +
      '<div class="ov-wf-card"><div><h3>Screener &amp; Peers</h3><p>Filter 17 operating companies by cash flow, margins, or balance-sheet criteria with calendar-aligned peer checks.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="screener">Open Screener</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Scoring &amp; Risks</h3><p>Compare seven weighted accounting criteria side by side and review filing-backed risk findings with verification notes.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="evaluation">Open Scoring &amp; Risks</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Treasury Yields</h3><p>Explore the 13-maturity U.S. Treasury par curve and scrub a year of daily rate and spread history.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="treasury">Open Treasury</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Revision Replay</h3><p>Compare As-Of and Latest breakout rules on a synthetic bar ledger to see how delayed corrections alter historical outcomes.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="replay">Open Replay</button></div></div>' +
      "</div></div>";

    const btnTour = document.getElementById("btnOvStartTour");
    if (btnTour) btnTour.addEventListener("click", startTutorial);
    const btnAll = document.getElementById("btnOvExploreCompanies");
    if (btnAll) btnAll.addEventListener("click", () => switchTab("company"));
    const btnInspect = document.getElementById("btnOvInspectActive");
    if (btnInspect) btnInspect.addEventListener("click", () => inspectCompany(active.ticker));
    el.querySelectorAll("[data-ov-ticker]").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.overviewTicker = b.dataset.ovTicker;
        renderOverview();
      });
    });
    el.querySelectorAll("[data-jump]").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.jump));
    });
  }

  // ---------- View 2: Companies (SEC EDGAR Fundamentals) ----------
  function renderCompany() {
    const el = document.getElementById("panel-company");
    const c = BY_TICKER[STATE.selectedTicker] || OPERATING[0];
    const isReady = c.availability_status === "ready";

    const chips = COMPANIES.map((item) => {
      const cls = "ticker-chip" + (item.ticker === c.ticker ? " active" : "") + (item.asset_type === "ETF" ? " etf" : "");
      return '<button type="button" class="' + cls + '" data-ticker="' + esc(item.ticker) + '">' + esc(item.ticker) + "</button>";
    }).join("");

    let body = "";
    if (!isReady) {
      body =
        '<div class="notice notice-teal">' +
        "<strong>Coverage Boundary (" + esc(c.ticker) + " — " + esc(c.name) + "):</strong> " + esc(c.availability_note) +
        "</div>" +
        '<div class="card"><h3>Why ' + esc(c.ticker) + " Has No Imputed GAAP Metrics</h3>" +
        '<p class="muted">Trading Edge Terminal separates exchange-traded funds from corporate GAAP issuers. Rather than fabricating revenues, margins, or scores, screening and scoring modules report <code>insufficient_data</code> cleanly.</p></div>';
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
      const drivers = (c.change_drivers || []).slice(0, 4);
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
        '<p class="muted">CIK <span class="mono">' + esc(c.cik) + "</span> · " + esc(c.exchange || "US") + " · " + esc(c.sic_description || "Operating Company") + ' · FY End: <span class="mono">' + esc(rc.fiscal_year_end || "—") + "</span></p>" +
        "</div><div style=\"display:flex;gap:8px;flex-wrap:wrap\">" +
        '<button type="button" class="btn btn-sm" id="btnCompanyToScore">Score Breakdown</button>' +
        (secHref ? '<a class="btn btn-sm" href="' + esc(secHref) + '" target="_blank" rel="noopener noreferrer">Latest ' + esc(rc.latest_form) + " (" + esc(rc.latest_filing_date) + ") ↗</a>" : "") +
        "</div></div>" +
        '<div class="kpi-grid" style="margin-bottom:0">' +
        '<div class="kpi-card"><div class="kpi-label">Headline Revenue</div><div class="kpi-value">' + esc((hp.metrics.revenue && hp.metrics.revenue.display) || "—") + '</div><div class="kpi-detail">YoY: ' + esc(fmtPct(c.growth.revenue_yoy_pct, true)) + " · 3Y CAGR: " + esc(fmtPct(c.growth.revenue_3y_cagr_pct, true)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Operating Margin</div><div class="kpi-value">' + esc(fmtPct(hp.ratios && hp.ratios.operating_margin_pct)) + '</div><div class="kpi-detail">Gross: ' + esc(fmtPct(hp.ratios && hp.ratios.gross_margin_pct)) + " · Net: " + esc(fmtPct(hp.ratios && hp.ratios.net_margin_pct)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Headline Free Cash Flow</div><div class="kpi-value">' + esc((hp.metrics.free_cash_flow && hp.metrics.free_cash_flow.display) || "—") + '</div><div class="kpi-detail">FCF Margin: ' + esc(fmtPct(hp.ratios && hp.ratios.fcf_margin_pct)) + " · Conv: " + esc(fmtPct(hp.ratios && hp.ratios.fcf_conversion_pct)) + "</div></div>" +
        '<div class="kpi-card"><div class="kpi-label">Net Debt &amp; Score</div><div class="kpi-value">' + esc((hp.metrics.net_debt && hp.metrics.net_debt.display) || "—") + '</div><div class="kpi-detail">Score: ' + esc(c.research_score.total_score) + "/100 (" + esc(c.research_score.band) + ")</div></div>" +
        "</div></div>" +

        '<div class="grid-2" id="company-charts-grid">' +
        '<div class="card" id="company-flow-card"><h3>Annual Scale: Revenue, Net Income &amp; FCF</h3>' + renderFlowBarsSvg(c) + "</div>" +
        '<div class="card" id="company-margin-card"><h3>Annual Margin Trajectory (%)</h3>' + renderMarginLinesSvg(c) + "</div>" +
        "</div>" +

        (drivers.length
          ? '<div class="card"><h3>Year-over-Year Accounting Change Drivers</h3><ul class="driver-list">' +
            drivers.map((dr) => {
              const dirCls = (dr.direction === "up" || dr.direction === "expanded") ? "pos" : ((dr.direction === "down" || dr.direction === "compressed") ? "neg" : "muted");
              return '<li class="driver-item"><div class="driver-item-head"><span>' + esc(dr.comparison) + '</span><span class="mono ' + dirCls + '">' + esc((dr.direction || "").toUpperCase()) + "</span></div><div>" + esc(dr.summary) + "</div></li>";
            }).join("") +
            "</ul></div>"
          : "") +

        '<div class="card" id="company-stmt-card">' +
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
      '<div class="section-head"><div><h2>Company Analysis</h2>' +
      "<p>Explore multi-year performance, normalized financial statements, and official SEC filings across 17 companies plus the SPY ETF boundary.</p></div></div>" +
      '<div class="chip-row" role="group" aria-label="Select company">' + chips + "</div>" +
      body;

    el.querySelectorAll("[data-ticker]").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.selectedTicker = b.dataset.ticker;
        STATE.statementPeriod = "TTM";
        renderCompany();
      });
    });
    const toScore = document.getElementById("btnCompanyToScore");
    if (toScore) toScore.addEventListener("click", () => openEvaluation("score", c.ticker));
    const sel = document.getElementById("stmt-period-select");
    if (sel) {
      sel.addEventListener("change", () => {
        STATE.statementPeriod = sel.value;
        renderCompany();
      });
    }
  }

  // ---------- View 3: Screener & Peers ----------
  function matchesPreset(c, presetId, periodMode) {
    if (presetId === "all") return true;
    const strat = STRATEGIES.find((s) => s.strategy_id === presetId);
    if (!strat) return true;
    const cr = strat.criteria || {};
    const effectiveMode = periodMode || cr.period_mode || "TTM";
    const p = headlinePeriod(c, effectiveMode) || {};
    const m = p.metrics || {};
    const r = p.ratios || {};
    const g = c.growth || {};
    const fcf = num(m.free_cash_flow && m.free_cash_flow.val);
    const netDebt = num(m.net_debt && m.net_debt.val);
    const de = num(r.debt_to_equity);
    const opm = num(r.operating_margin_pct);
    const fcfm = num(r.fcf_margin_pct);
    const fcfc = num(r.fcf_conversion_pct);
    const revYoyRaw = (effectiveMode === "TTM" && g.quarterly_revenue_yoy_pct !== null && g.quarterly_revenue_yoy_pct !== undefined)
      ? g.quarterly_revenue_yoy_pct
      : g.revenue_yoy_pct;
    const revYoy = num(revYoyRaw);
    const riskCount = RISKS.filter((rk) => rk.ticker === c.ticker && (rk.severity === "high" || rk.severity === "medium")).length;
    const opDelta = operatingMarginDeltaPp(c);

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
    if (cr.profitability_trend === "compressing_op_margin") checks.push(opDelta !== null && opDelta < 0);

    if (!checks.length) return true;
    return cr.match_mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
  }

  function renderScreener() {
    const el = document.getElementById("panel-screener");
    const q = STATE.screenerQuery.trim().toLowerCase();
    const minOp = num(STATE.screenerMinOpMargin);
    const minSc = num(STATE.screenerMinScore);
    const pMode = STATE.screenerPeriodMode;

    const rows = OPERATING.filter((c) => {
      if (!matchesPreset(c, STATE.screenerPreset, pMode)) return false;
      if (q && !(c.ticker.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q))) return false;
      const hp = headlinePeriod(c, pMode) || { metrics: {}, ratios: {} };
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
      const hp = headlinePeriod(c, pMode) || { metrics: {}, ratios: {} };
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
    const arrow = (k) => (STATE.screenerSortKey === k ? (STATE.screenerSortDir === "asc" ? " ▲" : " ▼") : "");

    const selectedPeers = STATE.peerTickers.map((t) => BY_TICKER[t]).filter(Boolean);
    const readyPeers = selectedPeers.filter((c) => c.availability_status === "ready");
    const periodEnds = readyPeers.map((c) => ({ t: c.ticker, d: c.reporting_context.headline_period_end })).filter((x) => x.d);
    let maxOffset = 0;
    let offsetPair = "";
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
      peerWarnings.push("Non-operating ETF entity included (" + uncoveredPeers.join(", ") + ") — omitted from corporate GAAP comparisons without imputation.");
    }

    el.innerHTML =
      '<div class="section-head"><div><h2>Financial Screener &amp; Peer Comparison</h2>' +
      "<p>Screen operating companies by profitability, cash flow, and balance-sheet criteria, then compare peers with automatic fiscal-calendar alignment checks.</p></div></div>" +

      '<div class="card" id="screener-main-card">' +
      "<h3>Company Screener (" + rows.length + " / " + OPERATING.length + " matched · " + esc(pMode === "FY" ? "Latest FY" : "TTM") + ")</h3>" +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="scr-preset">Strategy Preset</label><select id="scr-preset">' +
      '<option value="all"' + (STATE.screenerPreset === "all" ? " selected" : "") + ">All 17 Operating Companies</option>" +
      STRATEGIES.map((s) => '<option value="' + esc(s.strategy_id) + '"' + (STATE.screenerPreset === s.strategy_id ? " selected" : "") + ">" + esc(s.name) + "</option>").join("") +
      "</select></div>" +
      '<div class="control-group"><label for="scr-period">Period Basis</label><select id="scr-period">' +
      '<option value="TTM"' + (pMode === "TTM" ? " selected" : "") + ">TTM (Headline)</option>" +
      '<option value="FY"' + (pMode === "FY" ? " selected" : "") + ">Latest FY</option>" +
      "</select></div>" +
      '<div class="control-group"><label for="scr-search">Search Ticker / Name</label><input id="scr-search" type="search" placeholder="e.g. NVDA, Microsoft" value="' + esc(STATE.screenerQuery) + '" /></div>' +
      '<div class="control-group"><label for="scr-opm">Min Op Margin %</label><input id="scr-opm" type="number" step="1" placeholder="e.g. 20" value="' + esc(STATE.screenerMinOpMargin) + '" style="width:118px" /></div>' +
      '<div class="control-group"><label for="scr-score">Min Score</label><input id="scr-score" type="number" step="5" placeholder="e.g. 70" value="' + esc(STATE.screenerMinScore) + '" style="width:105px" /></div>' +
      '<button type="button" class="btn" id="scr-pos-fcf" aria-pressed="' + (STATE.screenerPosFcf ? "true" : "false") + '">Positive FCF</button>' +
      '<button type="button" class="btn" id="scr-net-cash" aria-pressed="' + (STATE.screenerNetCash ? "true" : "false") + '">Net Cash Only</button>' +
      '<button type="button" class="btn btn-ghost" id="scr-reset">Reset</button>' +
      "</div>" +
      (activeStrat ? '<div class="notice notice-teal" id="screener-preset-banner" style="margin-bottom:12px"><strong>' + esc(activeStrat.name) + ":</strong> " + esc(activeStrat.description) + "</div>" : "") +
      '<div class="table-wrap" id="screener-table-wrap"><table><thead><tr>' +
      '<th><button type="button" class="sort-btn" data-sort="ticker">Ticker' + arrow("ticker") + "</button></th>" +
      "<th>Company</th>" +
      '<th class="num"><button type="button" class="sort-btn" data-sort="score">Score' + arrow("score") + "</button></th>" +
      '<th class="num"><button type="button" class="sort-btn" data-sort="revenue">Revenue' + arrow("revenue") + "</button></th>" +
      '<th class="num"><button type="button" class="sort-btn" data-sort="op_margin">Op Margin' + arrow("op_margin") + "</button></th>" +
      '<th class="num"><button type="button" class="sort-btn" data-sort="fcf">Free Cash Flow' + arrow("fcf") + "</button></th>" +
      '<th class="num"><button type="button" class="sort-btn" data-sort="net_debt">Net Debt' + arrow("net_debt") + "</button></th>" +
      "<th>Filed</th><th></th>" +
      "</tr></thead><tbody>" +
      (rows.length ? rows.map((c) => {
        const hp = headlinePeriod(c, pMode) || { metrics: {}, ratios: {} };
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
          '<td><button type="button" class="btn btn-sm" data-inspect="' + esc(c.ticker) + '">Inspect</button></td>' +
          "</tr>"
        );
      }).join("") : '<tr><td colspan="9" class="muted">No operating companies match the active screening criteria.</td></tr>') +
      "</tbody></table></div>" +
      '<p class="muted" style="margin:10px 0 0;font-size:12px">Excluded from operating screen: <strong>SPY</strong> (non-corporate ETF). Screening criteria are descriptive GAAP accounting filters, not investment recommendations.</p>' +
      "</div>" +

      '<div class="card" id="screener-peer-card">' +
      "<h3>Peer Comparison (" + selectedPeers.length + " selected)</h3>" +
      '<p class="card-sub">Toggle issuers to compare headline GAAP fundamentals side by side with automatic fiscal-calendar offset detection (&gt; 45 days).</p>' +
      '<div class="peer-picker">' +
      COMPANIES.map((c) => {
        const checked = STATE.peerTickers.includes(c.ticker) ? " checked" : "";
        return '<label class="peer-toggle"><input type="checkbox" data-peer="' + esc(c.ticker) + '"' + checked + " />" + esc(c.ticker) + "</label>";
      }).join("") +
      "</div>" +
      (peerWarnings.length ? '<div class="notice notice-caution" id="screener-peer-warnings"><strong>Cohort Alignment Notices:</strong><ul style="margin:6px 0 0;padding-left:18px">' + peerWarnings.map((w) => "<li>" + esc(w) + "</li>").join("") + "</ul></div>" : "") +
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
    document.getElementById("scr-period").addEventListener("change", (ev) => { STATE.screenerPeriodMode = ev.target.value; renderScreener(); });
    document.getElementById("scr-search").addEventListener("input", (ev) => { STATE.screenerQuery = ev.target.value; renderScreener(); });
    document.getElementById("scr-opm").addEventListener("input", (ev) => { STATE.screenerMinOpMargin = ev.target.value; renderScreener(); });
    document.getElementById("scr-score").addEventListener("input", (ev) => { STATE.screenerMinScore = ev.target.value; renderScreener(); });
    document.getElementById("scr-pos-fcf").addEventListener("click", () => { STATE.screenerPosFcf = !STATE.screenerPosFcf; renderScreener(); });
    document.getElementById("scr-net-cash").addEventListener("click", () => { STATE.screenerNetCash = !STATE.screenerNetCash; renderScreener(); });
    document.getElementById("scr-reset").addEventListener("click", () => {
      STATE.screenerPreset = "all"; STATE.screenerPeriodMode = "TTM"; STATE.screenerQuery = ""; STATE.screenerMinOpMargin = ""; STATE.screenerMinScore = ""; STATE.screenerPosFcf = false; STATE.screenerNetCash = false;
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

  // ---------- View 4: Scoring & Risks (Segmented Sub-Views) ----------
  function renderEvaluation() {
    const el = document.getElementById("panel-evaluation");
    const isScore = STATE.evalSubView !== "risks";

    const headerHtml =
      '<div class="section-head"><div>' +
      "<h2>Accounting Score &amp; Risk Inspector</h2>" +
      "<p>Compare companies across seven weighted financial criteria and review filing-backed accounting risk flags.</p>" +
      "</div></div>" +
      '<div class="segment-bar" role="group" aria-label="Evaluation module">' +
      '<button type="button" class="segment-btn" id="seg-score" aria-pressed="' + (isScore ? "true" : "false") + '">Accounting Score (7 Components)</button>' +
      '<button type="button" class="segment-btn" id="seg-risks" aria-pressed="' + (!isScore ? "true" : "false") + '">Risk Inspector (' + RISKS.length + " Findings)</button>" +
      "</div>";

    if (isScore) {
      const c = BY_TICKER[STATE.scoreTicker] || OPERATING[0];
      const rs = c.research_score || {};
      const compA = BY_TICKER[STATE.compareA] || OPERATING[0];
      const compB = BY_TICKER[STATE.compareB] || OPERATING[1];

      const breakdownHtml = (rs.total_score === null || rs.total_score === undefined || !(rs.components && rs.components.length))
        ? '<div class="notice notice-teal"><strong>' + esc(c.ticker) + " — " + esc(rs.band) + ":</strong> " + esc(rs.status_note || "Insufficient GAAP operating weight coverage (< 50%).") + "</div>"
        : '<div class="kpi-grid kpi-grid-3" id="score-breakdown-kpis" style="margin-bottom:14px">' +
          '<div class="kpi-card"><div class="kpi-label">Composite Score</div><div class="kpi-value">' + esc(rs.total_score) + ' / 100</div><div class="kpi-detail">' + esc(rs.band) + "</div></div>" +
          '<div class="kpi-card"><div class="kpi-label">Weight Coverage</div><div class="kpi-value">' + esc(rs.coverage_pct) + '%</div><div class="kpi-detail">' + esc(rs.observed_points) + " / " + esc(rs.evaluated_max_weight) + " evaluated pts</div></div>" +
          '<div class="kpi-card"><div class="kpi-label">Methodology</div><div class="kpi-value" style="font-size:15px">7-Component GAAP</div><div class="kpi-detail">Missing metrics excluded, never imputed</div></div>' +
          "</div>" +
          (rs.components || []).map((comp) => {
            const pct = num(comp.component_pct) || 0;
            const crList = (comp.criteria || []).map((cr) =>
              "<li><strong>" + esc(cr.label) + ':</strong> <span class="mono">' + esc(cr.earned_points) + "/" + esc(cr.max_points) + "</span> — " + esc(cr.explanation) + ' <span class="muted">(' + esc(cr.observed_input || "—") + ")</span></li>"
            ).join("");
            return (
              '<div class="score-row">' +
              '<div class="score-head"><strong>' + esc(comp.label) + '</strong><span class="mono">' + esc(comp.earned_points) + " / " + esc(comp.evaluated_max_weight) + " pts (" + esc(comp.component_pct) + "%)</span></div>" +
              '<div class="score-track"><div class="score-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>' +
              '<ul class="criteria-list">' + crList + "</ul>" +
              "</div>"
            );
          }).join("");

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
          '<td><strong>' + esc(mc.label) + '</strong> <span class="muted">(/' + esc(mc.max_weight) + ")</span></td>" +
          '<td class="num">' + (aPts !== null ? aPts.toFixed(1) : "—") + "</td>" +
          '<td class="num">' + (bPts !== null ? bPts.toFixed(1) : "—") + "</td>" +
          '<td class="num' + cls + '">' + esc(dStr) + "</td>" +
          "</tr>"
        );
      }).join("");

      el.innerHTML =
        headerHtml +
        '<div class="notice notice-caution"><strong>Non-Advisory Research Scope:</strong> Accounting scores summarize historical SEC GAAP disclosures only. They are not BUY/SELL/HOLD recommendations, valuation models, or predictors of future equity returns.</div>' +
        '<div class="card" id="score-compare-card">' +
        "<h3>Two-Company Component Delta Comparison</h3>" +
        '<div class="controls-bar">' +
        '<div class="control-group"><label for="cmp-a">Company A</label><select id="cmp-a">' +
        OPERATING.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === compA.ticker ? " selected" : "") + ">" + esc(x.ticker) + " (" + esc(x.research_score.total_score) + ")</option>").join("") +
        "</select></div>" +
        '<div class="control-group"><label for="cmp-b">Company B</label><select id="cmp-b">' +
        OPERATING.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === compB.ticker ? " selected" : "") + ">" + esc(x.ticker) + " (" + esc(x.research_score.total_score) + ")</option>").join("") +
        "</select></div>" +
        '<span class="meta-chip">Net Delta (' + esc(compA.ticker + " − " + compB.ticker) + "): <strong>" + (totalDelta > 0 ? "+" : "") + totalDelta.toFixed(1) + " pts</strong></span>" +
        "</div>" +
        '<div class="table-wrap" id="score-compare-table"><table><thead><tr><th>Component</th><th class="num">' + esc(compA.ticker) + '</th><th class="num">' + esc(compB.ticker) + '</th><th class="num">Delta (A − B)</th></tr></thead><tbody>' +
        deltaRows +
        "</tbody></table></div></div>" +

        '<div class="card" id="score-breakdown-card">' +
        '<div class="controls-bar">' +
        '<div class="control-group"><label for="score-ticker-sel">Inspect Single-Entity Score Breakdown</label><select id="score-ticker-sel">' +
        COMPANIES.map((x) => '<option value="' + esc(x.ticker) + '"' + (x.ticker === c.ticker ? " selected" : "") + ">" + esc(x.ticker + " — " + x.name) + "</option>").join("") +
        "</select></div></div>" +
        breakdownHtml +
        "</div>";

      document.getElementById("score-ticker-sel").addEventListener("change", (ev) => { STATE.scoreTicker = ev.target.value; renderEvaluation(); });
      document.getElementById("cmp-a").addEventListener("change", (ev) => { STATE.compareA = ev.target.value; renderEvaluation(); });
      document.getElementById("cmp-b").addEventListener("change", (ev) => { STATE.compareB = ev.target.value; renderEvaluation(); });
    } else {
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
        headerHtml +
        '<div class="notice notice-teal"><strong>Bounded Rule Coverage:</strong> Automated rules evaluate specific historical GAAP accounting thresholds and coverage checks. Absence of a finding does not imply low investment risk or solvency.</div>' +
        '<div class="card" id="risk-inspector-card">' +
        "<h3>Filing-Backed Risk Findings (" + filtered.length + " / " + RISKS.length + " shown)</h3>" +
        '<div class="controls-bar">' +
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
        '<button type="button" class="btn btn-ghost" id="rk-reset">Reset</button>' +
        "</div>" +
        (filtered.length ? filtered.map((r, rIdx) => {
          const secHref = safeSecUrl(r.sec_url);
          return (
            '<div class="risk-card"' + (rIdx === 0 ? ' id="risk-first-card"' : "") + ">" +
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

      document.getElementById("rk-sev").addEventListener("change", (ev) => { STATE.riskSeverity = ev.target.value; renderEvaluation(); });
      document.getElementById("rk-cat").addEventListener("change", (ev) => { STATE.riskCategory = ev.target.value; renderEvaluation(); });
      document.getElementById("rk-tkr").addEventListener("change", (ev) => { STATE.riskTicker = ev.target.value; renderEvaluation(); });
      document.getElementById("rk-q").addEventListener("input", (ev) => { STATE.riskQuery = ev.target.value; renderEvaluation(); });
      document.getElementById("rk-reset").addEventListener("click", () => {
        STATE.riskSeverity = "all"; STATE.riskCategory = "all"; STATE.riskTicker = "all"; STATE.riskQuery = "";
        renderEvaluation();
      });
    }

    document.getElementById("seg-score").addEventListener("click", () => { STATE.evalSubView = "score"; renderEvaluation(); });
    document.getElementById("seg-risks").addEventListener("click", () => { STATE.evalSubView = "risks"; renderEvaluation(); });
  }

  // ---------- View 5: Treasury ----------
  function renderTreasury() {
    const el = document.getElementById("panel-treasury");
    const history = TREASURY.history || [];
    const idx = Math.max(0, Math.min(history.length - 1, STATE.treasuryIdx));
    const cur = history[idx] || TREASURY.latest || {};
    const d1m = (TREASURY.deltas && TREASURY.deltas["1M"]) || {};
    const d1y = (TREASURY.deltas && TREASURY.deltas["1Y"]) || {};

    el.innerHTML =
      '<div class="section-head"><div><h2>U.S. Treasury Par Yield Curve</h2>' +
      "<p>Historical Daily Treasury Par Yield Curve Rates (U.S. Department of the Treasury public-domain dataset; snapshot ends " + esc(TREASURY.latest.rate_date) + ").</p></div></div>" +

      '<div class="kpi-grid">' +
      '<div class="kpi-card"><div class="kpi-label">10Y Yield (' + esc(cur.rate_date) + ')</div><div class="kpi-value">' + esc(cur.y10) + '%</div><div class="kpi-detail">Latest 1M: ' + esc(fmtSignedBps(d1m.y10_bps)) + " · 1Y: " + esc(fmtSignedBps(d1y.y10_bps)) + "</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">2Y Treasury Yield</div><div class="kpi-value">' + esc(cur.y2) + '%</div><div class="kpi-detail">3M Bill: ' + esc(cur.m3) + "% · 30Y Bond: " + esc(cur.y30) + "%</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">10Y − 2Y Spread</div><div class="kpi-value ' + (num(cur.spread_10y_2y) < 0 ? "neg" : "pos") + '">' + esc(cur.spread_10y_2y) + '%</div><div class="kpi-detail">' + (num(cur.spread_10y_2y) < 0 ? "Inverted curve (< 0%)" : "Positive slope (>= 0%)") + "</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">10Y − 3M Spread</div><div class="kpi-value ' + (num(cur.spread_10y_3m) < 0 ? "neg" : "pos") + '">' + esc(cur.spread_10y_3m) + '%</div><div class="kpi-detail">' + esc(TREASURY.regime_note) + "</div></div>" +
      "</div>" +

      '<div class="grid-2" id="treasury-charts-grid">' +
      '<div class="card" id="treasury-curve-card"><h3>Full 13-Tenor Par Yield Curve (' + esc(TREASURY.latest.rate_date) + ")</h3>" +
      '<p class="card-sub">Annualized percentage yield (%) parsed with exact Decimal arithmetic from Treasury CSV.</p>' +
      renderTreasuryCurveSvg(TREASURY.curve_points, false) + "</div>" +

      '<div class="card" id="treasury-history-card"><h3>260-Day Historical Trajectory (' + esc(history[0].rate_date) + " → " + esc(history[history.length - 1].rate_date) + ")</h3>" +
      '<div class="controls-bar" style="margin-bottom:10px;align-items:center">' +
      '<label for="tr-slider" style="font-size:12px;color:var(--muted)">Inspect Date:</label>' +
      '<input id="tr-slider" type="range" min="0" max="' + (history.length - 1) + '" value="' + idx + '" style="flex:1;min-width:130px" />' +
      '<button type="button" class="btn btn-sm" data-tr-jump="0">Earliest</button>' +
      '<button type="button" class="btn btn-sm" data-tr-jump="' + Math.floor(history.length / 2) + '">Midpoint</button>' +
      '<button type="button" class="btn btn-sm" data-tr-jump="' + (history.length - 1) + '">Latest</button>' +
      "</div>" +
      renderTreasuryHistorySvg(history, idx) + "</div>" +
      "</div>" +

      '<div class="card"><h3>Curve Tenor Rates (' + esc(TREASURY.latest.rate_date) + ")</h3>" +
      '<div class="table-wrap"><table><thead><tr>' +
      (TREASURY.curve_points || []).map((c) => '<th class="num">' + esc(c.label) + "</th>").join("") +
      "</tr></thead><tbody><tr>" +
      (TREASURY.curve_points || []).map((c) => '<td class="num">' + esc(c.rate_pct) + "%</td>").join("") +
      "</tr></tbody></table></div>" +
      '<p class="muted" style="margin:10px 0 0;font-size:12px">Source: U.S. Department of the Treasury (<code>home.treasury.gov</code>, public-domain historical series; 465 total acquired dates from <code>' + esc(TREASURY.earliest_date) + "</code>).</p></div>";

    document.getElementById("tr-slider").addEventListener("input", (ev) => { STATE.treasuryIdx = Number(ev.target.value); renderTreasury(); });
    el.querySelectorAll("[data-tr-jump]").forEach((b) => b.addEventListener("click", () => { STATE.treasuryIdx = Number(b.dataset.trJump); renderTreasury(); }));
  }

  // ---------- View 6: Point-in-Time Revision Replay ----------
  function renderReplay() {
    const el = document.getElementById("panel-replay");
    const isAsOf = STATE.replayMode === "as_of";
    const rep = isAsOf ? M1.as_of : M1.latest;
    const signals = rep.signals || [];
    const calVersion = (rep.calendar && (rep.calendar.version || rep.calendar.id)) || "US-RTH-2026-2027/v1";

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
      '<div class="section-head"><div><h2>Point-in-Time Observation &amp; Revision Replay</h2>' +
      "<p>Synthetic 1-minute bar fixture (<code>fixture:TEST</code>) verifying anti-lookahead breakout evaluation across delayed revisions and duplicate arrivals.</p></div></div>" +

      '<div class="notice notice-neg"><strong>Synthetic Fixture Disclosure:</strong> All OHLCV bar prices below are fabricated integers for deterministic replay testing. The 3-bar breakout rule (<code>close[t] &gt; max(high[t-3..t-1])</code>) uses zero real exchange quotes and is not a validated or profitable trading strategy.</div>' +

      '<div class="card" id="replay-workbench-card">' +
      '<div class="controls-bar" id="replay-controls">' +
      '<button type="button" class="btn" id="rep-asof" aria-pressed="' + (isAsOf ? "true" : "false") + '">As-Of (' + esc(M1.as_of_cutoff) + ")</button>" +
      '<button type="button" class="btn" id="rep-latest" aria-pressed="' + (!isAsOf ? "true" : "false") + '">Latest Retrospective</button>' +
      '<span class="meta-chip">Breakouts: <strong>' + signals.length + "</strong></span>" +
      '<span class="meta-chip">Duplicates Ignored: <strong>' + (rep.duplicates || []).length + "</strong></span>" +
      '<span class="meta-chip">Calendar: <strong>' + esc(calVersion) + "</strong></span>" +
      "</div>" +

      (signals.length
        ? '<div class="notice notice-teal" id="replay-notice"><strong>As-Of Projection (' + esc(M1.as_of_cutoff) + '):</strong> At <code>14:34:02Z</code>, the delayed correction to bar <code>14:32Z</code> (arriving at <code>14:35:00Z</code>) was not yet known. Prior 3-bar max high was <strong>12</strong>, so close <strong>13 &gt; 12</strong> emitted <strong>1 breakout event</strong> (<code>logical_id: ' + esc(signals[0].logical_id.slice(0, 16)) + "…</code>).</div>"
        : '<div class="notice notice-caution" id="replay-notice"><strong>Latest Retrospective Projection:</strong> Revision <code>r2</code> of bar <code>14:32Z</code> arrived at <code>14:35:00Z</code>, revising its high from <code>12 → 15</code>. Close <code>13</code> no longer exceeds prior max high <code>15</code>, so <strong>0 breakouts</strong> qualify while every revision remains preserved in the audit ledger.</div>') +

      renderM1BarsSvg(rep) +
      "</div>" +

      '<div class="card"><h3>Immutable Revision Audit Ledger</h3>' +
      '<p class="card-sub">Both query modes retain complete revision provenance; only the projected selected bars and breakout evaluation change with the knowledge cutoff.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Bar Start (UTC)</th><th>Rev</th><th class="num">O / H / L / C</th><th>Known At (UTC)</th><th>Payload Hash</th><th>Type</th></tr></thead><tbody>' +
      histRows +
      "</tbody></table></div></div>";

    document.getElementById("rep-asof").addEventListener("click", () => { STATE.replayMode = "as_of"; renderReplay(); });
    document.getElementById("rep-latest").addEventListener("click", () => { STATE.replayMode = "latest"; renderReplay(); });
  }

  // ---------- View 7: Architecture & Provenance ----------
  function renderArchitecture() {
    const el = document.getElementById("panel-architecture");
    el.innerHTML =
      '<div class="section-head"><div><h2>System Architecture &amp; Data Provenance</h2>' +
      "<p>Separation between the local-first Python/SQLite research workstation and this zero-backend static browser preview.</p></div></div>" +

      '<div class="card"><h3>Architecture Overview</h3>' +
      '<div class="chart-box">' +
      '<svg viewBox="0 0 920 250" role="img" aria-label="Trading Edge Terminal architecture showing Public Federal Sources, Synthetic Observation Engine, Local Python/SQLite Workstation, and Static Browser Preview">' +
      '<defs><marker id="arr-tet" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#B49A78" /></marker></defs>' +
      '<rect x="16" y="18" width="260" height="94" rx="8" fill="#1C1E22" stroke="#758D92" stroke-width="1.5" />' +
      '<text x="30" y="42" fill="#F1EDE5" font-size="13" font-weight="700">Public Federal Data Sources</text>' +
      '<text x="30" y="63" fill="#A4ABB6" font-size="11.5">• SEC EDGAR XBRL &amp; Submissions</text>' +
      '<text x="30" y="81" fill="#A4ABB6" font-size="11.5">• U.S. Treasury Par Yield CSVs</text>' +
      '<text x="30" y="99" fill="#7B8391" font-size="10.5">Rate-limited &lt;= 4 req/s · SHA-256 Cache</text>' +

      '<rect x="16" y="136" width="260" height="94" rx="8" fill="#1C1E22" stroke="#B49A78" stroke-width="1.5" />' +
      '<text x="30" y="160" fill="#F1EDE5" font-size="13" font-weight="700">Observation &amp; Revision Engine</text>' +
      '<text x="30" y="181" fill="#A4ABB6" font-size="11.5">• Exact Decimal OHLCV &amp; NYSE RTH</text>' +
      '<text x="30" y="199" fill="#A4ABB6" font-size="11.5">• Append-only Revision / As-Of Ledger</text>' +
      '<text x="30" y="217" fill="#7B8391" font-size="10.5">Synthetic fixtures · Offline replay</text>' +

      '<rect x="330" y="38" width="260" height="172" rx="8" fill="#1C1E22" stroke="#B49A78" stroke-width="1.6" />' +
      '<text x="344" y="64" fill="#B49A78" font-size="13" font-weight="700">Private Python / SQLite Workstation</text>' +
      '<text x="344" y="86" fill="#F1EDE5" font-size="11.5">Python 3.9+ Standard Library Only</text>' +
      '<text x="344" y="106" fill="#A4ABB6" font-size="11.5">• SQLite exact Decimal TEXT storage</text>' +
      '<text x="344" y="124" fill="#A4ABB6" font-size="11.5">• TTM/FY Normalization &amp; 21 Risk Rules</text>' +
      '<text x="344" y="142" fill="#A4ABB6" font-size="11.5">• Screener, Scoring &amp; Monitoring Alerts</text>' +
      '<text x="344" y="160" fill="#A4ABB6" font-size="11.5">• 127.0.0.1 Loopback Server + CSRF</text>' +
      '<text x="344" y="188" fill="#4E9F76" font-size="11">Private Repo: 250 / 250 Offline Tests</text>' +

      '<rect x="644" y="38" width="260" height="172" rx="8" fill="#141619" stroke="#758D92" stroke-width="1.6" stroke-dasharray="5 3" />' +
      '<text x="658" y="64" fill="#F1EDE5" font-size="13" font-weight="700">Static Browser Preview (This Site)</text>' +
      '<text x="658" y="86" fill="#A4ABB6" font-size="11.5">Zero Backend · Zero Live Network Calls</text>' +
      '<text x="658" y="106" fill="#A4ABB6" font-size="11.5">• Dated 2026-11-12 SEC/Treasury Data</text>' +
      '<text x="658" y="124" fill="#A4ABB6" font-size="11.5">• Deterministic Client-Side Screener</text>' +
      '<text x="658" y="142" fill="#A4ABB6" font-size="11.5">• Exact Synthetic As-Of Replay Outputs</text>' +
      '<text x="658" y="160" fill="#A4ABB6" font-size="11.5">• Zero Credentials / Zero Paid Infra</text>' +
      '<text x="658" y="188" fill="#B49A78" font-size="11">Verified Against Exported Snapshot</text>' +

      '<line x1="276" y1="65" x2="328" y2="92" stroke="#B49A78" stroke-width="1.6" marker-end="url(#arr-tet)" />' +
      '<line x1="276" y1="184" x2="328" y2="156" stroke="#B49A78" stroke-width="1.6" marker-end="url(#arr-tet)" />' +
      '<line x1="590" y1="124" x2="642" y2="124" stroke="#B49A78" stroke-width="1.6" marker-end="url(#arr-tet)" />' +
      "</svg></div></div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Capability &amp; Boundary Matrix</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Layer</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      '<tr><td>Private Python Engine</td><td>Zero-dependency Python 3.9+ &amp; SQLite workstation (250/250 offline tests verified in private repo)</td><td><span class="pill pill-low">FROZEN PRIVATE</span></td></tr>' +
      '<tr><td>Static Preview Parity</td><td>17 SEC operating companies, SPY ETF boundary, 22 risk findings, 260 Treasury dates, synthetic replay</td><td><span class="pill pill-reported">STATIC FIXTURE</span></td></tr>' +
      '<tr><td>Loopback Server &amp; Queue</td><td>Local 127.0.0.1 HTTP API, SEC directory search, batch acquisition &amp; monitoring alerts</td><td><span class="pill pill-derived">LOCAL PYTHON ONLY</span></td></tr>' +
      '<tr><td>Live Quotes &amp; Orders</td><td>Real-time stock prices, brokerage execution, investment advice, ML forecasting</td><td><span class="pill pill-high">NOT IMPLEMENTED</span></td></tr>' +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Explicit Scope &amp; Limitations</h3>' +
      '<ul class="criteria-list" style="font-size:13px;color:var(--fg)">' +
      "<li><strong>Historical Snapshot:</strong> Active feature development is frozen; SEC EDGAR and U.S. Treasury figures are dated <code>2026-11-12</code> / <code>2026-11-10</code> and do not auto-refresh.</li>" +
      "<li><strong>No Stock Prices or Valuations:</strong> Tracks SEC GAAP filings and Treasury yields only — zero equity quotes, P/E multiples, or total-return backtests.</li>" +
      "<li><strong>Non-Advisory Posture:</strong> Screening rules, accounting scores, and risk audits are transparent research heuristics, never investment recommendations.</li>" +
      "<li><strong>Synthetic Breakout Fixture:</strong> Revision Replay uses fabricated integers (<code>fixture:TEST</code>) to prove anti-lookahead semantics, not trading profitability.</li>" +
      "</ul></div></div>";
  }

  function renderActiveTab() {
    if (STATE.tab === "overview") renderOverview();
    else if (STATE.tab === "company") renderCompany();
    else if (STATE.tab === "screener") renderScreener();
    else if (STATE.tab === "evaluation") renderEvaluation();
    else if (STATE.tab === "treasury") renderTreasury();
    else if (STATE.tab === "replay") renderReplay();
    else if (STATE.tab === "architecture") renderArchitecture();
  }

  // ---------- Interactive Watch Tutorial (Sticky Dock, Adaptive Sequential Guidance, State-Isolated) ----------
  function latestAnnualPeriodKey(ticker) {
    const c = BY_TICKER[ticker];
    const aps = (c && c.annual_periods) || [];
    return aps.length ? aps[aps.length - 1].period_key : "TTM";
  }

  const TUTORIAL_STAGES = [
    {
      id: "overview",
      title: "Welcome to Trading Edge Terminal",
      phases: [
        {
          id: "product-intro",
          label: "Overview",
          narration: "Trading Edge Terminal brings multi-year company fundamentals, screening, accounting risks, and Treasury yields into one workspace.",
          targetSelector: "#ov-focal-stage",
          desktopSelector: "#ov-hero-band",
          durationMs: 4200,
          apply: function () {
            STATE.overviewTicker = "AAPL";
            switchTab("overview");
          },
        },
        {
          id: "spotlight-switch",
          label: "Switch Company",
          narration: "Switch companies directly from the Overview—selecting NVIDIA shows five-year revenue growth to $215.9B and a 60.4% operating margin.",
          targetSelector: "#ov-focal-stage",
          desktopSelector: "#ov-hero-band",
          durationMs: 3800,
          apply: function () {
            STATE.overviewTicker = "NVDA";
            switchTab("overview");
          },
        },
        {
          id: "spotlight-chart",
          label: "5Y Chart",
          narration: "The five-year revenue and operating margin chart updates directly when selecting NVIDIA (FY2022–FY2026).",
          targetSelector: "#ov-focal-chart",
          checkSelector: "#ov-focal-chart svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "overview" || STATE.overviewTicker !== "NVDA") {
              STATE.overviewTicker = "NVDA";
              switchTab("overview");
            }
          },
        },
        {
          id: "workflow-tour",
          label: "Workflows",
          narration: "Open any research workflow directly from the Overview: screening, scoring and risks, Treasury yields, or revision replay.",
          targetSelector: "#ov-workflow-strip",
          checkSelector: "#ov-workflow-strip",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "overview") switchTab("overview");
          },
        },
      ],
    },
    {
      id: "company-fundamentals",
      title: "SEC EDGAR Statement Provenance",
      phases: [
        {
          id: "flow-chart",
          label: "Revenue & FCF",
          narration: "Apple (AAPL) 5-year GAAP Revenue, Net Income, and Free Cash Flow scale chart from SEC XBRL filings.",
          targetSelector: "#company-flow-card",
          desktopSelector: "#company-charts-grid",
          durationMs: 3800,
          apply: function () {
            STATE.selectedTicker = "AAPL";
            STATE.statementPeriod = "TTM";
            switchTab("company");
          },
        },
        {
          id: "margin-chart",
          label: "Margins",
          narration: "Annual Gross, Operating, and Free Cash Flow margin trajectories across FY2022–FY2026.",
          targetSelector: "#company-margin-card",
          checkSelector: "#company-margin-card svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "company" || STATE.selectedTicker !== "AAPL") {
              STATE.selectedTicker = "AAPL";
              STATE.statementPeriod = "TTM";
              switchTab("company");
            }
          },
        },
        {
          id: "statement-provenance",
          label: "XBRL Provenance",
          narration: "Normalized FY2026 statement separates [REPORTED] SEC XBRL tags from [DERIVED] formulas with filing dates.",
          targetSelector: "#company-stmt-card .table-wrap",
          desktopSelector: "#company-stmt-card",
          durationMs: 3800,
          apply: function () {
            STATE.selectedTicker = "AAPL";
            STATE.statementPeriod = latestAnnualPeriodKey("AAPL");
            switchTab("company");
          },
        },
      ],
    },
    {
      id: "screener-peers",
      title: "GAAP Screener & Peer Alignment",
      phases: [
        {
          id: "screener-results",
          label: "Screener (8/17)",
          narration: "Cash Flow Quality preset filters 17 operating companies deterministically (8 matched; SPY excluded).",
          targetSelector: "#screener-preset-banner",
          desktopSelector: "#screener-main-card",
          durationMs: 4000,
          apply: function () {
            STATE.screenerPreset = "builtin_cash_flow_quality";
            STATE.screenerPeriodMode = "TTM";
            STATE.screenerQuery = "";
            STATE.screenerMinOpMargin = "";
            STATE.screenerMinScore = "";
            STATE.screenerPosFcf = false;
            STATE.screenerNetCash = false;
            switchTab("screener");
          },
        },
        {
          id: "peer-alignment",
          label: "Peer Offset",
          narration: "Peer comparison automatically flags fiscal-calendar offsets above 45 days and non-imputed ETFs.",
          targetSelector: "#screener-peer-warnings",
          durationMs: 3800,
          apply: function () {
            if (STATE.tab !== "screener") switchTab("screener");
          },
        },
      ],
    },
    {
      id: "scoring-diff",
      title: "Explainable Accounting Score",
      phases: [
        {
          id: "score-delta",
          label: "AAPL vs MSFT",
          narration: "Side-by-side component delta compares AAPL (91.5) against MSFT (92) across 7 GAAP categories (-0.5 pts).",
          targetSelector: "#score-compare-table",
          desktopSelector: "#score-compare-card",
          durationMs: 4000,
          apply: function () {
            STATE.evalSubView = "score";
            STATE.scoreTicker = "MSFT";
            STATE.compareA = "AAPL";
            STATE.compareB = "MSFT";
            switchTab("evaluation");
          },
        },
        {
          id: "score-breakdown",
          label: "7 Components",
          narration: "Single-entity breakdown displays composite score, 100% weight coverage, and observed accounting inputs.",
          targetSelector: "#score-breakdown-kpis",
          checkSelector: "#score-breakdown-kpis",
          onlyIfClipped: true,
          durationMs: 3600,
          apply: function () {
            if (STATE.tab !== "evaluation" || STATE.evalSubView !== "score") {
              STATE.evalSubView = "score";
              switchTab("evaluation");
            }
          },
        },
      ],
    },
    {
      id: "risk-audit",
      title: "Filing-Backed Risk Inspector",
      phases: [
        {
          id: "high-risks",
          label: "High Findings",
          narration: "Filtering High-severity findings surfaces 3 structured rules with measurement criteria, caveats, and SEC links.",
          targetSelector: "#risk-first-card",
          desktopSelector: "#risk-inspector-card",
          durationMs: 5200,
          apply: function () {
            STATE.evalSubView = "risks";
            STATE.riskSeverity = "high";
            STATE.riskCategory = "all";
            STATE.riskTicker = "all";
            STATE.riskQuery = "";
            switchTab("evaluation");
          },
        },
      ],
    },
    {
      id: "treasury-macro",
      title: "U.S. Treasury Yield Curve",
      phases: [
        {
          id: "yield-curve",
          label: "Par Curve",
          narration: "Full 13-tenor U.S. Treasury Par Yield Curve on 2026-11-10 (1M 4.05% through 10Y 4.98% and 30Y 5.35%).",
          targetSelector: "#treasury-curve-card",
          desktopSelector: "#treasury-charts-grid",
          durationMs: 3800,
          apply: function () {
            STATE.treasuryIdx = 0;
            switchTab("treasury");
          },
        },
        {
          id: "history-scrub",
          label: "260-Day Scrub",
          narration: "Scrubbing the 260-day history to 2026-11-10 updates 10Y (4.98%), 2Y (4.73%), 3M (4.30%), and exact spreads.",
          targetSelector: "#treasury-history-card",
          durationMs: 3800,
          apply: function () {
            STATE.treasuryIdx = Math.max(0, (TREASURY.history || []).length - 1);
            switchTab("treasury");
          },
        },
      ],
    },
    {
      id: "revision-replay",
      title: "Point-in-Time Revision Replay",
      phases: [
        {
          id: "as-of-result",
          label: "As-Of (1)",
          narration: "As-Of 14:34:02Z evaluates bars known at the cutoff: prior max high is 12, so close 13 emits 1 breakout.",
          targetSelector: "#replay-controls",
          desktopSelector: "#replay-workbench-card",
          durationMs: 3600,
          apply: function () {
            STATE.replayMode = "as_of";
            switchTab("replay");
          },
        },
        {
          id: "as-of-chart",
          label: "As-Of Chart",
          narration: "As-Of candlestick chart shows bar 14:33Z (H:14 C:13) breaking above the prior 3-bar max high threshold of 12.",
          targetSelector: "#replay-chart-box",
          checkSelector: "#replay-chart-box svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "replay" || STATE.replayMode !== "as_of") {
              STATE.replayMode = "as_of";
              switchTab("replay");
            }
          },
        },
        {
          id: "latest-result",
          label: "Latest (0)",
          narration: "Switching to Latest includes delayed revision r2 (high 12 → 15): close 13 no longer qualifies (0 breakouts).",
          targetSelector: "#replay-controls",
          desktopSelector: "#replay-workbench-card",
          durationMs: 3600,
          apply: function () {
            STATE.replayMode = "latest";
            switchTab("replay");
          },
        },
        {
          id: "latest-chart",
          label: "Latest Chart",
          narration: "Updated Latest candlestick chart shows revised bar 14:32Z (H:15, amber) raising the breakout threshold to 15.",
          targetSelector: "#replay-chart-box",
          checkSelector: "#replay-chart-box svg",
          onlyIfClipped: true,
          durationMs: 3600,
          apply: function () {
            if (STATE.tab !== "replay" || STATE.replayMode !== "latest") {
              STATE.replayMode = "latest";
              switchTab("replay");
            }
          },
        },
      ],
    },
  ];

  const TUT = {
    active: false,
    playing: false,
    completed: false,
    stageIndex: 0,
    phaseIndex: 0,
    activePhases: [],
    runToken: 0,
    timerId: null,
    resizeTimerId: null,
    userScrolledAway: false,
    programmaticScrollUntil: 0,
    savedManualState: null,
    savedScrollY: 0,
    highlightedEl: null,
  };

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function clearTutorialTimers() {
    if (TUT.timerId !== null) {
      clearTimeout(TUT.timerId);
      TUT.timerId = null;
    }
  }

  function clearHighlight() {
    if (TUT.highlightedEl) {
      TUT.highlightedEl.classList.remove("tut-target-highlight");
      TUT.highlightedEl = null;
    }
  }

  function getDockBottom() {
    const dock = document.getElementById("tutorialDock");
    if (!dock || dock.hidden) return 0;
    const r = dock.getBoundingClientRect();
    return Math.max(0, Math.round(r.bottom));
  }

  function isElementFullyInClearViewport(selector) {
    if (!selector) return false;
    const el = document.querySelector(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const dockBot = getDockBottom();
    return r.height > 0 && r.top >= dockBot - 1 && r.bottom <= window.innerHeight + 1;
  }

  function resolveSelectorForPhase(phase) {
    if (!phase) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (phase.desktopSelector) {
      const el = document.querySelector(phase.desktopSelector);
      const dockBot = getDockBottom();
      if (el && el.getBoundingClientRect().height <= (h - dockBot - 12)) {
        return phase.desktopSelector;
      }
      if (w >= 980 && h >= 620) {
        return phase.desktopSelector;
      }
    }
    if (phase.compactSelector && w < 980 && h < 600) {
      if (document.querySelector(phase.compactSelector)) return phase.compactSelector;
    }
    return phase.targetSelector;
  }

  function resolveActivePhasesForStage(stage) {
    const all = stage.phases || [];
    if (all.length <= 1) return all.slice();
    const out = [all[0]];
    for (let i = 1; i < all.length; i++) {
      const ph = all[i];
      if (!ph.onlyIfClipped) {
        out.push(ph);
      } else {
        const checkSel = ph.checkSelector || ph.targetSelector;
        if (!isElementFullyInClearViewport(checkSel)) {
          out.push(ph);
        }
      }
    }
    return out;
  }

  function currentPhase() {
    if (TUT.activePhases && TUT.activePhases[TUT.phaseIndex]) {
      return TUT.activePhases[TUT.phaseIndex];
    }
    const st = TUTORIAL_STAGES[TUT.stageIndex];
    return (st && st.phases && st.phases[0]) || null;
  }

  function syncTutorialEntryButtons() {
    const btnHeader = document.getElementById("btnWatchTutorial");
    if (btnHeader) btnHeader.hidden = TUT.active;
    const btnOverview = document.getElementById("btnOvStartTour");
    if (btnOverview) btnOverview.hidden = TUT.active;
  }

  function updateTutorialChrome() {
    const dock = document.getElementById("tutorialDock");
    const badge = document.getElementById("tutStepBadge");
    const title = document.getElementById("tutStageTitle");
    const phasePills = document.getElementById("tutPhasePills");
    const narration = document.getElementById("tutNarration");
    const scrollNote = document.getElementById("tutScrollNote");
    const fill = document.getElementById("tutProgressFill");
    const btnPrev = document.getElementById("btnTutPrev");
    const btnPlay = document.getElementById("btnTutPlayPause");
    const btnNext = document.getElementById("btnTutNext");
    const btnRestart = document.getElementById("btnTutRestart");

    syncTutorialEntryButtons();
    if (!dock) return;
    dock.hidden = !TUT.active;
    if (!TUT.active) return;

    const st = TUTORIAL_STAGES[TUT.stageIndex];
    const ph = currentPhase();
    badge.textContent = "Step " + (TUT.stageIndex + 1) + " of " + TUTORIAL_STAGES.length;
    title.textContent = st.title;
    narration.textContent = ph ? ph.narration : "";
    if (scrollNote) scrollNote.hidden = !TUT.userScrolledAway;

    if (phasePills) {
      if (TUT.activePhases.length > 1) {
        phasePills.hidden = false;
        phasePills.innerHTML = TUT.activePhases.map((p, idx) =>
          '<button type="button" class="tut-phase-btn" data-tut-phase="' + idx + '"' +
          (idx === TUT.phaseIndex ? ' aria-current="step"' : "") + ">" +
          esc(p.label || ("View " + (idx + 1))) + "</button>"
        ).join("");
        phasePills.querySelectorAll("[data-tut-phase]").forEach((btn) => {
          btn.addEventListener("click", () => {
            goToPhase(Number(btn.dataset.tutPhase), true);
          });
        });
      } else {
        phasePills.hidden = true;
        phasePills.innerHTML = "";
      }
    }

    const phaseFrac = TUT.activePhases.length > 0 ? (TUT.phaseIndex + 1) / TUT.activePhases.length : 1;
    const totalPct = ((TUT.stageIndex + phaseFrac) / TUTORIAL_STAGES.length) * 100;
    if (fill) fill.style.width = Math.min(100, totalPct).toFixed(1) + "%";

    btnPrev.disabled = TUT.stageIndex <= 0;
    btnNext.disabled = TUT.stageIndex >= TUTORIAL_STAGES.length - 1;
    if (TUT.completed) {
      btnPlay.textContent = "Replay";
      btnPlay.setAttribute("aria-label", "Replay walkthrough from start");
    } else if (TUT.playing) {
      btnPlay.textContent = "Pause";
      btnPlay.setAttribute("aria-label", "Pause walkthrough");
    } else {
      btnPlay.textContent = "Play";
      btnPlay.setAttribute("aria-label", "Resume walkthrough");
    }
    if (btnRestart) btnRestart.textContent = TUT.completed ? "Replay" : "Restart";
  }

  function scrollTargetIntoView(selector, force, instant) {
    if (!TUT.active || (!force && TUT.userScrolledAway)) return;
    const target = selector ? document.querySelector(selector) : null;
    clearHighlight();
    if (!target) return;
    target.classList.add("tut-target-highlight");
    TUT.highlightedEl = target;

    const dockBot = getDockBottom();
    const rect = target.getBoundingClientRect();
    const desiredTop = dockBot + 10;
    const availH = Math.max(80, window.innerHeight - desiredTop - 8);
    const fitsFully = rect.height <= availH;
    const alreadyGood = fitsFully
      ? (rect.top >= dockBot + 4 && rect.bottom <= window.innerHeight - 4)
      : (Math.abs(rect.top - desiredTop) <= 12);

    if (!alreadyGood) {
      const targetY = Math.max(0, Math.round(window.scrollY + rect.top - desiredTop));
      TUT.programmaticScrollUntil = Date.now() + 700;
      window.scrollTo({
        top: targetY,
        behavior: (instant || prefersReducedMotion()) ? "auto" : "smooth",
      });
    }
  }

  function scheduleAutoAdvance(token) {
    clearTutorialTimers();
    if (!TUT.active || !TUT.playing) return;
    const ph = currentPhase();
    const dwell = (ph && ph.durationMs) || 3800;
    TUT.timerId = setTimeout(() => {
      if (!TUT.active || TUT.runToken !== token || !TUT.playing) return;
      if (TUT.phaseIndex < TUT.activePhases.length - 1) {
        goToPhase(TUT.phaseIndex + 1, false);
      } else if (TUT.stageIndex < TUTORIAL_STAGES.length - 1) {
        goToStage(TUT.stageIndex + 1, false);
      } else {
        TUT.playing = false;
        TUT.completed = true;
        updateTutorialChrome();
      }
    }, dwell);
  }

  function goToPhase(phaseIdx, resetScrollOptOut, instantScroll) {
    if (!TUT.active) return;
    const phases = TUT.activePhases;
    if (!phases || !phases.length) return;
    const clamped = Math.max(0, Math.min(phases.length - 1, phaseIdx));
    TUT.runToken += 1;
    const token = TUT.runToken;
    clearTutorialTimers();
    TUT.phaseIndex = clamped;
    TUT.completed = false;
    if (resetScrollOptOut) TUT.userScrolledAway = false;

    const ph = phases[clamped];
    if (ph.apply) ph.apply();
    updateTutorialChrome();
    const sel = resolveSelectorForPhase(ph);
    scrollTargetIntoView(sel, Boolean(resetScrollOptOut), Boolean(instantScroll));
    if (TUT.playing) scheduleAutoAdvance(token);
  }

  function goToStage(index, resetScrollOptOut) {
    if (!TUT.active) return;
    const clamped = Math.max(0, Math.min(TUTORIAL_STAGES.length - 1, index));
    TUT.runToken += 1;
    const token = TUT.runToken;
    clearTutorialTimers();
    TUT.stageIndex = clamped;
    TUT.phaseIndex = 0;
    TUT.completed = false;
    if (resetScrollOptOut) TUT.userScrolledAway = false;

    const st = TUTORIAL_STAGES[clamped];
    const firstPhase = st.phases[0];
    TUT.activePhases = [firstPhase];
    if (firstPhase && firstPhase.apply) firstPhase.apply();
    updateTutorialChrome();
    const firstSel = resolveSelectorForPhase(firstPhase);
    // Align Phase 0 instantaneously before checking which follow-up phases are clipped on this viewport
    scrollTargetIntoView(firstSel, Boolean(resetScrollOptOut), true);
    TUT.activePhases = resolveActivePhasesForStage(st);
    updateTutorialChrome();
    // Re-check top clearance in case phase pills changed dock height by a few pixels
    scrollTargetIntoView(firstSel, Boolean(resetScrollOptOut), true);
    if (TUT.playing) scheduleAutoAdvance(token);
  }

  function startTutorial() {
    if (TUT.active) return;
    TUT.savedManualState = cloneState();
    TUT.savedScrollY = window.scrollY || 0;
    TUT.active = true;
    TUT.playing = true;
    TUT.completed = false;
    TUT.userScrolledAway = false;
    goToStage(0, true);
  }

  function exitTutorial() {
    if (!TUT.active) return;
    TUT.runToken += 1;
    clearTutorialTimers();
    clearHighlight();
    TUT.active = false;
    TUT.playing = false;
    TUT.completed = false;
    TUT.userScrolledAway = false;
    TUT.activePhases = [];
    TUT.phaseIndex = 0;
    updateTutorialChrome();

    const snap = TUT.savedManualState;
    const prevY = TUT.savedScrollY;
    TUT.savedManualState = null;
    if (snap) {
      restoreState(snap);
      switchTab(STATE.tab);
    }
    TUT.programmaticScrollUntil = Date.now() + 450;
    window.scrollTo({ top: prevY, behavior: "auto" });
    const launchBtn = document.getElementById("btnWatchTutorial");
    if (launchBtn) launchBtn.focus();
  }

  function setupTutorial() {
    const btnLaunch = document.getElementById("btnWatchTutorial");
    const btnPrev = document.getElementById("btnTutPrev");
    const btnPlay = document.getElementById("btnTutPlayPause");
    const btnNext = document.getElementById("btnTutNext");
    const btnRestart = document.getElementById("btnTutRestart");
    const btnExit = document.getElementById("btnTutExit");

    if (btnLaunch) btnLaunch.addEventListener("click", startTutorial);
    if (btnPrev) btnPrev.addEventListener("click", () => goToStage(TUT.stageIndex - 1, true));
    if (btnNext) btnNext.addEventListener("click", () => goToStage(TUT.stageIndex + 1, true));
    if (btnRestart) {
      btnRestart.addEventListener("click", () => {
        TUT.playing = true;
        TUT.completed = false;
        goToStage(0, true);
      });
    }
    if (btnPlay) {
      btnPlay.addEventListener("click", () => {
        if (!TUT.active) return;
        if (TUT.completed) {
          TUT.playing = true;
          TUT.completed = false;
          goToStage(0, true);
          return;
        }
        TUT.playing = !TUT.playing;
        TUT.runToken += 1;
        clearTutorialTimers();
        updateTutorialChrome();
        if (TUT.playing) scheduleAutoAdvance(TUT.runToken);
      });
    }
    if (btnExit) btnExit.addEventListener("click", exitTutorial);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && TUT.active) {
        ev.preventDefault();
        exitTutorial();
      }
    });

    window.addEventListener("scroll", () => {
      if (!TUT.active) return;
      if (Date.now() < TUT.programmaticScrollUntil) return;
      if (!TUT.userScrolledAway) {
        TUT.userScrolledAway = true;
        updateTutorialChrome();
      }
    }, { passive: true });

    window.addEventListener("resize", () => {
      if (STATE.tab === "overview") renderOverview();
      if (STATE.tab === "replay") renderReplay();
      if (!TUT.active) return;
      if (TUT.resizeTimerId !== null) clearTimeout(TUT.resizeTimerId);
      TUT.programmaticScrollUntil = Date.now() + 800;
      TUT.resizeTimerId = setTimeout(() => {
        TUT.resizeTimerId = null;
        if (!TUT.active) return;
        const st = TUTORIAL_STAGES[TUT.stageIndex];
        const prevPhaseId = (currentPhase() && currentPhase().id) || null;
        if (STATE.tab === "overview") renderOverview();
        if (STATE.tab === "replay") renderReplay();
        TUT.activePhases = resolveActivePhasesForStage(st);
        const matchedIdx = TUT.activePhases.findIndex((p) => p.id === prevPhaseId);
        TUT.phaseIndex = matchedIdx >= 0 ? matchedIdx : Math.min(TUT.phaseIndex, TUT.activePhases.length - 1);
        updateTutorialChrome();
        const ph = currentPhase();
        scrollTargetIntoView(resolveSelectorForPhase(ph), false, true);
      }, 140);
    });
  }

  window.__TET_TUTORIAL__ = {
    getState: function () {
      const st = TUTORIAL_STAGES[TUT.stageIndex] || {};
      const ph = currentPhase() || {};
      return {
        active: TUT.active,
        playing: TUT.playing,
        completed: TUT.completed,
        stageIndex: TUT.stageIndex,
        stageCount: TUTORIAL_STAGES.length,
        stageId: st.id || null,
        phaseIndex: TUT.phaseIndex,
        phaseCount: TUT.activePhases.length,
        phaseId: ph.id || null,
        phaseIds: TUT.activePhases.map((p) => p.id),
        userScrolledAway: TUT.userScrolledAway,
        runToken: TUT.runToken,
        tab: STATE.tab,
        overviewTicker: STATE.overviewTicker,
        evalSubView: STATE.evalSubView,
        selectedTicker: STATE.selectedTicker,
        statementPeriod: STATE.statementPeriod,
        screenerPreset: STATE.screenerPreset,
        screenerPeriodMode: STATE.screenerPeriodMode,
        replayMode: STATE.replayMode,
        treasuryIdx: STATE.treasuryIdx,
      };
    },
    goToStage: function (idx) {
      if (TUT.active) goToStage(idx, true);
    },
    goToPhase: function (idx) {
      if (TUT.active) goToPhase(idx, true, true);
    },
    start: startTutorial,
    exit: exitTutorial,
  };

  setupTabs();
  setupTutorial();
  renderOverview();
})();
