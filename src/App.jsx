import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "btc-treasury-v1";

const WEIGHTS = { mvrv: 3, powerLaw: 3, sma200w: 2, puell: 2, lth: 1, rsi: 1 };

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Serif+Display:ital@0;1&display=swap');`;

const DEFAULT_LOANS = [
  { id: 1, lender: "Nexo", debt: 10000, collateral: 0.5 },
  { id: 2, lender: "Ledn", debt: 45000, collateral: 1.2 },
  { id: 3, lender: "Lava", debt: 80000, collateral: 2.1 },
];

const DEFAULT_MANUAL = { mvrv: 0.26, puell: 1.1, lthTrend: "Accumulating" };

function scoreMVRV(v, w) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  if (n < 1.0) return w;
  if (n > 6) return -w;
  return 0;
}
function scorePowerLaw(v, w) {
  if (v === "Floor") return w;
  if (v === "Top") return -w;
  return 0;
}
function scorePuell(v, w) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  if (n < 0.5) return w;
  if (n > 4) return -w;
  return 0;
}
function score200wSMA(price, sma, w) {
  if (!price || !sma) return 0;
  if (price <= sma) return w;
  if (price >= sma * 2.5) return -w;
  return 0;
}
function scoreLTH(v, w) {
  if (v === "Accumulating") return w;
  if (v === "Dumping") return -w;
  return 0;
}
function scoreRSI(v, w) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  if (n < 30) return w;
  if (n > 85) return -w;
  return 0;
}

