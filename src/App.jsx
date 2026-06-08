import { useState, useEffect } from "react";
import { runPortfolioStressTest, runLoanStressTest, calcBtcBuffer, getWeakestLink, runHistoricalScenarios } from "./stressEngine.js";

const STORAGE_KEY = "btc-treasury-v1";
const WEIGHTS = { mvrv: 3, powerLaw: 3, sma200w: 2, puell: 2, lth: 1, rsi: 1 };
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Serif+Display:ital@0;1&display=swap');`;

const DEFAULT_LOANS = [
  { id: 1, lender: "Nexo", debt: 10000, collateral: 0.5 },
  { id: 2, lender: "Ledn", debt: 45000, collateral: 1.2 },
  { id: 3, lender: "Lava", debt: 80000, collateral: 2.1 },
];
const DEFAULT_MANUAL = { mvrv: 0.26, puell: 1.1, lthTrend: "Accumulating" };
const DEFAULT_TIMESTAMPS = { mvrv: null, puell: null, lthTrend: null };

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

function scoreMVRV(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 1.0) return w; if (n > 6) return -w; return 0; }
function scorePowerLaw(v, w) { if (v === "Floor") return w; if (v === "Top") return -w; return 0; }
function scorePuell(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.5) return w; if (n > 4) return -w; return 0; }
function score200wSMA(price, sma, w) { if (!price || !sma) return 0; if (price <= sma) return w; if (price >= sma * 2.5) return -w; return 0; }
function scoreLTH(v, w) { if (v === "Accumulating") return w; if (v === "Dumping") return -w; return 0; }
function scoreRSI(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 30) return w; if (n > 85) return -w; return 0; }

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
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// MARKET OUTLOOK — personal, plain-spoken tone
function getMarketOutlook(score) {
  if (score <= -6) return {
    label: "Generational Opportunity",
    body: "Several key indicators are at levels rarely seen outside major cycle lows. Historically, conditions like these have been among the best times to build a Bitcoin position.",
    color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E",
    badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 0
  };
  if (score <= 0) return {
    label: "Accumulation Zone",
    body: "Bitcoin looks undervalued relative to where it has historically traded. In past cycles, periods like this have tended to reward patient buyers.",
    color: "#4A7C5A", bg: "#F4F9F5", border: "#A0C8AD",
    badge: { bg: "#4A7C5A", text: "#FAF8F5" }, level: 1
  };
  if (score <= 4) return {
    label: "Fair Value",
    body: "The indicators aren't sending a strong signal in either direction. Bitcoin appears to be trading around fair value — no obvious reason to rush in or pull back.",
    color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC",
    badge: { bg: "#4A4845", text: "#FAF8F5" }, level: 2
  };
  if (score <= 8) return {
    label: "Overvalued",
    body: "A number of indicators are flashing late-cycle warning signs. Bitcoin may still go higher, but the risk of buying at these levels is meaningfully elevated.",
    color: "#8B6914", bg: "#FCF9F0", border: "#D4BC7A",
    badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3
  };
  return {
    label: "Euphoria",
    body: "Multiple indicators are at extreme levels not often seen outside cycle tops. Conditions like these have historically been followed by significant price corrections.",
    color: "#7B2D2D", bg: "#FDF4F4", border: "#D4A8A8",
    badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4
  };
}

