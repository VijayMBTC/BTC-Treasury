import { useState, useEffect } from "react";
import { WEIGHTS, scoreMVRV, scorePowerLaw, scorePuell, scoreLTH, scoreNUPL, scoreReserveRisk, getMarketOutlook, getBtcStrategy, getLoanStrategy } from "./data/scoring.js";

const STORAGE_KEY = "btc-treasury-v3";
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Serif+Display:ital@0;1&display=swap');`;

const DEFAULT_LOANS = [
  { id: 1, lender: "Nexo", debt: 10000, collateral: 0.5 },
  { id: 2, lender: "Ledn", debt: 45000, collateral: 1.2 },
  { id: 3, lender: "Lava", debt: 80000, collateral: 2.1 },
];
const DEFAULT_MANUAL = { mvrv: 0.58, puell: 0.79, lthTrend: "Accumulating", powerLaw: 4.4, nupl: 0.18, reserveRisk: 0.00115, sma200w: 42000 };
const DEFAULT_TIMESTAMPS = { mvrv: null, puell: null, lthTrend: null, powerLaw: null, nupl: null, reserveRisk: null, sma200w: null };

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}
function staleness(iso) {
  const d = daysSince(iso);
  if (d === null) return { label: "Never updated", color: "#C0392B", dot: "#C0392B" };
  if (d === 0) return { label: "Updated today", color: "#2D5A3D", dot: "#2D5A3D" };
  if (d <= 3) return { label: d + "d ago", color: "#4A7C5A", dot: "#4A7C5A" };
  if (d <= 7) return { label: d + "d ago", color: "#8B6914", dot: "#C8963A" };
  return { label: d + "d ago — update recommended", color: "#C0392B", dot: "#C0392B" };
}

function calcPowerLawPrice(date) {
  const genesis = new Date("2009-01-03");
  const days = (date - genesis) / (1000 * 60 * 60 * 24);
  return Math.pow(10, 5.84 * Math.log10(days) - 17.01);
}

