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
    color: "#7B2D2D",
    bg: "#FBF2F2",
    border: "#D4A8A8",
    badge: { bg: "#7B2D2D", text: "#fff" }
  };
  if (maxLtv > 0.35) return {
    level: "caution",
    title: "Reduce LTV First",
    body: "Split allocation: continue light DCA while directing surplus cash to safely drift LTV below 35%.",
    color: "#8B6914",
    bg: "#FBF8EF",
    border: "#D4BC7A",
    badge: { bg: "#8B6914", text: "#fff" }
  };
  if (score >= 10) return {
    level: "aggressive",
    title: "Generational Buying Signal",
    body: "Maximum macro value. Aggressive accumulation warranted. Formidable multi-year risk-reward window.",
    color: "#2D5A3D",
    bg: "#F2F8F4",
    border: "#8FBD9E",
    badge: { bg: "#2D5A3D", text: "#fff" }
  };
  if (score >= 3) return {
    level: "accumulate",
    title: "Standard DCA Mode",
    body: "Value zone confirmed. Accumulate spot assets steadily. Your debt framework is secure.",
    color: "#1E3F5A",
    bg: "#F2F6FA",
    border: "#8AAEC8",
    badge: { bg: "#1E3F5A", text: "#fff" }
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


function getTreasuryRisk(portfolioLtv, maxLtv) {
  const dominant = Math.max(portfolioLtv, maxLtv);
  if (dominant >= 0.50) return { label: "Danger Zone", action: "Immediate Attention Required", situation: "Your portfolio LTV has entered the danger threshold.", why: "A modest further decline in BTC price could trigger forced liquidation by your lender, resulting in loss of collateral.", what: "Prioritise debt reduction or add collateral immediately. This takes precedence over any accumulation activity.", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4 };
  if (dominant >= 0.40) return { label: "Elevated Risk", action: "Reduce Risk", situation: "Collateral coverage is thinning as LTV approaches the danger zone.", why: "A 20-25% decline in BTC price from here would push your position into dangerous territory. The margin for error is narrow.", what: "Consider paying down the highest-LTV loan or adding collateral to create a more comfortable buffer before deploying further capital.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3 };
  if (dominant >= 0.30) return { label: "Moderate Risk", action: "Monitor Closely", situation: "Leverage is within acceptable bounds but deserves attention.", why: "Your collateral structure can absorb moderate price weakness, but a sustained drawdown would erode your buffer meaningfully.", what: "No immediate intervention required. Review if BTC declines more than 15-20% from current levels.", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090", badge: { bg: "#7A6830", text: "#FAF8F5" }, level: 2 };
  if (dominant >= 0.20) return { label: "Safe", action: "Maintain Structure", situation: "Debt and collateral levels are well-balanced.", why: "Your current LTV provides a healthy buffer against price volatility. The portfolio is structured conservatively.", what: "No action required. Continue your existing strategy and review when market conditions or loan balances change materially.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 1 };
  return { label: "Very Safe", action: "Collateral Efficiency Opportunity", situation: "Portfolio leverage is substantially below optimal levels.", why: "You are holding more collateral than your current debt requires. This capital could be working harder within a still-conservative risk profile.", what: "You may be able to safely release collateral or increase debt capacity while remaining well within safe LTV thresholds.", color: "#1E3F5A", bg: "#F2F6FA", border: "#8AAEC8", badge: { bg: "#1E3F5A", text: "#FAF8F5" }, level: 0 };
}

function getValuation(score) {
  if (score <= -6) return { label: "Generational Opportunity", body: "Multiple indicators signal extreme undervaluation. Historically rare entry conditions.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 0 };
  if (score <= 0) return { label: "Accumulation Zone", body: "Below fair value. Favourable conditions for systematic accumulation.", color: "#4A7C5A", bg: "#F4F9F5", border: "#A0C8AD", badge: { bg: "#4A7C5A", text: "#FAF8F5" }, level: 1 };
  if (score <= 4) return { label: "Fair Value", body: "Bitcoin is trading near historically fair value. No strong directional signal.", color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC", badge: { bg: "#4A4845", text: "#FAF8F5" }, level: 2 };
  if (score <= 8) return { label: "Overvalued", body: "Elevated valuations. Consider pausing DCA and reducing leverage exposure.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3 };
  return { label: "Euphoria", body: "Extreme overvaluation signals. Historical cycle tops share these conditions.", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4 };
}
function getPrimaryAction(valuationLevel, riskLevel) {
  if (riskLevel === 4) return { action: "Reduce Debt Immediately", reason: "Liquidation risk is the immediate priority. Market conditions are irrelevant until leverage is brought under control.", confidence: "High", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
  if (riskLevel === 3) {
    if (valuationLevel <= 1) return { action: "Reduce Debt", reason: "Although Bitcoin appears undervalued, elevated leverage means liquidation risk outweighs the opportunity. Strengthen the treasury first.", confidence: "High", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
    return { action: "Reduce Debt", reason: "Leverage is elevated and market conditions do not justify maintaining current risk exposure. Prioritise debt reduction.", confidence: "High", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
  }
  if (valuationLevel === 0) {
    if (riskLevel === 0) return { action: "Accumulate Aggressively", reason: "Rare alignment: Bitcoin is deeply undervalued and your treasury structure is exceptionally strong. This is the conditions a long-term holder prepares for.", confidence: "High", color: "#1A5C38", bg: "#EDF7F2", border: "#7DC4A0" };
    if (riskLevel === 1) return { action: "Accumulate BTC", reason: "Bitcoin appears deeply undervalued and portfolio leverage remains conservative. Strong conditions for systematic accumulation.", confidence: "High", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
    return { action: "Accumulate with Caution", reason: "Bitcoin valuation is compelling but moderate leverage warrants a disciplined approach. Accumulate steadily while monitoring LTV.", confidence: "Medium", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
  }
  if (valuationLevel === 1) {
    if (riskLevel === 0) return { action: "Accumulate BTC", reason: "Bitcoin is trading below fair value and your treasury is in excellent health. Consistent accumulation is well-supported.", confidence: "High", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
    if (riskLevel === 1) return { action: "Accumulate BTC", reason: "Valuation and leverage conditions are both favourable. Continue your accumulation strategy.", confidence: "High", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
    return { action: "DCA Steadily", reason: "Bitcoin offers value but leverage warrants a measured pace. Maintain regular DCA without increasing debt exposure.", confidence: "Medium", color: "#4A7C5A", bg: "#F4F9F5", border: "#A0C8AD" };
  }
  if (valuationLevel === 2) {
    if (riskLevel <= 1) return { action: "Maintain Position", reason: "Current valuation and leverage conditions do not require portfolio changes. Hold existing positions and monitor indicators.", confidence: "Medium", color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC" };
    return { action: "Strengthen Treasury", reason: "Valuation is neutral and leverage is elevated. Reducing debt now improves resilience and future optionality.", confidence: "Medium", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090" };
  }
  if (valuationLevel === 3) {
    if (riskLevel === 0) return { action: "Strengthen Treasury", reason: "Market conditions are less attractive. Reducing leverage now improves future flexibility and positions you well for the next cycle.", confidence: "Medium", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
    if (riskLevel === 1) return { action: "Strengthen Treasury", reason: "Market conditions are less attractive and reducing leverage may improve future flexibility. Pause accumulation.", confidence: "High", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
    return { action: "Reduce Risk", reason: "Overvalued market conditions combined with elevated leverage create an unfavourable risk profile. Prioritise debt reduction.", confidence: "High", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
  }
  if (riskLevel === 0) return { action: "Consider Trimming", reason: "Extreme overvaluation signals a potential cycle top. Your treasury is strong, consider selectively reducing spot exposure.", confidence: "Medium", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
  return { action: "Reduce Risk", reason: "Euphoria-level valuations combined with meaningful leverage creates significant downside risk. Reduce debt and consider trimming.", confidence: "High", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
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
  const [scoreHistory, setScoreHistory] = useState([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.loans) setLoans(d.loans);
        if (d.manual) setManual(d.manual);
        if (d.nextId) setNextId(d.nextId);
        if (d.scoreHistory) setScoreHistory(d.scoreHistory);
      }
    } catch (e) {}
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ loans, manual, nextId, scoreHistory }));
    } catch (e) {}
  }, [loans, manual, nextId, scoreHistory, dataLoaded]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setFetchError(false);
      try {
        const res = await fetch(
          "/api/btc-data"
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


  useEffect(() => {
    if (!btcPrice || !dataLoaded) return;
    const today = new Date().toISOString().split("T")[0];
    const alreadyLogged = scoreHistory.some((h) => h.date === today);
    if (alreadyLogged) return;
    const entry = { date: today, score: totalScore, btcPrice: Math.round(btcPrice), ltv: Math.round(portfolioLtv * 1000) / 10 };
    setScoreHistory((prev) => [...prev.slice(-89), entry]);
  }, [btcPrice, dataLoaded]);

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
  const liquidationDistance = maxLtv > 0 ? Math.max(0, 1 - (maxLtv / 0.80)) : null;

  const advice = getAdvice(totalScore, maxLtv);
  const valuation = getValuation(totalScore);
  const treasuryRisk = getTreasuryRisk(portfolioLtv, maxLtv);
  const primaryAction = getPrimaryAction(valuation.level, treasuryRisk.level);

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
    if (ltv >= 0.5) return "#7B2D2D";
    if (ltv >= 0.35) return "#8B6914";
    return "#2D5A3D";
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F5F3EF", color: "#141412" }}>
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
      <div style={{ borderBottom: "0.5px solid #E2DFD8", background: "#FEFDFB", padding: "0 24px", boxShadow: "0 1px 3px rgba(20,18,14,0.04)" }}>
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
                <div style={{ fontSize: 19, fontWeight: 500, color: "#0F0E0C", letterSpacing: "-0.03em" }}>
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
      <div style={{ background: "#F5F3EF", padding: "12px 24px 0", borderBottom: "0.5px solid #E2DFD8" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", background: "#EAE8E3", borderRadius: 9, padding: 3, gap: 2 }}>
            {["dashboard", "loans", "indicators", "history"].map((t) => (
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
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* PRIMARY ACTION CARD */}
            <div style={{ background: "#1C1A17", border: "1px solid #2E2C28", borderRadius: 16, padding: "28px 28px 24px", boxShadow: "0 4px 20px rgba(20,18,14,0.18), 0 1px 4px rgba(20,18,14,0.12)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#8A8680", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, marginBottom: 8 }}>Primary Action</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 30, color: "#FAF8F5", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{primaryAction.action}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>Confidence</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                    {["Low","Medium","High"].map((lvl) => (
                      <div key={lvl} style={{ width: 28, height: 6, borderRadius: 3, background: (primaryAction.confidence === "High" || (primaryAction.confidence === "Medium" && lvl !== "High") || (primaryAction.confidence === "Low" && lvl === "Low")) ? "#FAF8F5" : "#3A3835", opacity: primaryAction.confidence === "Medium" && lvl === "High" ? 0.25 : 1 }} />
                    ))}
                    <span style={{ fontSize: 11, color: "#FAF8F5", fontWeight: 600, marginLeft: 4 }}>{primaryAction.confidence}</span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 15, color: "#D8D4CC", lineHeight: 1.65, paddingTop: 16, borderTop: "0.5px solid #2E2C28" }}>{primaryAction.reason}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16, paddingTop: 16, borderTop: "0.5px solid #2E2C28" }}>
                <div style={{ background: "#2A2825", borderRadius: 8, padding: "10px 14px", border: "0.5px solid #3A3835" }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Market Valuation</div>
                  <div style={{ fontSize: 13, color: "#FAF8F5", fontWeight: 600 }}>{valuation.label}</div>
                  <div style={{ fontSize: 11, color: "#6B6760", marginTop: 2 }}>Signal {totalScore > 0 ? "+" : ""}{totalScore}</div>
                </div>
                <div style={{ background: "#2A2825", borderRadius: 8, padding: "10px 14px", border: "0.5px solid #3A3835" }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Treasury Risk</div>
                  <div style={{ fontSize: 13, color: "#FAF8F5", fontWeight: 600 }}>{treasuryRisk.label}</div>
                  <div style={{ fontSize: 11, color: "#6B6760", marginTop: 2 }}>LTV {fmtPct(portfolioLtv)}</div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginBottom: 4 }}><span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Market Valuation</span><div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} /></div>
            <div style={{ background: valuation.bg, border: "0.5px solid "+valuation.border, borderLeft: "4px solid "+valuation.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px "+valuation.color+"14, 0 0.5px 2px rgba(20,18,14,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ display: "inline-block", background: valuation.badge.bg, color: valuation.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{valuation.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: valuation.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{totalScore > 0 ? "+" : ""}{totalScore}</span>
                  <span style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Signal</span>
                </div>
              </div>
              <div style={{ fontSize: 15, color: "#1A1816", lineHeight: 1.6, marginBottom: 16, paddingBottom: 16, borderBottom: "0.5px solid "+valuation.border }}>{valuation.body}</div>
              {(() => {
                const vzones = [{ label: "Generational\nOpportunity", color: "#1A7A4A" }, { label: "Accumulation\nZone", color: "#5BA55A" }, { label: "Fair Value", color: "#9A9590" }, { label: "Overvalued", color: "#C88A1A" }, { label: "Euphoria", color: "#A83030" }];
                const pct = Math.max(2, Math.min(98, ((totalScore + 12) / 24) * 100));
                const activeV = totalScore <= -6 ? 0 : totalScore <= 0 ? 1 : totalScore <= 4 ? 2 : totalScore <= 8 ? 3 : 4;
                return (
                  <div>
                    <div style={{ position: "relative", height: 6, display: "flex", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                      {vzones.map((z, i) => (<div key={i} style={{ flex: 1, background: z.color, opacity: i===activeV ? 0.75 : i < activeV ? 0.35 : 0.15, borderRadius: i===0?"4px 0 0 4px":i===4?"0 4px 4px 0":"0" }} />))}
                      <div style={{ position: "absolute", top: -2, left: "calc("+pct+"% - 4px)", width: 10, height: 14, borderRadius: 3, background: "#FEFDFB", border: "2px solid #1A1816", boxShadow: "0 1px 4px rgba(0,0,0,0.4)", transition: "left 0.6s ease", zIndex: 3 }} />
                    </div>
                    <div style={{ display: "flex" }}>
                      {vzones.map((z, i) => (<div key={i} style={{ flex: 1, textAlign: i===0?"left":i===4?"right":"center", fontSize: 9, color: i===activeV?z.color:"#B8B4AC", fontWeight: i===activeV?600:400, lineHeight: 1.3, whiteSpace: "pre-line" }}>{z.label}</div>))}
                    </div>
                  </div>
                );
              })()}
              {distFromATH !== null && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "0.5px solid "+valuation.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#6B6760", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 500 }}>From ATH</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 100, height: 3, background: "#EAE8E3", borderRadius: 2, position: "relative" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: Math.min(100, Math.max(2, (athRecoveryPct||0)*100))+"%", background: distFromATH >= -0.1 ? "#2D5A3D" : distFromATH >= -0.3 ? "#8B6914" : "#7B2D2D", borderRadius: 2 }} />
                    </div>
                    <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: distFromATH >= -0.1 ? "#2D5A3D" : distFromATH >= -0.3 ? "#8B6914" : "#7B2D2D", letterSpacing: "-0.02em" }}>{distFromATH >= 0 ? "At ATH" : (distFromATH*100).toFixed(1)+"%"}</span>
                    <span style={{ fontSize: 11, color: "#8A8680" }}>{fmtUSD(Math.round(btcPrice))}</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginTop: 8, marginBottom: 4 }}><span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Treasury Risk</span><div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} /></div>
            <div style={{ background: treasuryRisk.bg, border: "0.5px solid "+treasuryRisk.border, borderLeft: "4px solid "+treasuryRisk.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px "+treasuryRisk.color+"14, 0 0.5px 2px rgba(20,18,14,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ display: "inline-block", background: treasuryRisk.badge.bg, color: treasuryRisk.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{treasuryRisk.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: treasuryRisk.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{fmtPct(portfolioLtv)}</span>
                  <span style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Portfolio LTV</span>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ background: treasuryRisk.color+"0A", border: "0.5px solid "+treasuryRisk.border, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 10, color: treasuryRisk.color, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Recommended Action</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: treasuryRisk.color, letterSpacing: "-0.01em", marginBottom: 14, lineHeight: 1.2 }}>{treasuryRisk.action}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Situation</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.55 }}>{treasuryRisk.situation}</div>
                    </div>
                    <div style={{ borderTop: "0.5px solid "+treasuryRisk.border, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Why It Matters</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.55 }}>{treasuryRisk.why}</div>
                    </div>
                    <div style={{ borderTop: "0.5px solid "+treasuryRisk.border, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>What to Consider</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.55 }}>{treasuryRisk.what}</div>
                    </div>
                  </div>
                </div>
              </div>
              {(() => {
                const rzones = [{ label: "Very Safe", color: "#1E3F5A" }, { label: "Safe", color: "#2D5A3D" }, { label: "Moderate\nRisk", color: "#7A6830" }, { label: "Elevated\nRisk", color: "#8B6914" }, { label: "Danger\nZone", color: "#7B2D2D" }];
                const rPct = Math.max(2, Math.min(98, portfolioLtv * 160));
                const activeR = portfolioLtv < 0.20 ? 0 : portfolioLtv < 0.30 ? 1 : portfolioLtv < 0.40 ? 2 : portfolioLtv < 0.50 ? 3 : 4;
                return (
                  <div>
                    <div style={{ position: "relative", height: 6, display: "flex", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                      {rzones.map((z, i) => (<div key={i} style={{ flex: 1, background: z.color, opacity: i===activeR?0.65:0.18, borderRadius: i===0?"4px 0 0 4px":i===4?"0 4px 4px 0":"0" }} />))}
                      <div style={{ position: "absolute", top: -2, left: "calc("+rPct+"% - 4px)", width: 8, height: 10, borderRadius: 2, background: treasuryRisk.color, boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left 0.6s ease" }} />
                    </div>
                    <div style={{ display: "flex" }}>
                      {rzones.map((z, i) => (<div key={i} style={{ flex: 1, textAlign: i===0?"left":i===4?"right":"center", fontSize: 9, color: i===activeR?z.color:"#B8B4AC", fontWeight: i===activeR?600:400, lineHeight: 1.3, whiteSpace: "pre-line" }}>{z.label}</div>))}
                    </div>
                  </div>
                );
              })()}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "0.5px solid "+treasuryRisk.border, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Highest LTV</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: ltvBarColor(maxLtv), letterSpacing: "-0.02em" }}>{fmtPct(maxLtv)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Total Debt</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816", letterSpacing: "-0.02em" }}>{fmtUSD(totalDebt)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Liq. Distance</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: liquidationDistance !== null && liquidationDistance < 0.3 ? "#7B2D2D" : "#1A1816", letterSpacing: "-0.02em" }}>{liquidationDistance !== null ? (liquidationDistance*100).toFixed(0)+"%" : "—"}</div>
                </div>
              </div>
            </div>

            {/* Indicator Summary */}
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>Indicators at a Glance</div>
              {indicators.map((ind) => (
                <div key={ind.label} className="ind-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "#1A1816" }}>{ind.label}</span>
                    {ind.auto && <span style={{ fontSize: 10, color: "#C8963A", background: "#FDF3E3", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.04em" }}>AUTO</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#4A4845", fontVariantNumeric: "tabular-nums" }}>{String(ind.value)}</span>
                    <span className="score-chip" style={{
                      background: ind.score > 0 ? "#E8F5ED" : ind.score < 0 ? "#FDECEA" : "#F4F3F0",
                      color: ind.score > 0 ? "#2D5A3D" : ind.score < 0 ? "#7B2D2D" : "#6B6760"
                    }}>
                      {ind.score > 0 ? "+" : ""}{ind.score}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {lastUpdated && (
              <div style={{ fontSize: 11, color: "#A8A49C", textAlign: "center" }}>
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
        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Macro Score History</div>
              <div style={{ fontSize: 12, color: "#CCC", marginBottom: 20 }}>Logged automatically once per day</div>
              {scoreHistory.length < 2 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#CCC", fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>chart</div>
                  <div>Your score history will build up here day by day.</div>
                </div>
              ) : (
                <svg width="100%" height="180" viewBox="0 0 600 180" preserveAspectRatio="none">
                  {(() => {
                    const data = scoreHistory.slice(-60);
                    const maxS = 12, minS = -12;
                    const w = 600, h = 160, padL = 32, padR = 8, padT = 10, padB = 20;
                    const plotW = w - padL - padR, plotH = h - padT - padB;
                    const xScale = (i) => padL + (i / (data.length - 1)) * plotW;
                    const yScale = (s) => padT + ((maxS - s) / (maxS - minS)) * plotH;
                    const zeroY = yScale(0);
                    const pts = data.map((d, i) => xScale(i) + "," + yScale(d.score));
                    const linePath = "M" + pts.join(" L");
                    const gridLines = [-12, -6, 0, 6, 12];
                    return (
                      <g>
                        <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1A5276" stopOpacity="0.15"/><stop offset="100%" stopColor="#1A5276" stopOpacity="0"/></linearGradient></defs>
                        {gridLines.map(s => (
                          <g key={s}>
                            <line x1={padL} y1={yScale(s)} x2={w-padR} y2={yScale(s)} stroke={s===0?"#CCC":"#F0EFEC"} strokeWidth={s===0?1:0.5} strokeDasharray={s===0?"4,4":"0"}/>
                            <text x={padL-4} y={yScale(s)+4} textAnchor="end" fontSize="9" fill="#CCC">{s>0?"+"+s:s}</text>
                          </g>
                        ))}
                        <path d={linePath + " L" + xScale(data.length-1) + "," + zeroY + " L" + xScale(0) + "," + zeroY + " Z"} fill="url(#sg)"/>
                        <path d={linePath} fill="none" stroke="#1A5276" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                        <circle cx={xScale(data.length-1)} cy={yScale(data[data.length-1].score)} r="3" fill="#1A5276"/>
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
            <div className="metric-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Log Entries</div>
                {scoreHistory.length > 0 && (
                  <button className="btn-ghost" style={{ fontSize: 11, color: "#C0392B", borderColor: "#F4C0C0" }} onClick={() => { if (window.confirm("Clear all history?")) setScoreHistory([]); }}>Clear</button>
                )}
              </div>
              {scoreHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#CCC", fontSize: 13 }}>No entries yet.</div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px 70px", gap: 12, padding: "0 0 8px", borderBottom: "0.5px solid #EBEBEB" }}>
                    {["Date","Score","BTC Price","LTV"].map(h => <div key={h} style={{ fontSize: 11, color: "#AAA" }}>{h}</div>)}
                  </div>
                  {[...scoreHistory].reverse().map((entry, i) => {
                    const sc = entry.score;
                    const scColor = sc >= 10 ? "#2D5A3D" : sc >= 3 ? "#1E3F5A" : sc >= 0 ? "#888" : sc > -6 ? "#8B6914" : "#7B2D2D";
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px 70px", gap: 12, padding: "10px 0", borderBottom: "0.5px solid #F4F3F0" }}>
                        <div style={{ fontSize: 13, color: "#555" }}>{entry.date}</div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: scColor }}>{sc > 0 ? "+" : ""}{sc}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>{entry.btcPrice ? "$" + entry.btcPrice.toLocaleString() : "—"}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>{entry.ltv != null ? entry.ltv + "%" : "—"}</div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