// BTC STRATEGY
function getBtcStrategy(valuationLevel, riskLevel) {
  if (riskLevel >= 3) return { action: "Preserve Capital", confidence: "High", reason: "Your loan position needs attention before anything else. Until your LTV is back in a safe range, adding to your Bitcoin position increases the risk to collateral you already hold.", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
  if (valuationLevel === 0) {
    if (riskLevel <= 1) return { action: "Buy Aggressively", confidence: "High", reason: "Your indicators are aligned in a way that has rarely been seen outside major cycle lows, and your loan structure is in good shape. This is the kind of window that long-term Bitcoin holders position themselves for.", color: "#1A5C38", bg: "#EDF7F2", border: "#7DC4A0" };
    return { action: "Accumulate", confidence: "Medium", reason: "Bitcoin looks very attractive at these levels, but your current loan exposure means you should be measured rather than aggressive. Keep adding steadily, but don't stretch your collateral buffer to do it.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
  }
  if (valuationLevel === 1) {
    if (riskLevel <= 1) return { action: "Accumulate", confidence: "High", reason: "Bitcoin is trading below where the indicators suggest it should be, and your loan structure is healthy. This is a straightforward case for continuing to build your position.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E" };
    return { action: "Accumulate Steadily", confidence: "Medium", reason: "The value case for Bitcoin is solid here, but your loan levels mean you should keep a consistent, measured pace. Avoid deploying a large amount at once while your LTV is elevated.", color: "#4A7C5A", bg: "#F4F9F5", border: "#A0C8AD" };
  }
  if (valuationLevel === 2) {
    if (riskLevel <= 1) return { action: "Hold", confidence: "Medium", reason: "There's no strong signal to act in either direction right now. Your position is well-structured, so the sensible move is to hold and wait for a clearer opportunity.", color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC" };
    return { action: "Hold — Strengthen Structure", confidence: "Medium", reason: "Bitcoin isn't obviously cheap or expensive right now, but your loan levels are the bigger variable. Any spare capital is better used reducing debt than adding to your position at this stage.", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090" };
  }
  if (valuationLevel === 3) {
    if (riskLevel === 0) return { action: "Hold — Reduce Leverage", confidence: "Medium", reason: "The market is looking stretched, but your treasury is in a strong position. This is a good time to reduce your loan exposure while you can do it on your own terms, without any urgency.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
    return { action: "Pause Accumulation", confidence: "High", reason: "Bitcoin is looking expensive and your loan levels are elevated. Adding more right now compounds your risk on both sides. Pause buying and focus on bringing your LTV down.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A" };
  }
  if (riskLevel === 0) return { action: "Consider Trimming", confidence: "Medium", reason: "The market is showing the kind of extreme readings that have historically appeared near cycle tops. Your treasury is in excellent shape, so you may want to consider taking some off the table while conditions are strong.", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
  return { action: "Reduce Exposure", confidence: "High", reason: "The market looks very stretched and your loan levels are a concern. This combination increases your downside exposure significantly. Reducing debt and trimming your position would put you in a much stronger position.", color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8" };
}

// LOAN STRATEGY — "Opportunity to Optimise Collateral" replaces "Collateral Efficiency Opportunity"
function getLoanStrategy(portfolioLtv, maxLtv) {
  const dominant = Math.max(portfolioLtv, maxLtv);
  if (dominant >= 0.50) return { label: "Danger Zone", action: "Immediate Attention Required", situation: "Your portfolio LTV has entered the danger threshold.", why: "A modest further decline in BTC price could trigger forced liquidation by your lender, resulting in loss of collateral.", what: "Prioritise debt reduction or add collateral immediately. This takes precedence over any accumulation activity.", color: "#7B2D2D", bg: "#FDF4F4", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4 };
  if (dominant >= 0.40) return { label: "Elevated Risk", action: "Reduce Risk", situation: "Collateral coverage is thinning as LTV approaches the danger zone.", why: "A 20-25% decline in BTC price from here would push your position into dangerous territory. The margin for error is narrow.", what: "Consider paying down the highest-LTV loan or adding collateral to create a more comfortable buffer before deploying further capital.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3 };
  if (dominant >= 0.30) return { label: "Moderate Risk", action: "Monitor Closely", situation: "Leverage is within acceptable bounds but deserves attention.", why: "Your collateral structure can absorb moderate price weakness, but a sustained drawdown would erode your buffer meaningfully.", what: "No immediate intervention required. Review if BTC declines more than 15-20% from current levels.", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090", badge: { bg: "#7A6830", text: "#FAF8F5" }, level: 2 };
  if (dominant >= 0.20) return { label: "Safe", action: "Maintain Structure", situation: "Debt and collateral levels are well-balanced.", why: "Your current LTV provides a healthy buffer against price volatility. The portfolio is structured conservatively.", what: "No action required. Continue your existing strategy and review when market conditions or loan balances change materially.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 1 };
  return { label: "Very Safe", action: "Opportunity to Optimise Collateral", situation: "Portfolio leverage is substantially below optimal levels.", why: "You are holding more collateral than your current debt requires. This capital could be working harder within a still-conservative risk profile.", what: "You may be able to safely release collateral or increase debt capacity while remaining well within safe LTV thresholds.", color: "#1E3F5A", bg: "#F2F6FA", border: "#8AAEC8", badge: { bg: "#1E3F5A", text: "#FAF8F5" }, level: 0 };
}

function fmt(n, decimals = 2) { if (n === null || n === undefined || isNaN(n)) return "—"; return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
function fmtPct(n) { if (n === null || n === undefined || isNaN(n)) return "—"; return (n * 100).toFixed(1) + "%"; }
function fmtUSD(n) { if (!n) return "—"; return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ── TREASURY INTELLIGENCE SUB-COMPONENTS ──────────────────────

function IntelligenceHeading({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: subtitle ? 4 : 0 }}>
        <span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{title}</span>
        <div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} />
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function ZoneBadge({ zone }) {
  return (
    <span style={{ display: "inline-block", background: zone.badge.bg, color: zone.badge.text, fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 4 }}>
      {zone.label}
    </span>
  );
}

function StressTable({ rows, isLoan }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "0.5px solid #EBEBEB" }}>
            <th style={{ textAlign: "left", padding: "6px 8px 8px 0", fontSize: 10, color: "#AAA", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>BTC Change</th>
            <th style={{ textAlign: "right", padding: "6px 8px 8px", fontSize: 10, color: "#AAA", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>{isLoan ? "Loan LTV" : "Portfolio LTV"}</th>
            <th style={{ textAlign: "left", padding: "6px 8px 8px", fontSize: 10, color: "#AAA", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>Risk Zone</th>
            <th style={{ textAlign: "left", padding: "6px 8px 8px", fontSize: 10, color: "#AAA", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "0.5px solid #F4F3F0", background: row.isCurrent ? row.zone.bg : "transparent" }}>
              <td style={{ padding: "10px 8px 10px 0", fontWeight: row.isCurrent ? 600 : 400, color: row.isCurrent ? "#1A1816" : "#555" }}>
                {row.isCurrent ? "Current" : row.drawdownLabel}
              </td>
              <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 500, color: row.zone.color, fontVariantNumeric: "tabular-nums" }}>
                {row.ltvFormatted}
                {row.breachesAutoTopUp && !row.breachesLiquidation && <span style={{ marginLeft: 4, fontSize: 9, color: "#8B6914", background: "#FBF8EF", padding: "1px 4px", borderRadius: 3 }}>TOP-UP</span>}
                {row.breachesLiquidation && <span style={{ marginLeft: 4, fontSize: 9, color: "#7B2D2D", background: "#FBF2F2", padding: "1px 4px", borderRadius: 3 }}>LIQ</span>}
              </td>
              <td style={{ padding: "10px 8px" }}><ZoneBadge zone={row.zone} /></td>
              <td style={{ padding: "10px 8px", fontSize: 12, color: "#3A3835", lineHeight: 1.5 }}>{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoansTab({ loans, loanLtvs, editingLoan, setEditingLoan, showAddLoan, setShowAddLoan, newLoan, setNewLoan, handleAddLoan, handleSaveLoan, handleDeleteLoan, totalDebt, portfolioLtv, btcPrice, fmtUSD, fmtPct, fmt, ltvBarColor }) {
  const [expandedLoans, setExpandedLoans] = useState({});
  const [showBufferTooltip, setShowBufferTooltip] = useState(false);

  const portfolioStress = btcPrice ? runPortfolioStressTest(loans, btcPrice) : [];
  const buffer = btcPrice ? calcBtcBuffer(loans, btcPrice) : null;
  const weakest = btcPrice ? getWeakestLink(loans, btcPrice) : null;
  const historical = btcPrice ? runHistoricalScenarios(loans, btcPrice) : [];

  const toggleLoan = (id) => setExpandedLoans(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── 1. PORTFOLIO SUMMARY ── */}
      <div className="metric-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Portfolio Summary</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Total Debt</div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816", letterSpacing: "-0.02em" }}>{fmtUSD(totalDebt)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Portfolio LTV</div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: ltvBarColor(portfolioLtv), letterSpacing: "-0.02em" }}>{fmtPct(portfolioLtv)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Loans</div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816", letterSpacing: "-0.02em" }}>{loans.length}</div>
          </div>
        </div>
      </div>

      {/* ── 2. LOAN MANAGEMENT ── */}
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
          {["Lender", "Debt", "Collateral", "LTV", ""].map((h) => (<div key={h} style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.04em" }}>{h}</div>))}
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
      </div>

      {/* ── TREASURY INTELLIGENCE ── */}
      {btcPrice && loans.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Treasury Intelligence</span>
            <div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} />
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: -12 }}>Understand how your treasury would respond to major Bitcoin drawdowns.</div>

          {/* ── A. PORTFOLIO STRESS TEST ── */}
          <IntelligenceHeading title="Portfolio Stress Test" />
          <div className="metric-card">
            <StressTable rows={portfolioStress} isLoan={false} />
          </div>

          {/* ── B. BTC BUFFER ── */}
          <IntelligenceHeading title="BTC Buffer" />
          {buffer && (
            <div style={{ background: buffer.currentZone.bg, border: "0.5px solid " + buffer.currentZone.border, borderLeft: "4px solid " + buffer.currentZone.color, borderRadius: 14, padding: "24px 26px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: buffer.currentZone.color, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>BTC Buffer</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 42, color: buffer.currentZone.color, letterSpacing: "-0.03em", lineHeight: 1 }}>
                      {buffer.bufferPct !== null ? (buffer.bufferPct * 100).toFixed(0) + "%" : "—"}
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowBufferTooltip(v => !v)} style={{ background: "#F5F3EF", border: "0.5px solid #D8D4CC", borderRadius: "50%", width: 24, height: 24, fontSize: 12, color: "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>?</button>
              </div>
              {showBufferTooltip && (
                <div style={{ background: "#F5F3EF", border: "0.5px solid #D8D4CC", borderRadius: 8, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#555", lineHeight: 1.6 }}>
                  <strong style={{ color: "#1A1816" }}>What is BTC Buffer?</strong><br />
                  {buffer.tooltip}
                </div>
              )}
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.65, marginBottom: 16, paddingBottom: 16, borderBottom: "0.5px solid " + buffer.currentZone.border }}>
                {buffer.meaning}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: buffer.currentZone.color + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + buffer.currentZone.border }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Current Risk Zone</div>
                  <div style={{ fontSize: 13, color: buffer.currentZone.color, fontWeight: 600 }}>{buffer.currentZone.label}</div>
                </div>
                <div style={{ background: buffer.currentZone.color + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + buffer.currentZone.border }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Threshold Being Measured</div>
                  <div style={{ fontSize: 13, color: "#1A1816", fontWeight: 600 }}>Elevated Risk (50% LTV)</div>
                </div>
              </div>
            </div>
          )}

          {/* ── C. WEAKEST LINK ── */}
          <IntelligenceHeading title="Weakest Link" />
          {weakest && (
            <div style={{ background: weakest.currentZone.bg, border: "0.5px solid " + weakest.currentZone.border, borderLeft: "4px solid " + weakest.currentZone.color, borderRadius: 14, padding: "24px 26px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: weakest.currentZone.color, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Weakest Link</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: "#1A1816", letterSpacing: "-0.02em" }}>{weakest.lender}</div>
                </div>
                <ZoneBadge zone={weakest.currentZone} />
              </div>
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.65, marginBottom: 16, paddingBottom: 16, borderBottom: "0.5px solid " + weakest.currentZone.border }}>
                {weakest.meaning}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ background: weakest.currentZone.color + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + weakest.currentZone.border }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Current LTV</div>
                  <div style={{ fontSize: 16, color: weakest.currentZone.color, fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>{weakest.currentLtvFormatted}</div>
                </div>
                <div style={{ background: weakest.currentZone.color + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + weakest.currentZone.border }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>BTC Buffer</div>
                  <div style={{ fontSize: 16, color: "#1A1816", fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>{weakest.bufferPctFormatted}</div>
                </div>
                <div style={{ background: weakest.currentZone.color + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + weakest.currentZone.border }}>
                  <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Risk Zone</div>
                  <div style={{ fontSize: 13, color: weakest.currentZone.color, fontWeight: 600 }}>{weakest.currentZone.label}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── C2. OPPORTUNITY COST ── */}
          {(() => {
            const TARGET_LTV = 0.45;
            const CAPACITY_THRESHOLD = 0.50;
            const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
            const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
            const collateralValue = totalCollateral * btcPrice;
            const currentLtv = totalDebt / collateralValue;
            const capacityAtTarget = (collateralValue * TARGET_LTV) - totalDebt;
            const isAboveThreshold = currentLtv >= CAPACITY_THRESHOLD;
            const zoneColor = isAboveThreshold ? "#4A4845" : capacityAtTarget > 0 ? "#1E3F5A" : "#4A4845";
            const zoneBg = isAboveThreshold ? "#F5F3EF" : capacityAtTarget > 0 ? "#F2F6FA" : "#F5F3EF";
            const zoneBorder = isAboveThreshold ? "#C8C4BC" : capacityAtTarget > 0 ? "#8AAEC8" : "#C8C4BC";
            const utilisationPct = Math.min(100, (currentLtv / TARGET_LTV) * 100);
            const fmtUSDLocal = (n) => "$" + Number(Math.round(n)).toLocaleString("en-US");

            return (
              <div>
                <IntelligenceHeading title="Capital Capacity" />
                <div style={{ background: zoneBg, border: "0.5px solid " + zoneBorder, borderLeft: "4px solid " + zoneColor, borderRadius: 14, padding: "24px 26px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 10, color: zoneColor, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Capital Capacity</div>
                      {isAboveThreshold ? (
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#4A4845", letterSpacing: "-0.02em", lineHeight: 1.2 }}>Not Applicable</div>
                      ) : capacityAtTarget > 0 ? (
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: zoneColor, letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtUSDLocal(capacityAtTarget)}</div>
                      ) : (
                        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#4A4845", letterSpacing: "-0.02em", lineHeight: 1.2 }}>At Capacity</div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Current LTV</div>
                      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: zoneColor, letterSpacing: "-0.02em" }}>{(currentLtv * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>
                    Based on: Target LTV 45% · BTC at {fmtUSDLocal(btcPrice)}
                  </div>

                  <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.65, marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid " + zoneBorder }}>
                    {isAboveThreshold
                      ? "Portfolio LTV is above 50%. Capital capacity is not a relevant consideration at this level. Focus on reducing leverage before assessing available headroom."
                      : capacityAtTarget > 0
                      ? "At a 45% LTV, there may be capacity to access an additional " + fmtUSDLocal(capacityAtTarget) + " against your existing collateral. This reflects the difference between your current debt and what a 45% LTV structure would permit."
                      : "Your current debt already exceeds a 45% LTV against your collateral. There is no additional capacity at the target threshold."}
                  </div>

                  {!isAboveThreshold && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888", marginBottom: 6, letterSpacing: "0.04em" }}>
                        <span>Current utilisation</span>
                        <span>{utilisationPct.toFixed(0)}% of target capacity used</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: "#E8E7E4", position: "relative", marginBottom: 16 }}>
                        <div style={{ height: "100%", width: Math.min(100, utilisationPct) + "%", background: utilisationPct > 90 ? "#8B6914" : zoneColor, borderRadius: 3, transition: "width 0.6s ease" }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        <div style={{ background: zoneColor + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + zoneBorder }}>
                          <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Current Debt</div>
                          <div style={{ fontSize: 15, color: "#1A1816", fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>{fmtUSDLocal(totalDebt)}</div>
                        </div>
                        <div style={{ background: zoneColor + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + zoneBorder }}>
                          <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Capacity at 45% LTV</div>
                          <div style={{ fontSize: 15, color: "#1A1816", fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>{fmtUSDLocal(collateralValue * TARGET_LTV)}</div>
                        </div>
                        <div style={{ background: zoneColor + "0A", borderRadius: 8, padding: "10px 14px", border: "0.5px solid " + zoneBorder }}>
                          <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Available Headroom</div>
                          <div style={{ fontSize: 15, color: capacityAtTarget > 0 ? zoneColor : "#888", fontWeight: 600, fontFamily: "'DM Serif Display', serif" }}>{capacityAtTarget > 0 ? fmtUSDLocal(capacityAtTarget) : "—"}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── D. INDIVIDUAL LOAN STRESS TESTS ── */}
          <IntelligenceHeading title="Individual Loan Stress Tests" />
          {loans.map((loan, i) => {
            const loanStress = runLoanStressTest(loan, btcPrice);
            const currentRow = loanStress[0];
            const loanBuffer = calcBtcBuffer([loan], btcPrice);
            const isExpanded = expandedLoans[loan.id];
            return (
              <div key={loan.id} style={{ background: currentRow.zone.bg, border: "0.5px solid " + currentRow.zone.border, borderLeft: "4px solid " + currentRow.zone.color, borderRadius: 14, padding: "20px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, color: currentRow.zone.color, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Individual Loan</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816", letterSpacing: "-0.02em" }}>{loan.lender}</div>
                  </div>
                  <ZoneBadge zone={currentRow.zone} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: "0.5px solid " + currentRow.zone.border }}>
                  {[
                    { label: "Debt", value: fmtUSD(loan.debt) },
                    { label: "Collateral", value: (parseFloat(loan.collateral) || 0).toFixed(3) + " BTC" },
                    { label: "Current LTV", value: currentRow.ltvFormatted },
                    { label: "BTC Buffer", value: loanBuffer.bufferPctFormatted },
                    { label: "Risk Zone", value: currentRow.zone.label },
                  ].map(m => (
                    <div key={m.label}>
                      <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>{m.label}</div>
                      <div style={{ fontSize: 13, color: "#1A1816", fontWeight: 500 }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => toggleLoan(loan.id)} style={{ background: "none", border: "0.5px solid " + currentRow.zone.border, borderRadius: 6, cursor: "pointer", fontSize: 12, color: currentRow.zone.color, padding: "5px 12px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
                  {isExpanded ? "Hide Scenarios ▲" : "Show Scenarios ▼"}
                </button>
                {isExpanded && (
                  <div style={{ marginTop: 14 }}>
                    <StressTable rows={loanStress} isLoan={true} />
                  </div>
                )}
              </div>
            );
          })}


        </>
      )}
    </div>
  );
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
  const [fearGreed, setFearGreed] = useState(null);
  const [manualTimestamps, setManualTimestamps] = useState(DEFAULT_TIMESTAMPS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d.loans) setLoans(d.loans);
        if (d.manual) setManual(d.manual);
        if (d.nextId) setNextId(d.nextId);
        if (d.scoreHistory) setScoreHistory(d.scoreHistory);
        if (d.manualTimestamps) setManualTimestamps(d.manualTimestamps);
      }
    } catch (e) {}
    setDataLoaded(true);
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ loans, manual, nextId, scoreHistory, manualTimestamps })); } catch (e) {}
  }, [loans, manual, nextId, scoreHistory, dataLoaded]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true); setFetchError(false);
      try {
        const res = await fetch("/api/btc-data");
        const data = await res.json();
        const prices = data.prices;
        if (!prices || prices.length < 200) throw new Error("Not enough data");
        const closes = prices.map((p) => p[1]);
        const latestPrice = closes[closes.length - 1];
        setBtcPrice(latestPrice);
        setAthPrice(Math.max(...closes));
        const sma = closes.slice(-1400).reduce((a, b) => a + b, 0) / 1400;
        setSma200w(sma);
        const weeklyCloses = [];
        for (let i = 6; i < closes.length; i += 7) weeklyCloses.push(closes[i]);
        setWeeklyRsi(calcRSI(weeklyCloses, 14));
        const plPrice = calcPowerLawPrice(new Date());
        setPowerLawPrice(plPrice);
        const ratio = latestPrice / plPrice;
        if (ratio < 0.8) setPowerLawPos("Floor");
        else if (ratio > 3.5) setPowerLawPos("Top");
        else setPowerLawPos("Mid");
        setLastUpdated(new Date());
      } catch (e) { setFetchError(true); }
      setLoading(false);
    }
    fetchData();

    async function fetchFearGreed() {
      try {
        const res = await fetch("https://api.alternative.me/fng/?limit=2");
        const data = await res.json();
        if (data && data.data && data.data.length >= 2) {
          setFearGreed({
            value: parseInt(data.data[0].value),
            label: data.data[0].value_classification,
            prev: parseInt(data.data[1].value),
            prevLabel: data.data[1].value_classification,
          });
        }
      } catch (e) {}
    }
    fetchFearGreed();
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
  const loanLtvs = loans.map((l) => { const debt = parseFloat(l.debt) || 0; const coll = parseFloat(l.collateral) || 0; return btcPrice && coll > 0 ? debt / (coll * btcPrice) : 0; });
  const maxLtv = loanLtvs.length > 0 ? Math.max(...loanLtvs) : 0;
  const liquidationDistance = maxLtv > 0 ? Math.max(0, 1 - (maxLtv / 0.80)) : null;

  const marketOutlook = getMarketOutlook(totalScore);
  const loanStrategy = getLoanStrategy(portfolioLtv, maxLtv);
  const btcStrategy = getBtcStrategy(marketOutlook.level, loanStrategy.level);

  const distFromATH = btcPrice && athPrice ? ((btcPrice - athPrice) / athPrice) : null;

  const indicators = [
    { label: "MVRV Z-Score", value: manual.mvrv || "—", score: scores.mvrv, auto: false },
    { label: "Power Law", value: powerLawPos, score: scores.powerLaw, auto: true },
    { label: "200W SMA", value: sma200w ? fmtUSD(Math.round(sma200w)) : "—", score: scores.sma200w, auto: true },
    { label: "Puell Multiple", value: manual.puell || "—", score: scores.puell, auto: false },
    { label: "LTH Supply Trend", value: manual.lthTrend, score: scores.lth, auto: false },
    { label: "Weekly RSI", value: weeklyRsi ? weeklyRsi.toFixed(1) : "—", score: scores.rsi, auto: true },
  ];

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
  const ltvBarColor = (ltv) => { if (ltv >= 0.5) return "#7B2D2D"; if (ltv >= 0.35) return "#8B6914"; return "#2D5A3D"; };

  // Scale zones
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

  // Section heading — no numbers
  const SectionHeading = ({ title }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{title}</span>
      <div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} />
    </div>
  );

  // Embedded scale — marker sits inside the track
  const ScaleBar = ({ zones, activePct, activeIdx, markerColor }) => (
    <div>
      <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 10 }}>
        {/* colored segments */}
        <div style={{ display: "flex", width: "100%", height: "100%" }}>
          {zones.map((z, i) => (
            <div key={i} style={{
              flex: 1, background: z.color,
              opacity: i === activeIdx ? 0.85 : i < activeIdx ? 0.40 : 0.18,
              borderRadius: i === 0 ? "5px 0 0 5px" : i === zones.length - 1 ? "0 5px 5px 0" : "0"
            }} />
          ))}
        </div>
        {/* Embedded marker — white-center dot sitting inside the track */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: activePct + "%",
          transform: "translate(-50%, -50%)",
          width: 12, height: 12,
          borderRadius: "50%",
          background: "#FFFFFF",
          border: "2.5px solid " + (markerColor || "#1A1816"),
          boxShadow: "0 0 0 1.5px rgba(0,0,0,0.15)",
          zIndex: 4,
          transition: "left 0.6s ease"
        }} />
      </div>
      <div style={{ display: "flex" }}>
        {zones.map((z, i) => (
          <div key={i} style={{
            flex: 1,
            textAlign: i === 0 ? "left" : i === zones.length - 1 ? "right" : "center",
            fontSize: i === activeIdx ? 10 : 9,
            color: i === activeIdx ? z.color : "#B0ACA4",
            fontWeight: i === activeIdx ? 700 : 400,
            lineHeight: 1.3,
            whiteSpace: "pre-line",
          }}>{z.label}</div>
        ))}
      </div>
    </div>
  );

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
            {["dashboard", "loans", "indicators", "history"].map((t) => (
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

            {/* ── 1. MARKET OUTLOOK ── */}
            <SectionHeading title="Market Outlook" />
            <div style={{ background: marketOutlook.bg, border: "0.5px solid " + marketOutlook.border, borderLeft: "4px solid " + marketOutlook.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px " + marketOutlook.color + "10, 0 0.5px 2px rgba(20,18,14,0.04)" }}>
              {/* Badge + Signal */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ display: "inline-block", background: marketOutlook.badge.bg, color: marketOutlook.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{marketOutlook.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: marketOutlook.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{totalScore > 0 ? "+" : ""}{totalScore}</span>
                  <span style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Signal</span>
                </div>
              </div>

              {/* Concise body */}
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.65, marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid " + marketOutlook.border }}>
                {marketOutlook.body}
              </div>

              {/* Scale — embedded marker */}
              <div style={{ marginBottom: 16 }}>
                <ScaleBar zones={vzones} activePct={vPct} activeIdx={activeV} markerColor={marketOutlook.color} />
              </div>

              {/* ATH 3-column block */}
              {btcPrice && athPrice && (
                <div style={{ paddingTop: 14, borderTop: "0.5px solid " + marketOutlook.border, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>BTC Price</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#1A1816", letterSpacing: "-0.02em" }}>{fmtUSD(Math.round(btcPrice))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>All-Time High</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: "#1A1816", letterSpacing: "-0.02em" }}>{fmtUSD(Math.round(athPrice))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Distance from ATH</div>
                    <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: distFromATH >= -0.1 ? "#2D5A3D" : distFromATH >= -0.3 ? "#8B6914" : "#7B2D2D", letterSpacing: "-0.02em" }}>
                      {distFromATH >= 0 ? "At ATH" : (distFromATH * 100).toFixed(1) + "%"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── 2. BTC STRATEGY ── */}
            <div style={{ marginTop: 8 }}><SectionHeading title="BTC Strategy" /></div>
            <div style={{ background: "#FEFDFB", border: "0.5px solid #D8D4CC", borderLeft: "5px solid " + btcStrategy.color, borderRadius: 16, padding: "28px 28px 24px", boxShadow: "0 2px 12px rgba(20,18,14,0.08), 0 1px 3px rgba(20,18,14,0.06)" }}>
              {/* Action headline — ~15% larger */}
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

              {/* Rationale */}
              <div style={{ fontSize: 14, color: "#2A2725", lineHeight: 1.7, paddingTop: 18, borderTop: "0.5px solid #E2DFD8", marginBottom: 18 }}>
                {btcStrategy.reason}
              </div>

              {/* Based On — transparent inputs panel */}
              <div style={{ paddingTop: 16, borderTop: "0.5px solid #E2DFD8" }}>
                <div style={{ fontSize: 10, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>Based On</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: "#F5F3EF", borderRadius: 8, padding: "10px 14px", border: "0.5px solid #E2DFD8" }}>
                    <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Market Outlook</div>
                    <div style={{ fontSize: 13, color: marketOutlook.color, fontWeight: 600 }}>{marketOutlook.label}</div>
                    <div style={{ fontSize: 11, color: "#6B6760", marginTop: 2 }}>Signal {totalScore > 0 ? "+" : ""}{totalScore}</div>
                  </div>
                  <div style={{ background: "#F5F3EF", borderRadius: 8, padding: "10px 14px", border: "0.5px solid #E2DFD8" }}>
                    <div style={{ fontSize: 9, color: "#6B6760", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Treasury Risk</div>
                    <div style={{ fontSize: 13, color: loanStrategy.color, fontWeight: 600 }}>{loanStrategy.label}</div>
                    <div style={{ fontSize: 11, color: "#6B6760", marginTop: 2 }}>LTV {fmtPct(portfolioLtv)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── 3. LOAN STRATEGY ── */}
            <div style={{ marginTop: 8 }}><SectionHeading title="Loan Strategy" /></div>
            <div style={{ background: loanStrategy.bg, border: "0.5px solid " + loanStrategy.border, borderLeft: "4px solid " + loanStrategy.color, borderRadius: 14, padding: "24px 26px 20px", boxShadow: "0 2px 8px " + loanStrategy.color + "10, 0 0.5px 2px rgba(20,18,14,0.04)" }}>
              {/* Badge + LTV — LTV enlarged ~20% */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ display: "inline-block", background: loanStrategy.badge.bg, color: loanStrategy.badge.text, fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 5 }}>{loanStrategy.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 42, color: loanStrategy.color, lineHeight: 1, letterSpacing: "-0.03em" }}>{fmtPct(portfolioLtv)}</span>
                  <span style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500 }}>Portfolio LTV</span>
                </div>
              </div>

              {/* Advisory panel */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ background: loanStrategy.color + "08", border: "0.5px solid " + loanStrategy.border, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 10, color: loanStrategy.color, letterSpacing: "0.09em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Advisory</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: loanStrategy.color, letterSpacing: "-0.01em", marginBottom: 14, lineHeight: 1.2 }}>{loanStrategy.action}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Situation</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.situation}</div>
                    </div>
                    <div style={{ borderTop: "0.5px solid " + loanStrategy.border, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>Why It Matters</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.why}</div>
                    </div>
                    <div style={{ borderTop: "0.5px solid " + loanStrategy.border, paddingTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 3 }}>What to Consider</div>
                      <div style={{ fontSize: 13, color: "#2A2825", lineHeight: 1.6 }}>{loanStrategy.what}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk scale — embedded marker */}
              <div style={{ marginBottom: 18 }}>
                <ScaleBar zones={rzones} activePct={rPct} activeIdx={activeR} markerColor={loanStrategy.color} />
              </div>

              {/* Based On — transparent inputs */}
              <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid " + loanStrategy.border }}>
                <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>Based On</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: loanStrategy.color + "08", borderRadius: 7, padding: "9px 12px", border: "0.5px solid " + loanStrategy.border }}>
                    <div style={{ fontSize: 9, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 2 }}>Portfolio LTV</div>
                    <div style={{ fontSize: 14, color: loanStrategy.color, fontWeight: 600 }}>{fmtPct(portfolioLtv)}</div>
                  </div>
                  <div style={{ background: loanStrategy.color + "08", borderRadius: 7, padding: "9px 12px", border: "0.5px solid " + loanStrategy.border }}>
                    <div style={{ fontSize: 9, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 2 }}>Highest LTV</div>
                    <div style={{ fontSize: 14, color: ltvBarColor(maxLtv), fontWeight: 600 }}>{fmtPct(maxLtv)}</div>
                  </div>
                  <div style={{ background: loanStrategy.color + "08", borderRadius: 7, padding: "9px 12px", border: "0.5px solid " + loanStrategy.border }}>
                    <div style={{ fontSize: 9, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 2 }}>Liq. Distance</div>
                    <div style={{ fontSize: 14, color: liquidationDistance !== null && liquidationDistance < 0.3 ? "#7B2D2D" : loanStrategy.color, fontWeight: 600 }}>{liquidationDistance !== null ? (liquidationDistance * 100).toFixed(0) + "%" : "—"}</div>
                  </div>
                  <div style={{ background: loanStrategy.color + "08", borderRadius: 7, padding: "9px 12px", border: "0.5px solid " + loanStrategy.border }}>
                    <div style={{ fontSize: 9, color: "#5A5855", letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 500, marginBottom: 2 }}>Total Debt</div>
                    <div style={{ fontSize: 14, color: "#1A1816", fontWeight: 600 }}>{fmtUSD(totalDebt)}</div>
                  </div>
                </div>
              </div>

              {/* Bottom metrics row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Highest LTV</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: ltvBarColor(maxLtv), letterSpacing: "-0.02em" }}>{fmtPct(maxLtv)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Total Debt</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: "#1A1816", letterSpacing: "-0.02em" }}>{fmtUSD(totalDebt)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#5A5855", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>Liq. Distance</div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, color: liquidationDistance !== null && liquidationDistance < 0.3 ? "#7B2D2D" : "#1A1816", letterSpacing: "-0.02em" }}>{liquidationDistance !== null ? (liquidationDistance * 100).toFixed(0) + "%" : "—"}</div>
                </div>
              </div>
            </div>

            {/* ── Indicators at a glance ── */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 2, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "#1A1816", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>Indicators</span>
                <div style={{ flex: 1, height: "1px", background: "#D8D4CC" }} />
              </div>
            </div>
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>At a Glance</div>
              {indicators.map((ind) => (
                <div key={ind.label} className="ind-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "#2A2725" }}>{ind.label}</span>
                    {ind.auto && <span style={{ fontSize: 10, color: "#C8963A", background: "#FDF3E3", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.04em" }}>AUTO</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "#3A3835", fontVariantNumeric: "tabular-nums" }}>{String(ind.value)}</span>
                    <span className="score-chip" style={{ background: ind.score > 0 ? "#E8F5ED" : ind.score < 0 ? "#FDECEA" : "#F4F3F0", color: ind.score > 0 ? "#2D5A3D" : ind.score < 0 ? "#7B2D2D" : "#6B6760" }}>
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

        {/* ── LOANS TAB ── */}
        {activeTab === "loans" && (
          <LoansTab
            loans={loans} loanLtvs={loanLtvs} editingLoan={editingLoan} setEditingLoan={setEditingLoan}
            showAddLoan={showAddLoan} setShowAddLoan={setShowAddLoan} newLoan={newLoan} setNewLoan={setNewLoan}
            handleAddLoan={handleAddLoan} handleSaveLoan={handleSaveLoan} handleDeleteLoan={handleDeleteLoan}
            totalDebt={totalDebt} portfolioLtv={portfolioLtv} btcPrice={btcPrice}
            fmtUSD={fmtUSD} fmtPct={fmtPct} fmt={fmt} ltvBarColor={ltvBarColor}
          />
        )}

        {/* ── INDICATORS TAB ── */}
        {activeTab === "indicators" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Automatic */}
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

            {/* Fear & Greed */}
            <div className="metric-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase" }}>Fear & Greed Index</div>
                <span style={{ fontSize: 10, color: "#C8963A", background: "#FDF3E3", padding: "1px 6px", borderRadius: 3, letterSpacing: "0.04em" }}>AUTO</span>
              </div>
              <div style={{ fontSize: 12, color: "#AAA", marginBottom: 16 }}>Reference only — not weighted in the signal score</div>
              {fearGreed ? (
                <div>
                  {/* Today */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12, marginBottom: 12, borderBottom: "0.5px solid #EBEBEB" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Today</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: fearGreed.value >= 75 ? "#7B2D2D" : fearGreed.value >= 55 ? "#8B6914" : fearGreed.value >= 45 ? "#4A4845" : fearGreed.value >= 25 ? "#4A7C5A" : "#2D5A3D", letterSpacing: "-0.02em" }}>{fearGreed.value}</span>
                        <span style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>{fearGreed.label}</span>
                      </div>
                    </div>
                    {/* Mini gauge */}
                    <div style={{ width: 120 }}>
                      <div style={{ height: 6, borderRadius: 3, background: "linear-gradient(to right, #2D5A3D, #4A7C5A, #9A9590, #C88A1A, #A83030)", position: "relative", marginBottom: 4 }}>
                        <div style={{ position: "absolute", top: "50%", left: fearGreed.value + "%", transform: "translate(-50%, -50%)", width: 10, height: 10, borderRadius: "50%", background: "#fff", border: "2px solid #1A1816", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#CCC" }}>
                        <span>Fear</span><span>Greed</span>
                      </div>
                    </div>
                  </div>
                  {/* Yesterday */}
                  <div className="ind-row">
                    <span style={{ fontSize: 13, color: "#888" }}>Yesterday</span>
                    <span style={{ fontSize: 13, color: "#555" }}>{fearGreed.prev} — {fearGreed.prevLabel}</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#CCC", padding: "8px 0" }}>Loading…</div>
              )}
            </div>

            {/* Manual */}
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Manual Indicators</div>
              <div style={{ fontSize: 12, color: "#AAA", marginBottom: 16 }}>Update weekly from Glassnode, CryptoQuant, or similar</div>
              <div style={{ display: "grid", gap: 18 }}>

                {/* MVRV */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#888" }}>MVRV Z-Score <span style={{ color: "#CCC" }}>(current: {manual.mvrv})</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: staleness(manualTimestamps.mvrv).dot }} />
                      <span style={{ fontSize: 11, color: staleness(manualTimestamps.mvrv).color }}>{staleness(manualTimestamps.mvrv).label}</span>
                    </div>
                  </div>
                  <input className="inp" type="number" step="0.01" value={manual.mvrv}
                    onChange={e => {
                      setManual({ ...manual, mvrv: e.target.value });
                      setManualTimestamps({ ...manualTimestamps, mvrv: new Date().toISOString() });
                    }}
                    style={{ maxWidth: 180 }} />
                  <div style={{ fontSize: 11, color: "#CCC", marginTop: 4 }}>Bullish &lt; 1.0 · Bearish &gt; 6.0</div>
                </div>

                {/* Puell */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#888" }}>Puell Multiple <span style={{ color: "#CCC" }}>(current: {manual.puell})</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: staleness(manualTimestamps.puell).dot }} />
                      <span style={{ fontSize: 11, color: staleness(manualTimestamps.puell).color }}>{staleness(manualTimestamps.puell).label}</span>
                    </div>
                  </div>
                  <input className="inp" type="number" step="0.01" value={manual.puell}
                    onChange={e => {
                      setManual({ ...manual, puell: e.target.value });
                      setManualTimestamps({ ...manualTimestamps, puell: new Date().toISOString() });
                    }}
                    style={{ maxWidth: 180 }} />
                  <div style={{ fontSize: 11, color: "#CCC", marginTop: 4 }}>Bullish &lt; 0.5 · Bearish &gt; 4.0</div>
                </div>

                {/* LTH */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#888" }}>LTH Supply Trend</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: staleness(manualTimestamps.lthTrend).dot }} />
                      <span style={{ fontSize: 11, color: staleness(manualTimestamps.lthTrend).color }}>{staleness(manualTimestamps.lthTrend).label}</span>
                    </div>
                  </div>
                  <select className="sel" value={manual.lthTrend}
                    onChange={e => {
                      setManual({ ...manual, lthTrend: e.target.value });
                      setManualTimestamps({ ...manualTimestamps, lthTrend: new Date().toISOString() });
                    }}>
                    <option value="Accumulating">Accumulating</option>
                    <option value="Neutral">Neutral</option>
                    <option value="Dumping">Dumping</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Weights */}
            <div className="metric-card">
              <div style={{ fontSize: 11, color: "#AAA", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 }}>Indicator Weights</div>
              {Object.entries(WEIGHTS).map(([k, w]) => {
                const labels = { mvrv: "MVRV Z-Score", powerLaw: "Power Law", sma200w: "200W SMA", puell: "Puell Multiple", lth: "LTH Supply Trend", rsi: "Weekly RSI" };
                return (
                  <div key={k} className="ind-row">
                    <span style={{ fontSize: 14 }}>{labels[k]}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[1, 2, 3].map((dot) => (<div key={dot} style={{ width: 8, height: 8, borderRadius: "50%", background: dot <= w ? "#1C1C1A" : "#E8E7E4" }} />))}
                    </div>
                  </div>
                );
              })}
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
                <div style={{ textAlign: "center", padding: "40px 0", color: "#CCC", fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>chart</div>
                  <div>Your score history will build up here day by day.</div>
                </div>
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