function calcPowerLawPrice(date) {
  const genesis = new Date("2009-01-03");
  const days = (date - genesis) / (1000 * 60 * 60 * 24);
  return Math.pow(10, 5.84 * Math.log10(days) - 17.01);
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function getAdvice(score, maxLtv) {
  if (maxLtv >= 0.5) return {
    level: "emergency",
    title: "Emergency Debt Priority",
    body: "At least one loan has exceeded the 50% danger threshold. Route all incoming cash to pay down that loan balance immediately.",
    color: "#B03A2E",
    bg: "#FDF2F1",
    border: "#E8A99A",
    badge: { bg: "#B03A2E", text: "#fff" }
  };
  if (maxLtv > 0.35) return {
    level: "caution",
    title: "Reduce LTV First",
    body: "Split allocation: continue light DCA while directing surplus cash to safely drift LTV below 35%.",
    color: "#B7770D",
    bg: "#FEFAEF",
    border: "#EDD28A",
    badge: { bg: "#B7770D", text: "#fff" }
  };
  if (score >= 10) return {
    level: "aggressive",
    title: "Generational Buying Signal",
    body: "Maximum macro value. Aggressive accumulation warranted. Formidable multi-year risk-reward window.",
    color: "#0E6655",
    bg: "#EDFAF7",
    border: "#7DCEA0",
    badge: { bg: "#0E6655", text: "#fff" }
  };
  if (score >= 3) return {
    level: "accumulate",
    title: "Standard DCA Mode",
    body: "Value zone confirmed. Accumulate spot assets steadily. Your debt framework is secure.",
    color: "#1A5276",
    bg: "#EBF5FB",
    border: "#85C1E9",
    badge: { bg: "#1A5276", text: "#fff" }
  };
  if (score >= 0) return {
    level: "hold",
    title: "Hold Steady",
    body: "No major structural signals triggered. Maintain positions and monitor indicators.",
    color: "#555",
    bg: "#F9F8F5",
    border: "#D5D4D0",
    badge: { bg: "#6B6B67", text: "#fff" }
  };
  return {
    level: "trim",
    title: "Strategic Trim Window",
    body: "Market is frothy. Pause DCA. If carrying debt, consider trimming peak equity to force LTV down.",
    color: "#6C3483",
    bg: "#F9F3FC",
    border: "#C39BD3",
    badge: { bg: "#6C3483", text: "#fff" }
  };
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}
function fmtUSD(n) {
  if (!n) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function App() {
  const [btcPrice, setBtcPrice] = useState(null);
  const [athPrice, setAthPrice] = useState(108000);
  const [sma200w, setSma200w] = useState(null);
  const [weeklyRsi, setWeeklyRsi] = useState(null);
  const [powerLawPrice, setPowerLawPrice] = useState(null);
  const [powerLawPos, setPowerLawPos] = useState("Mid");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [manual, setManual] = useState(DEFAULT_MANUAL);
  const [loans, setLoans] = useState(DEFAULT_LOANS);
  const [nextId, setNextId] = useState(4);
  const [editingLoan, setEditingLoan] = useState(null);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [newLoan, setNewLoan] = useState({ lender: "", debt: "", collateral: "" });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.loans) setLoans(d.loans);
        if (d.manual) setManual(d.manual);
        if (d.nextId) setNextId(d.nextId);
      }
    } catch (e) {}
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ loans, manual, nextId }));
    } catch (e) {}
  }, [loans, manual, nextId, dataLoaded]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setFetchError(false);
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1500&interval=daily"
        );
        const data = await res.json();
        const prices = data.prices;
        if (!prices || prices.length < 200) throw new Error("Not enough data");

        const closes = prices.map((p) => p[1]);
        const latestPrice = closes[closes.length - 1];
        setBtcPrice(latestPrice);

        const allTimeHigh = Math.max(...closes);
        setAthPrice(allTimeHigh);

        const weekly = [];
        for (let i = 0; i < closes.length; i += 7) weekly.push(closes[i]);
        const last200w = closes.slice(-1400);
        const sma = last200w.reduce((a, b) => a + b, 0) / last200w.length;
        setSma200w(sma);

        const weeklyCloses = [];
        for (let i = 6; i < closes.length; i += 7) weeklyCloses.push(closes[i]);
        const rsi = calcRSI(weeklyCloses, 14);
        setWeeklyRsi(rsi);

        const plPrice = calcPowerLawPrice(new Date());
        setPowerLawPrice(plPrice);
        const ratio = latestPrice / plPrice;
        if (ratio < 0.8) setPowerLawPos("Floor");
        else if (ratio > 3.5) setPowerLawPos("Top");
        else setPowerLawPos("Mid");

        setLastUpdated(new Date());
      } catch (e) {
        setFetchError(true);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const scores = {
    mvrv: scoreMVRV(manual.mvrv, WEIGHTS.mvrv),
    powerLaw: scorePowerLaw(powerLawPos, WEIGHTS.powerLaw),
    puell: scorePuell(manual.puell, WEIGHTS.puell),
    sma200w: score200wSMA(btcPrice, sma200w, WEIGHTS.sma200w),
    lth: scoreLTH(manual.lthTrend, WEIGHTS.lth),
    rsi: scoreRSI(weeklyRsi, WEIGHTS.rsi),
  };
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
  const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
  const portfolioLtv = btcPrice && totalCollateral > 0 ? totalDebt / (totalCollateral * btcPrice) : 0;
  const loanLtvs = loans.map((l) => {
    const debt = parseFloat(l.debt) || 0;
    const coll = parseFloat(l.collateral) || 0;
    return btcPrice && coll > 0 ? debt / (coll * btcPrice) : 0;
  });
  const maxLtv = loanLtvs.length > 0 ? Math.max(...loanLtvs) : 0;

  const advice = getAdvice(totalScore, maxLtv);

  const maxScore = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const minScore = -maxScore;
  const scorePct = ((totalScore - minScore) / (maxScore - minScore)) * 100;

  const distFromATH = btcPrice && athPrice ? ((btcPrice - athPrice) / athPrice) : null;
  const athRecoveryPct = btcPrice && athPrice ? (btcPrice / athPrice) : null;

  const indicators = [
    { label: "MVRV Z-Score", value: manual.mvrv || "—", score: scores.mvrv, auto: false },
    { label: "Power Law", value: powerLawPos, score: scores.powerLaw, auto: true },
    { label: "200W SMA", value: sma200w ? fmtUSD(Math.round(sma200w)) : "—", score: scores.sma200w, auto: true },
    { label: "Puell Multiple", value: manual.puell || "—", score: scores.puell, auto: false },
    { label: "LTH Supply Trend", value: manual.lthTrend, score: scores.lth, auto: false },
    { label: "Weekly RSI", value: weeklyRsi ? weeklyRsi.toFixed(1) : "—", score: scores.rsi, auto: true },
  ];

  function handleDeleteLoan(id) {
    setLoans(loans.filter((l) => l.id !== id));
  }

  function handleAddLoan() {
    if (!newLoan.lender || !newLoan.debt || !newLoan.collateral) return;
    setLoans([...loans, { id: nextId, lender: newLoan.lender, debt: parseFloat(newLoan.debt), collateral: parseFloat(newLoan.collateral) }]);
    setNextId(nextId + 1);
    setNewLoan({ lender: "", debt: "", collateral: "" });
    setShowAddLoan(false);
  }

  function handleSaveLoan() {
    if (!editingLoan) return;
    setLoans(loans.map((l) => l.id === editingLoan.id ? { ...editingLoan, debt: parseFloat(editingLoan.debt), collateral: parseFloat(editingLoan.collateral) } : l));
    setEditingLoan(null);
  }

  const ltvBarColor = (ltv) => {
    if (ltv >= 0.5) return "#C0392B";
    if (ltv >= 0.35) return "#D68910";
    return "#1A6B3A";
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F9F8F5", color: "#1C1C1A" }}>
      <style>{FONTS}</style>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { font-family: 'DM Sans', sans-serif; }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 16px; border-radius: 6px; color: #888; letter-spacing: 0.04em; transition: all 0.15s; }
        .tab-btn.active { background: #fff; color: #1C1C1A; font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .tab-btn:hover:not(.active) { color: #444; }
        .ind-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 0.5px solid #EBEBEB; }
        .ind-row:last-child { border-bottom: none; }
        .score-chip { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 22px; border-radius: 4px; font-size: 12px; font-weight: 500; }
        .metric-card { background: #fff; border: 0.5px solid #E8E7E4; border-radius: 12px; padding: 18px 20px; }
        .loan-row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 0.5px solid #EBEBEB; }
        .loan-row:last-child { border-bottom: none; }
        .btn-ghost { background: none; border: 0.5px solid #DDD; border-radius: 6px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 5px 12px; color: #666; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #AAA; color: #333; }
        .btn-primary { background: #1C1C1A; border: none; border-radius: 6px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 18px; color: #fff; font-weight: 500; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.85; }
        .inp { border: 0.5px solid #DDD; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: 'DM Sans', sans-serif; width: 100%; color: #1C1C1A; background: #fff; outline: none; }
        .inp:focus { border-color: #999; }
        .sel { border: 0.5px solid #DDD; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: 'DM Sans', sans-serif; background: #fff; color: #1C1C1A; outline: none; }
        .ltv-bar-bg { background: #F0EFEC; border-radius: 3px; height: 4px; width: 100%; margin-top: 4px; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "0.5px solid #E8E7E4", background: "#fff", padding: "0 24px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 19, color: "#1C1C1A", letterSpacing: "-0.02em" }}>Treasury</span>
            <span style={{ fontSize: 11, color: "#C8963A", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>BTC</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {loading ? (
              <span className="pulse" style={{ fontSize: 12, color: "#AAA" }}>Fetching data…</span>
            ) : fetchError ? (
              <span style={{ fontSize: 12, color: "#C0392B" }}>Live data unavailable</span>
            ) : (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 500, color: "#1C1C1A", letterSpacing: "-0.02em" }}>
                  {btcPrice ? fmtUSD(Math.round(btcPrice)) : "—"}
                </div>
                {distFromATH !== null && (
                  <div style={{ fontSize: 11, color: distFromATH >= 0 ? "#1A6B3A" : "#888" }}>
                    {distFromATH >= 0 ? "+" : ""}{(distFromATH * 100).toFixed(1)}% from ATH
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: "#F9F8F5", padding: "12px 24px 0", borderBottom: "0.5px solid #E8E7E4" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", background: "#EFEFEC", borderRadius: 8, padding: 3, gap: 2 }}>
            {["dashboard", "loans", "indicators"].map((t) => (
              <button key={t} className={`tab-btn${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px 60px" }} className="fade-in">

        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* ATH Distance Bar */}
            {distFromATH !== null && (
              <div style={{ background: "#fff", border: "0.5px solid #E8E7E4", borderRadius: 12, padding: "16px 24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Distance from All-Time High</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{
                      fontFamily: "'DM Serif Display', serif",
                      fontSize: 22,
                      letterSpacing: "-0.02em",
                      color: distFromATH >= -0.1 ? "#0E6655" : distFromATH >= -0.3 ? "#B7770D" : distFromATH >= -0.5 ? "#B03A2E" : "#7B241C"
                    }}>
                      {distFromATH >= 0 ? "ATH" : (distFromATH * 100).toFixed(1) + "%"}
                    </span>
                    <span style={{ fontSize: 12, color: "#AAA" }}>
                      {fmtUSD(Math.round(btcPrice))} / ATH {fmtUSD(Math.round(athPrice))}
                    </span>
                  </div>
                </div>
                <div style={{ position: "relative", height: 6, background: "#F0EFEC", borderRadius: 4 }}>
                  <div style={{
                    position: "absolute", left: 0, top: 0, height: "100%",
                    width: `${Math.min(100, Math.max(2, (athRecoveryPct || 0) * 100))}%`,
                    borderRadius: 4,
                    background: distFromATH >= -0.1 ? "#0E6655" : distFromATH >= -0.3 ? "#D4AC0D" : distFromATH >= -0.5 ? "#C0392B" : "#922B21",
                    transition: "width 0.6s ease"
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                  <span style={{ fontSize: 10, color: "#CCC" }}>0%</span>
                  <div style={{ display: "flex", gap: 16 }}>
                    {["-50%", "-25%", "ATH"].map((label, i) => (
                      <span key={label} style={{ fontSize: 10, color: "#CCC" }}>{label}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Advice Banner */}
            <div style={{ background: advice.bg, border: `0.5px solid ${advice.border}`, borderLeft: `3px solid ${advice.color}`, borderRadius: 12, padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{
                      display: "inline-block",
                      background: advice.badge.bg,
                      color: advice.badge.text,
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      padding: "3px 9px",
                      borderRadius: 4
                    }}>{advice.title}</span>
                  </div>
                  <div style={{ fontSize: 15, color: "#3A3A38", lineHeight: 1.6, maxWidth: 520 }}>{advice.body}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 36, color: advice.color, lineHeight: 1, letterSpacing: "-0.03em" }}>
                    {totalScore > 0 ? "+" : ""}{totalScore}
                  </div>
                  <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 2 }}>Macro Score</div>
                </div>
              </div>
              {/* Score bar */}
              <div style={{ marginTop: 16 }}>
                <div style={{ background: `${advice.color}22`, borderRadius: 3, height: 3, position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.max(2, Math.min(100, scorePct))}%`, background: advice.color, borderRadius: 3, transition: "width 0.6s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: "#B03A2E" }}>Bear</span>
                  <span style={{ fontSize: 10, color: "#0E6655" }}>Bull</span>
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div className="metric-card">
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Portfolio LTV</div>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, letterSpacing: "-0.03em", color: ltvBarColor(portfolioLtv) }}>{fmtPct(portfolioLtv)}</div>
                <div style={{ marginTop: 8 }}>
                  <div className="ltv-bar-bg">
                    <div style={{ height: 4, width: `${Math.min(100, portfolioLtv * 100)}%`, background: ltvBarColor(portfolioLtv), borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>
              <div className="metric-card">
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Total Debt</div>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, letterSpacing: "-0.03em" }}>{fmtUSD(totalDebt)}</div>
                <div style={{ fontSize: 12, color: "#AAA", marginTop: 6 }}>{loans.length} active loan{loans.length !== 1 ? "s" : ""}</div>
              </div>
              <div className="metric-card">
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Collateral</div>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, letterSpacing: "-0.03em" }}>{fmt(totalCollateral, 2)} <span style={{ fontSize: 14, color: "#AAA" }}>BTC</span></div>
                <div style={{ fontSize: 12, color: "#AAA", marginTop: 6 }}>{btcPrice ? fmtUSD(Math.round(totalCollateral * btcPrice)) : "—"}</div>
              </div>
              <div className="metric-card">
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Highest LTV</div>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, letterSpacing: "-0.03em", color: ltvBarColor(maxLtv) }}>{fmtPct(maxLtv)}</div>
                <div style={{ fontSize: 12, color: maxLtv >= 0.5 ? "#C0392B" : maxLtv >= 0.35 ? "#D68910" : "#AAA", marginTop: 6 }}>
                  {maxLtv >= 0.5 ? "⚠ Danger zone" : maxLtv >= 0.35 ? "Caution" : "Healthy"}
                </div>
              </div>
            </div>

            {/* Indicator Summary */}
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>Indicators at a Glance</div>
              {indicators.map((ind) => (
                <div key={ind.label} className="ind-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "#1C1C1A" }}>{ind.label}</span>
                    {ind.auto && <span style={{ fontSize: 10, color: "#C8963A", background: "#FDF3E3", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.04em" }}>AUTO</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#888", fontVariantNumeric: "tabular-nums" }}>{String(ind.value)}</span>
                    <span className="score-chip" style={{
                      background: ind.score > 0 ? "#E8F5ED" : ind.score < 0 ? "#FDECEA" : "#F4F3F0",
                      color: ind.score > 0 ? "#1A6B3A" : ind.score < 0 ? "#C0392B" : "#888"
                    }}>
                      {ind.score > 0 ? "+" : ""}{ind.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {lastUpdated && (
              <div style={{ fontSize: 11, color: "#CCC", textAlign: "center" }}>
                Auto data last fetched {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* LOANS TAB */}
        {activeTab === "loans" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="metric-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Active Loans</div>
                <button className="btn-ghost" onClick={() => setShowAddLoan(!showAddLoan)}>+ Add Loan</button>
              </div>

              {showAddLoan && (
                <div style={{ background: "#F9F8F5", border: "0.5px solid #E8E7E4", borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Lender</div>
                      <input className="inp" placeholder="e.g. Nexo" value={newLoan.lender} onChange={e => setNewLoan({ ...newLoan, lender: e.target.value })} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Debt (USD)</div>
                      <input className="inp" placeholder="0.00" type="number" value={newLoan.debt} onChange={e => setNewLoan({ ...newLoan, debt: e.target.value })} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Collateral (BTC)</div>
                      <input className="inp" placeholder="0.00" type="number" value={newLoan.collateral} onChange={e => setNewLoan({ ...newLoan, collateral: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-primary" onClick={handleAddLoan}>Save Loan</button>
                    <button className="btn-ghost" onClick={() => setShowAddLoan(false)}>Cancel</button>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto", gap: 12, padding: "0 0 8px", borderBottom: "0.5px solid #EBEBEB", marginBottom: 4 }}>
                {["Lender", "Debt", "Collateral", "LTV", ""].map((h) => (
                  <div key={h} style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.04em" }}>{h}</div>
                ))}
              </div>

              {loans.map((loan, i) => {
                const ltv = loanLtvs[i];
                const isEditing = editingLoan?.id === loan.id;
                return (
                  <div key={loan.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: "0.5px solid #F4F3F0" }}>
                    {isEditing ? (
                      <>
                        <input className="inp" value={editingLoan.lender} onChange={e => setEditingLoan({ ...editingLoan, lender: e.target.value })} />
                        <input className="inp" type="number" value={editingLoan.debt} onChange={e => setEditingLoan({ ...editingLoan, debt: e.target.value })} />
                        <input className="inp" type="number" value={editingLoan.collateral} onChange={e => setEditingLoan({ ...editingLoan, collateral: e.target.value })} />
                        <div style={{ fontSize: 13, color: ltvBarColor(ltv), fontWeight: 500 }}>{fmtPct(ltv)}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn-primary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={handleSaveLoan}>Save</button>
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setEditingLoan(null)}>✕</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{loan.lender}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>{fmtUSD(loan.debt)}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>{fmt(loan.collateral, 3)} BTC</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: ltvBarColor(ltv) }}>{fmtPct(ltv)}</div>
                          <div className="ltv-bar-bg" style={{ width: 60 }}>
                            <div style={{ height: 4, width: `${Math.min(100, ltv * 100)}%`, background: ltvBarColor(ltv), borderRadius: 3, transition: "width 0.5s" }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setEditingLoan({ ...loan })}>Edit</button>
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "#C0392B", borderColor: "#F4C0C0" }} onClick={() => handleDeleteLoan(loan.id)}>✕</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {loans.length === 0 && (
                <div style={{ textAlign: "center", padding: "32px 0", color: "#CCC", fontSize: 14 }}>No loans. Add one above.</div>
              )}

              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "0.5px solid #EBEBEB", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#888" }}>Total outstanding</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{fmtUSD(totalDebt)}</span>
              </div>
              <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#888" }}>Portfolio LTV</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: ltvBarColor(portfolioLtv) }}>{fmtPct(portfolioLtv)}</span>
              </div>
            </div>
          </div>
        )}

        {/* INDICATORS TAB */}
        {activeTab === "indicators" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Automatic Indicators</div>
              <div style={{ fontSize: 12, color: "#C8963A", marginBottom: 16 }}>Pulled from CoinGecko — updates on page load</div>
              {[
                { label: "BTC Price", value: btcPrice ? fmtUSD(Math.round(btcPrice)) : "—" },
                { label: "200W SMA", value: sma200w ? fmtUSD(Math.round(sma200w)) : "—" },
                { label: "Weekly RSI (14)", value: weeklyRsi ? weeklyRsi.toFixed(2) : "—" },
                { label: "Power Law Price", value: powerLawPrice ? fmtUSD(Math.round(powerLawPrice)) : "—" },
                { label: "Power Law Position", value: powerLawPos },
              ].map((r) => (
                <div key={r.label} className="ind-row">
                  <span style={{ fontSize: 14 }}>{r.label}</span>
                  <span style={{ fontSize: 13, color: "#555", fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
                </div>
              ))}
            </div>

            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Manual Indicators</div>
              <div style={{ fontSize: 12, color: "#AAA", marginBottom: 16 }}>Update weekly from Glassnode, CryptoQuant, or similar</div>

              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>MVRV Z-Score <span style={{ color: "#CCC" }}>(current: {manual.mvrv})</span></div>
                  <input className="inp" type="number" step="0.01" value={manual.mvrv} onChange={e => setManual({ ...manual, mvrv: e.target.value })} style={{ maxWidth: 180 }} />
                  <div style={{ fontSize: 11, color: "#CCC", marginTop: 4 }}>Bullish &lt; 1.0 · Bearish &gt; 6.0</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Puell Multiple <span style={{ color: "#CCC" }}>(current: {manual.puell})</span></div>
                  <input className="inp" type="number" step="0.01" value={manual.puell} onChange={e => setManual({ ...manual, puell: e.target.value })} style={{ maxWidth: 180 }} />
                  <div style={{ fontSize: 11, color: "#CCC", marginTop: 4 }}>Bullish &lt; 0.5 · Bearish &gt; 4.0</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>LTH Supply Trend</div>
                  <select className="sel" value={manual.lthTrend} onChange={e => setManual({ ...manual, lthTrend: e.target.value })}>
                    <option value="Accumulating">Accumulating</option>
                    <option value="Neutral">Neutral</option>
                    <option value="Dumping">Dumping</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>Indicator Weights</div>
              {Object.entries(WEIGHTS).map(([k, w]) => {
                const labels = { mvrv: "MVRV Z-Score", powerLaw: "Power Law", sma200w: "200W SMA", puell: "Puell Multiple", lth: "LTH Supply Trend", rsi: "Weekly RSI" };
                const maxW = 3;
                return (
                  <div key={k} className="ind-row">
                    <span style={{ fontSize: 14 }}>{labels[k]}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3].map((dot) => (
                        <div key={dot} style={{ width: 8, height: 8, borderRadius: "50%", background: dot <= w ? "#1C1C1A" : "#E8E7E4" }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