function fmt(n, decimals = 2) { if (n === null || n === undefined || isNaN(n)) return "—"; return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
function fmtPct(n) { if (n === null || n === undefined || isNaN(n)) return "—"; return (n * 100).toFixed(1) + "%"; }
function fmtUSD(n) { if (!n) return "—"; return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

export default function App() {
  const [btcPrice, setBtcPrice] = useState(null);
  const [athPrice, setAthPrice] = useState(128000);
  const [powerLawPrice, setPowerLawPrice] = useState(null);
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
  const [manualTimestamps, setManualTimestamps] = useState(DEFAULT_TIMESTAMPS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.loans) setLoans(d.loans);
        if (d.manual) setManual({ ...DEFAULT_MANUAL, ...d.manual });
        if (d.nextId) setNextId(d.nextId);
        if (d.scoreHistory) setScoreHistory(d.scoreHistory);
        if (d.manualTimestamps) setManualTimestamps({ ...DEFAULT_TIMESTAMPS, ...d.manualTimestamps });
      }
    } catch (e) {}
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ loans, manual, nextId, scoreHistory, manualTimestamps })); } catch (e) {}
  }, [loans, manual, nextId, scoreHistory, manualTimestamps, dataLoaded]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true); setFetchError(false);
      try {
        const res = await fetch("/api/btc-data");
        const data = await res.json();
        const prices = data.prices;
        if (!prices || prices.length < 100) throw new Error("Not enough data");
        const closes = prices.map((p) => p[1]);
        const latestPrice = closes[closes.length - 1];
        setBtcPrice(latestPrice);
        setAthPrice(Math.max(...closes));
        setPowerLawPrice(calcPowerLawPrice(new Date()));
        setLastUpdated(new Date());
      } catch (e) { setFetchError(true); }
      setLoading(false);
    }
    fetchData();
  }, []);

  const scores = {
    mvrv: scoreMVRV(manual.mvrv, WEIGHTS.mvrv),
    powerLaw: scorePowerLaw(manual.powerLaw, WEIGHTS.powerLaw),
    puell: scorePuell(manual.puell, WEIGHTS.puell),
    lth: scoreLTH(manual.lthTrend, WEIGHTS.lth),
    nupl: scoreNUPL(manual.nupl, WEIGHTS.nupl),
    reserveRisk: scoreReserveRisk(manual.reserveRisk, WEIGHTS.reserveRisk),
  };
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
  const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
  const portfolioLtv = btcPrice && totalCollateral > 0 ? totalDebt / (totalCollateral * btcPrice) : 0;
  const loanLtvs = loans.map((l) => { const debt = parseFloat(l.debt) || 0; const coll = parseFloat(l.collateral) || 0; return btcPrice && coll > 0 ? debt / (coll * btcPrice) : 0; });
  const maxLtv = loanLtvs.length > 0 ? Math.max(...loanLtvs) : 0;
  const liquidationDistance = maxLtv > 0 ? Math.max(0, 1 - (maxLtv / 0.80)) : null;

  const marketOutlook = getMarketOutlook(totalScore);
  const loanStrategy = getLoanStrategy(portfolioLtv, maxLtv);
  const btcStrategy = getBtcStrategy(totalScore);

  const distFromATH = btcPrice && athPrice ? ((btcPrice - athPrice) / athPrice) : null;
  const btcVsSma = btcPrice && manual.sma200w ? (btcPrice / parseFloat(manual.sma200w)) : null;

  useEffect(() => {
    if (!btcPrice || !dataLoaded) return;
    const today = new Date().toISOString().split("T")[0];
    if (scoreHistory.some((h) => h.date === today)) return;
    setScoreHistory((prev) => [...prev.slice(-89), { date: today, score: totalScore, btcPrice: Math.round(btcPrice), ltv: Math.round(portfolioLtv * 1000) / 10 }]);
  }, [btcPrice, dataLoaded]);

  function handleDeleteLoan(id) { setLoans(loans.filter((l) => l.id !== id)); }
  function handleAddLoan() {
    if (!newLoan.lender || !newLoan.debt || !newLoan.collateral) return;
    setLoans([...loans, { id: nextId, lender: newLoan.lender, debt: parseFloat(newLoan.debt), collateral: parseFloat(newLoan.collateral) }]);
    setNextId(nextId + 1); setNewLoan({ lender: "", debt: "", collateral: "" }); setShowAddLoan(false);
  }
  function handleSaveLoan() {
    if (!editingLoan) return;
    setLoans(loans.map((l) => l.id === editingLoan.id ? { ...editingLoan, debt: parseFloat(editingLoan.debt), collateral: parseFloat(editingLoan.collateral) } : l));
    setEditingLoan(null);
  }
  function handleManual(key, value) {
    setManual(prev => ({ ...prev, [key]: value }));
    setManualTimestamps(prev => ({ ...prev, [key]: new Date().toISOString() }));
  }

  const ltvBarColor = (ltv) => { if (ltv >= 0.5) return "#7B2D2D"; if (ltv >= 0.35) return "#8B6914"; return "#2D5A3D"; };

  const vzones = [
    { label: "Generational\nOpportunity", color: "#1A7A4A" },
    { label: "Accumulation\nZone", color: "#5BA55A" },
    { label: "Fair Value", color: "#9A9590" },
    { label: "Overvalued", color: "#C88A1A" },
    { label: "Euphoria", color: "#A83030" }
  ];
  const vPct = Math.max(2, Math.min(98, ((totalScore + 12) / 24) * 100));
  const activeV = marketOutlook.level;

  const rzones = [
    { label: "Very Safe", color: "#1E3F5A" },
    { label: "Safe", color: "#2D5A3D" },
    { label: "Moderate\nRisk", color: "#7A6830" },
    { label: "Elevated\nRisk", color: "#8B6914" },
    { label: "Danger\nZone", color: "#7B2D2D" }
  ];
  const rPct = Math.max(2, Math.min(98, portfolioLtv * 160));
  const activeR = loanStrategy.level;

  const SectionHeading = ({ title }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{title}</span>
      <div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} />
    </div>
  );

  const ScaleBar = ({ zones, activePct, activeIdx, markerColor }) => (
    <div>
      <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ display: "flex", width: "100%", height: "100%" }}>
          {zones.map((z, i) => (
            <div key={i} style={{ flex: 1, background: z.color, opacity: i === activeIdx ? 0.85 : i < activeIdx ? 0.40 : 0.18, borderRadius: i === 0 ? "5px 0 0 5px" : i === zones.length - 1 ? "0 5px 5px 0" : "0" }} />
          ))}
        </div>
        <div style={{ position: "absolute", top: "50%", left: activePct + "%", transform: "translate(-50%, -50%)", width: 12, height: 12, borderRadius: "50%", background: "#FFFFFF", border: "2.5px solid " + (markerColor || "#1A1816"), boxShadow: "0 0 0 1.5px rgba(0,0,0,0.15)", zIndex: 4, transition: "left 0.6s ease" }} />
      </div>
      <div style={{ display: "flex" }}>
        {zones.map((z, i) => (
          <div key={i} style={{ flex: 1, textAlign: i === 0 ? "left" : i === zones.length - 1 ? "right" : "center", fontSize: i === activeIdx ? 10 : 9, color: i === activeIdx ? z.color : "#B0ACA4", fontWeight: i === activeIdx ? 700 : 400, lineHeight: 1.3, whiteSpace: "pre-line" }}>{z.label}</div>
        ))}
      </div>
    </div>
  );

  const GaugeBar = ({ pct, color }) => (
    <div style={{ position: "relative", height: 10, borderRadius: 5, background: "#EAE8E3", overflow: "visible", margin: "8px 0 4px" }}>
      <div style={{ position: "absolute", top: -4, left: `calc(${Math.max(2, Math.min(98, pct))}% - 1.5px)`, width: 3, height: 18, background: color, borderRadius: 2, zIndex: 2 }} />
      <div style={{ height: "100%", width: Math.max(2, Math.min(100, pct)) + "%", background: color, opacity: 0.25, borderRadius: 5 }} />
    </div>
  );

  const indConfig = [
    {
      key: "mvrv", label: "MVRV Z-Score",
      value: manual.mvrv, score: scores.mvrv,
      pct: Math.max(2, Math.min(98, (parseFloat(manual.mvrv) / 10) * 100)),
      color: scores.mvrv > 0 ? "#2D5A3D" : scores.mvrv < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Compares Bitcoin's market value to its realised value. Below 1 suggests undervaluation. Above 6 signals the market is significantly overheated.",
      zones: "Bullish < 1.0 · Neutral 1–6 · Bearish > 6.0", type: "number", step: "0.01"
    },
    {
      key: "powerLaw", label: "Power Law Oscillator",
      value: manual.powerLaw, score: scores.powerLaw,
      pct: Math.max(2, Math.min(98, parseFloat(manual.powerLaw) || 0)),
      color: scores.powerLaw > 0 ? "#2D5A3D" : scores.powerLaw < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Position within the long-term Power Law corridor on a 0–100 scale. The model has an R² of 0.96, explaining 96% of all historical price variance. Below 20 = deep value. Above 75 = overheated.",
      zones: "Bullish < 20 · Neutral 20–75 · Bearish > 75", type: "number", step: "0.1"
    },
    {
      key: "puell", label: "Puell Multiple",
      value: manual.puell, score: scores.puell,
      pct: Math.max(2, Math.min(98, (parseFloat(manual.puell) / 6) * 100)),
      color: scores.puell > 0 ? "#2D5A3D" : scores.puell < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Compares miner daily revenue to its 365-day average. Low values mean miners are under stress and unlikely to sell. High values mean miners are flush and may increase selling pressure.",
      zones: "Bullish < 0.5 · Neutral 0.5–4 · Bearish > 4.0", type: "number", step: "0.01"
    },
    {
      key: "lthTrend", label: "LTH Supply Trend",
      value: manual.lthTrend, score: scores.lth,
      pct: manual.lthTrend === "Accumulating" ? 15 : manual.lthTrend === "Dumping" ? 85 : 50,
      color: scores.lth > 0 ? "#2D5A3D" : scores.lth < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Tracks whether long-term holders (wallets inactive for 155+ days) are accumulating or distributing. Accumulation during price weakness is the classic smart-money signal.",
      zones: "Bullish: Accumulating · Neutral · Bearish: Dumping", type: "select"
    },
    {
      key: "nupl", label: "NUPL",
      value: manual.nupl, score: scores.nupl,
      pct: Math.max(2, Math.min(98, ((parseFloat(manual.nupl) + 0.2) / 1.2) * 100)),
      color: scores.nupl > 0 ? "#2D5A3D" : scores.nupl < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Net Unrealised Profit/Loss measures the aggregate paper gain or loss held across all wallets. Below 0.1 reflects fear or capitulation. Above 0.6 reflects euphoria and elevated sell pressure.",
      zones: "Bullish < 0.1 · Hope/Fear 0.1–0.6 · Bearish > 0.6", type: "number", step: "0.01"
    },
    {
      key: "reserveRisk", label: "Reserve Risk",
      value: manual.reserveRisk, score: scores.reserveRisk,
      pct: Math.max(2, Math.min(98, (parseFloat(manual.reserveRisk) / 0.01) * 100)),
      color: scores.reserveRisk > 0 ? "#2D5A3D" : scores.reserveRisk < 0 ? "#7B2D2D" : "#8B6914",
      desc: "Measures long-term holder conviction relative to the current price. When conviction is high and price is low, risk/reward is historically attractive. Below 0.0026 is the green zone.",
      zones: "Bullish < 0.0026 · Neutral 0.0026–0.006 · Bearish > 0.006", type: "number", step: "0.00001"
    },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F5F3EF", color: "#141412" }}>
      <style>{FONTS}</style>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { font-family: 'DM Sans', sans-serif; }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 16px; border-radius: 6px; color: #888; letter-spacing: 0.04em; transition: all 0.15s; }
        .tab-btn.active { background: #fff; color: #1C1C1A; font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .tab-btn:hover:not(.active) { color: #444; }
        .metric-card { background: #fff; border: 0.5px solid #E8E7E4; border-radius: 12px; padding: 18px 20px; }
        .btn-ghost { background: none; border: 0.5px solid #DDD; border-radius: 6px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 5px 12px; color: #666; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #AAA; color: #333; }
        .btn-primary { background: #1C1C1A; border: none; border-radius: 6px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 8px 18px; color: #fff; font-weight: 500; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.85; }
        .inp { border: 0.5px solid #DDD; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: 'DM Sans', sans-serif; width: 100%; color: #1C1C1A; background: #fff; outline: none; }
        .inp:focus { border-color: #999; }
        .sel { border: 0.5px solid #DDD; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-family: 'DM Sans', sans-serif; background: #fff; color: #1C1C1A; outline: none; }
        .ltv-bar-bg { background: #F0EFEC; border-radius: 3px; height: 4px; width: 100%; margin-top: 4px; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1;}50%{opacity:0.5;} }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);} }
        .ind-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 0.5px solid #EBEBEB; }
        .ind-row:last-child { border-bottom: none; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "0.5px solid #E2DFD8", background: "#FEFDFB", padding: "0 24px", boxShadow: "0 1px 3px rgba(20,18,14,0.04)" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 19, color: "#1C1C1A", letterSpacing: "-0.02em" }}>Treasury</span>
            <span style={{ fontSize: 11, color: "#C8963A", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>BTC</span>
          </div>
          <div>
            {loading ? <span className="pulse" style={{ fontSize: 12, color: "#AAA" }}>Fetching data…</span>
              : fetchError ? <span style={{ fontSize: 12, color: "#C0392B" }}>Live data unavailable</span>
              : btcPrice ? <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 19, fontWeight: 500, color: "#0F0E0C", letterSpacing: "-0.03em" }}>{fmtUSD(Math.round(btcPrice))}</div>
                  {distFromATH !== null && <div style={{ fontSize: 11, color: distFromATH >= 0 ? "#1A6B3A" : "#888" }}>{distFromATH >= 0 ? "+" : ""}{(distFromATH * 100).toFixed(1)}% from ATH</div>}
                </div> : null}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: "#F5F3EF", padding: "12px 24px 0", borderBottom: "0.5px solid #E2DFD8" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", background: "#EAE8E3", borderRadius: 9, padding: 3, gap: 2 }}>
            {["dashboard", "indicators", "loans", "history"].map((t) => (
              <button key={t} className={`tab-btn${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px 60px" }} className="fade-in">

        {/* ── DASHBOARD ── */}
        {activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            <SectionHeading title="Market Outlook" />
            <div style={{ background: marketOutlook.bg, border: "0.5px solid " + marketOutlook.border, borderLeft: "4px solid " + marketOutlook.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px " + marketOutlook.color + "10" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ display: "inline-block", background: marketOutlook.badge.bg, color: marketOutlook.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{marketOutlook.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: marketOutlook.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{totalScore > 0 ? "+" : ""}{totalScore}</span>
                  <span style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Signal</span>
                </div>
              </div>
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.65, marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid " + marketOutlook.border }}>{marketOutlook.body}</div>
              <div style={{ marginBottom: 16 }}><ScaleBar zones={vzones} activePct={vPct} activeIdx={activeV} markerColor={marketOutlook.color} /></div>
              {btcPrice && (
                <div style={{ paddingTop: 14, borderTop: "0.5px solid " + marketOutlook.border, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>BTC Price</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#1A1816" }}>{fmtUSD(Math.round(btcPrice))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>200W SMA</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#1A1816" }}>{manual.sma200w ? fmtUSD(parseFloat(manual.sma200w)) : "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>vs 200W SMA</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: btcVsSma ? (btcVsSma < 1.5 ? "#2D5A3D" : btcVsSma < 3 ? "#8B6914" : "#7B2D2D") : "#1A1816" }}>
                      {btcVsSma ? btcVsSma.toFixed(2) + "x" : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>From ATH</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: distFromATH >= -0.1 ? "#2D5A3D" : distFromATH >= -0.3 ? "#8B6914" : "#7B2D2D" }}>
                      {distFromATH !== null ? (distFromATH >= 0 ? "At ATH" : (distFromATH * 100).toFixed(1) + "%") : "—"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 4 }}><SectionHeading title="BTC Strategy" /></div>
            <div style={{ background: btcStrategy.bg, border: "0.5px solid " + btcStrategy.border, borderLeft: "5px solid " + btcStrategy.color, borderRadius: 16, padding: "28px 28px 24px", boxShadow: "0 2px 12px rgba(20,18,14,0.08)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: btcStrategy.color, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>BTC Strategy</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: btcStrategy.color, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{btcStrategy.action}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>Confidence</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                    {["Low", "Medium", "High"].map((lvl) => (
                      <div key={lvl} style={{ width: 28, height: 6, borderRadius: 3, background: (btcStrategy.confidence === "High" || (btcStrategy.confidence === "Medium" && lvl !== "High") || (btcStrategy.confidence === "Low" && lvl === "Low")) ? btcStrategy.color : "#EAE8E3", opacity: btcStrategy.confidence === "Medium" && lvl === "High" ? 0.22 : 1 }} />
                    ))}
                    <span style={{ fontSize: 11, color: btcStrategy.color, fontWeight: 600, marginLeft: 4 }}>{btcStrategy.confidence}</span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.7, paddingTop: 18, borderTop: "0.5px solid " + btcStrategy.border }}>{btcStrategy.reason}</div>
            </div>

            <div style={{ marginTop: 4 }}><SectionHeading title="Loan Strategy" /></div>
            <div style={{ background: loanStrategy.bg, border: "0.5px solid " + loanStrategy.border, borderLeft: "4px solid " + loanStrategy.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px " + loanStrategy.color + "10" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ display: "inline-block", background: loanStrategy.badge.bg, color: loanStrategy.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{loanStrategy.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 42, color: loanStrategy.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{fmtPct(portfolioLtv)}</span>
                  <span style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Portfolio LTV</span>
                </div>
              </div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ background: loanStrategy.color + "08", border: "0.5px solid " + loanStrategy.border, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 10, color: loanStrategy.color, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Advisory</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: loanStrategy.color, letterSpacing: "-0.01em", marginBottom: 14, lineHeight: 1.2 }}>{loanStrategy.action}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Situation</div><div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.situation}</div></div>
                    <div style={{ borderTop: "0.5px solid " + loanStrategy.border, paddingTop: 10 }}><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Why It Matters</div><div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.why}</div></div>
                    <div style={{ borderTop: "0.5px solid " + loanStrategy.border, paddingTop: 10 }}><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>What to Consider</div><div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.what}</div></div>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 18 }}><ScaleBar zones={rzones} activePct={rPct} activeIdx={activeR} markerColor={loanStrategy.color} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Highest LTV</div><div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: ltvBarColor(maxLtv) }}>{fmtPct(maxLtv)}</div></div>
                <div><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Total Debt</div><div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816" }}>{fmtUSD(totalDebt)}</div></div>
                <div><div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Liq. Distance</div><div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: liquidationDistance !== null && liquidationDistance < 0.3 ? "#7B2D2D" : "#1A1816" }}>{liquidationDistance !== null ? (liquidationDistance * 100).toFixed(0) + "%" : "—"}</div></div>
              </div>
            </div>

            {lastUpdated && <div style={{ fontSize: 11, color: "#A8A49C", textAlign: "center" }}>Auto data last fetched {lastUpdated.toLocaleTimeString()}</div>}
          </div>
        )}

        {/* ── INDICATORS TAB ── */}
        {activeTab === "indicators" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 4 }}>
              {indConfig.map(ind => (
                <div key={ind.key} style={{ background: "#fff", border: "0.5px solid #E8E7E4", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{ind.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: ind.color }}>{String(ind.value)}</div>
                  <div style={{ fontSize: 11, color: ind.score > 0 ? "#2D5A3D" : ind.score < 0 ? "#7B2D2D" : "#888", marginTop: 2 }}>{ind.score > 0 ? "▲ Bullish" : ind.score < 0 ? "▼ Bearish" : "→ Neutral"}</div>
                </div>
              ))}
            </div>

            {indConfig.map(ind => {
              const stale = staleness(manualTimestamps[ind.key]);
              return (
                <div key={ind.key} style={{ background: "#fff", border: "0.5px solid #E8E7E4", borderLeft: "4px solid " + ind.color, borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ flex: 1, paddingRight: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1816", marginBottom: 2 }}>{ind.label}</div>
                      <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5 }}>{ind.desc}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 500, color: ind.color }}>{String(ind.value)}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: ind.score > 0 ? "#2D5A3D" : ind.score < 0 ? "#7B2D2D" : "#888" }}>{ind.score > 0 ? "▲ Bullish" : ind.score < 0 ? "▼ Bearish" : "→ Neutral"}</div>
                    </div>
                  </div>
                  <GaugeBar pct={ind.pct} color={ind.color} />
                  <div style={{ fontSize: 10, color: "#B0ACA4", marginBottom: 14 }}>{ind.zones}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12, borderTop: "0.5px solid #F0EFEC" }}>
                    <div style={{ flex: 1 }}>
                      {ind.type === "select" ? (
                        <select className="sel" value={manual.lthTrend} onChange={e => handleManual("lthTrend", e.target.value)} style={{ width: "auto" }}>
                          <option value="Accumulating">Accumulating</option>
                          <option value="Neutral">Neutral</option>
                          <option value="Dumping">Dumping</option>
                        </select>
                      ) : (
                        <input className="inp" type="number" step={ind.step} value={manual[ind.key]} onChange={e => handleManual(ind.key, e.target.value)} style={{ maxWidth: 160 }} />
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: stale.dot }} />
                      <span style={{ fontSize: 11, color: stale.color }}>{stale.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ marginTop: 8 }}><SectionHeading title="Reference Data" /></div>
            <div className="metric-card">
              <div style={{ fontSize: 12, color: "#888", marginBottom: 16, lineHeight: 1.5 }}>The 200-week moving average is Bitcoin's most watched long-term support level. It has never been broken in Bitcoin's history. Update weekly from <span style={{ color: "#C8963A" }}>glassnode.com</span> or <span style={{ color: "#C8963A" }}>bitcoinmagazinepro.com</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 16, marginBottom: 16, borderBottom: "0.5px solid #EBEBEB" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#AAA", marginBottom: 6 }}>200W SMA (update weekly)</div>
                  <input className="inp" type="number" step="100" value={manual.sma200w} onChange={e => handleManual("sma200w", e.target.value)} style={{ maxWidth: 180 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: staleness(manualTimestamps.sma200w).dot }} />
                  <span style={{ fontSize: 11, color: staleness(manualTimestamps.sma200w).color }}>{staleness(manualTimestamps.sma200w).label}</span>
                </div>
              </div>
              {btcPrice && manual.sma200w && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>BTC Price</div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1816" }}>{fmtUSD(Math.round(btcPrice))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>200W SMA</div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1816" }}>{fmtUSD(parseFloat(manual.sma200w))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Multiple</div>
                    <div style={{ fontSize: 16, fontWeight: 500, color: btcVsSma < 1.5 ? "#2D5A3D" : btcVsSma < 3 ? "#8B6914" : "#7B2D2D" }}>{btcVsSma ? btcVsSma.toFixed(2) + "x" : "—"}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="metric-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Power Law Fair Value</div>
                <span style={{ fontSize: 10, color: "#C8963A", background: "#FDF3E3", padding: "1px 6px", borderRadius: 3 }}>Auto</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Model Fair Value</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1816" }}>{powerLawPrice ? fmtUSD(Math.round(powerLawPrice)) : "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Current Price</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "#1A1816" }}>{btcPrice ? fmtUSD(Math.round(btcPrice)) : "—"}</div>
                </div>
              </div>
              {btcPrice && powerLawPrice && (
                <div style={{ marginTop: 10, fontSize: 12, color: btcPrice < powerLawPrice ? "#2D5A3D" : "#8B6914" }}>
                  {btcPrice < powerLawPrice ? "▲ Trading " + ((1 - btcPrice / powerLawPrice) * 100).toFixed(0) + "% below model fair value" : "▼ Trading " + ((btcPrice / powerLawPrice - 1) * 100).toFixed(0) + "% above model fair value"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LOANS TAB ── */}
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
                    <div><div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Lender</div><input className="inp" placeholder="e.g. Nexo" value={newLoan.lender} onChange={e => setNewLoan({ ...newLoan, lender: e.target.value })} /></div>
                    <div><div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Debt (USD)</div><input className="inp" placeholder="0.00" type="number" value={newLoan.debt} onChange={e => setNewLoan({ ...newLoan, debt: e.target.value })} /></div>
                    <div><div style={{ fontSize: 11, color: "#AAA", marginBottom: 4 }}>Collateral (BTC)</div><input className="inp" placeholder="0.00" type="number" value={newLoan.collateral} onChange={e => setNewLoan({ ...newLoan, collateral: e.target.value })} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-primary" onClick={handleAddLoan}>Save Loan</button>
                    <button className="btn-ghost" onClick={() => setShowAddLoan(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto", gap: 12, padding: "0 0 8px", borderBottom: "0.5px solid #EBEBEB", marginBottom: 4 }}>
                {["Lender", "Debt", "Collateral", "LTV", ""].map((h) => (<div key={h} style={{ fontSize: 11, color: "#AAA" }}>{h}</div>))}
              </div>
              {loans.map((loan, i) => {
                const ltv = loanLtvs[i];
                const isEditing = editingLoan?.id === loan.id;
                return (
                  <div key={loan.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto", gap: 12, alignItems: "center", padding: "12px 0", borderBottom: "0.5px solid #F4F3F0" }}>
                    {isEditing ? (<>
                      <input className="inp" value={editingLoan.lender} onChange={e => setEditingLoan({ ...editingLoan, lender: e.target.value })} />
                      <input className="inp" type="number" value={editingLoan.debt} onChange={e => setEditingLoan({ ...editingLoan, debt: e.target.value })} />
                      <input className="inp" type="number" value={editingLoan.collateral} onChange={e => setEditingLoan({ ...editingLoan, collateral: e.target.value })} />
                      <div style={{ fontSize: 13, color: ltvBarColor(ltv), fontWeight: 500 }}>{fmtPct(ltv)}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn-primary" style={{ fontSize: 11, padding: "4px 10px" }} onClick={handleSaveLoan}>Save</button>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setEditingLoan(null)}>✕</button>
                      </div>
                    </>) : (<>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{loan.lender}</div>
                      <div style={{ fontSize: 13, color: "#555" }}>{fmtUSD(loan.debt)}</div>
                      <div style={{ fontSize: 13, color: "#555" }}>{fmt(loan.collateral, 3)} BTC</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: ltvBarColor(ltv) }}>{fmtPct(ltv)}</div>
                        <div className="ltv-bar-bg" style={{ width: 60 }}><div style={{ height: 4, width: `${Math.min(100, ltv * 100)}%`, background: ltvBarColor(ltv), borderRadius: 3, transition: "width 0.5s" }} /></div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setEditingLoan({ ...loan })}>Edit</button>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px", color: "#C0392B", borderColor: "#F4C0C0" }} onClick={() => handleDeleteLoan(loan.id)}>✕</button>
                      </div>
                    </>)}
                  </div>
                );
              })}
              {loans.length === 0 && <div style={{ textAlign: "center", padding: "32px 0", color: "#CCC", fontSize: 14 }}>No loans. Add one above.</div>}
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

        {/* ── HISTORY TAB ── */}
        {activeTab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Macro Score History</div>
              <div style={{ fontSize: 12, color: "#CCC", marginBottom: 20 }}>Logged automatically once per day</div>
              {scoreHistory.length < 2 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#CCC", fontSize: 14 }}>Your score history will build up here day by day.</div>
              ) : (
                <svg width="100%" height="180" viewBox="0 0 600 180" preserveAspectRatio="none">
                  {(() => {
                    const data = scoreHistory.slice(-60);
                    const maxS = 12, minS = -12, w = 600, h = 160, padL = 32, padR = 8, padT = 10, padB = 20;
                    const plotW = w - padL - padR, plotH = h - padT - padB;
                    const xScale = (i) => padL + (i / (data.length - 1)) * plotW;
                    const yScale = (s) => padT + ((maxS - s) / (maxS - minS)) * plotH;
                    const zeroY = yScale(0);
                    const pts = data.map((d, i) => xScale(i) + "," + yScale(d.score));
                    const linePath = "M" + pts.join(" L");
                    return (
                      <g>
                        <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1A5276" stopOpacity="0.15"/><stop offset="100%" stopColor="#1A5276" stopOpacity="0"/></linearGradient></defs>
                        {[-12, -6, 0, 6, 12].map(s => (
                          <g key={s}>
                            <line x1={padL} y1={yScale(s)} x2={w - padR} y2={yScale(s)} stroke={s === 0 ? "#CCC" : "#F0EFEC"} strokeWidth={s === 0 ? 1 : 0.5} strokeDasharray={s === 0 ? "4,4" : "0"} />
                            <text x={padL - 4} y={yScale(s) + 4} textAnchor="end" fontSize="9" fill="#CCC">{s > 0 ? "+" + s : s}</text>
                          </g>
                        ))}
                        <path d={linePath + " L" + xScale(data.length - 1) + "," + zeroY + " L" + xScale(0) + "," + zeroY + " Z"} fill="url(#sg)" />
                        <path d={linePath} fill="none" stroke="#1A5276" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                        <circle cx={xScale(data.length - 1)} cy={yScale(data[data.length - 1].score)} r="3" fill="#1A5276" />
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
            <div className="metric-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Log Entries</div>
                {scoreHistory.length > 0 && <button className="btn-ghost" style={{ fontSize: 11, color: "#C0392B", borderColor: "#F4C0C0" }} onClick={() => { if (window.confirm("Clear all history?")) setScoreHistory([]); }}>Clear</button>}
              </div>
              {scoreHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#CCC", fontSize: 13 }}>No entries yet.</div>
              ) : (<>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px 70px", gap: 12, padding: "0 0 8px", borderBottom: "0.5px solid #EBEBEB" }}>
                  {["Date", "Score", "BTC Price", "LTV"].map(h => <div key={h} style={{ fontSize: 11, color: "#AAA" }}>{h}</div>)}
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
              </>)}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
