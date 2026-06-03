// ── Scoring functions ──────────────────────────────────────────────

export const WEIGHTS = { mvrv: 3, powerLaw: 3, puell: 2, lth: 2, nupl: 2, reserveRisk: 2 };

export function scoreMVRV(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 1.0) return w; if (n > 6) return -w; return 0; }
export function scorePowerLaw(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 20) return w; if (n > 75) return -w; return 0; }
export function scorePuell(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.5) return w; if (n > 4) return -w; return 0; }
export function scoreLTH(v, w) { if (v === "Accumulating") return w; if (v === "Dumping") return -w; return 0; }
export function scoreNUPL(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.1) return w; if (n > 0.6) return -w; return 0; }
export function scoreReserveRisk(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.0026) return w; if (n > 0.006) return -w; return 0; }

// ── Market Outlook ─────────────────────────────────────────────────

export function getMarketOutlook(score) {
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

// ── BTC Strategy — market signal only ─────────────────────────────

export function getBtcStrategy(score) {
  if (score <= -6) return {
    action: "Accumulate Aggressively",
    confidence: "High",
    reason: "Multiple indicators are at levels historically associated with major cycle lows. Conditions like these have been among the strongest long-term entry points Bitcoin has ever offered. This is the window patient holders position themselves for.",
    color: "#1A5C38", bg: "#EDF7F2", border: "#7DC4A0"
  };
  if (score <= 0) return {
    action: "Accumulate",
    confidence: "High",
    reason: "Bitcoin is trading below where the indicators suggest fair value lies. The on-chain picture favours buyers at these levels. Continue building your position steadily.",
    color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E"
  };
  if (score <= 4) return {
    action: "Hold",
    confidence: "Medium",
    reason: "No strong signal in either direction. Bitcoin appears to be trading around fair value. The sensible move is to hold your position and wait for a clearer opportunity before deploying further capital.",
    color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC"
  };
  if (score <= 8) return {
    action: "Pause Accumulation",
    confidence: "High",
    reason: "Several indicators are showing late-cycle characteristics. Bitcoin may continue higher but the risk-reward of adding at these levels is no longer attractive. Hold what you have and avoid deploying fresh capital.",
    color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A"
  };
  return {
    action: "Consider Reducing",
    confidence: "High",
    reason: "Multiple indicators are at extremes historically associated with cycle tops. Conditions like these have typically preceded significant corrections. Holding is reasonable — adding here is not.",
    color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8"
  };
}

// ── Loan Strategy — unchanged ──────────────────────────────────────

export function getLoanStrategy(portfolioLtv, maxLtv) {
  const dominant = Math.max(portfolioLtv, maxLtv);
  if (dominant >= 0.50) return { label: "Danger Zone", action: "Immediate Attention Required", situation: "Your portfolio LTV has entered the danger threshold.", why: "A modest further decline in BTC price could trigger forced liquidation by your lender, resulting in loss of collateral.", what: "Prioritise debt reduction or add collateral immediately. This takes precedence over any accumulation activity.", color: "#7B2D2D", bg: "#FDF4F4", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4 };
  if (dominant >= 0.40) return { label: "Elevated Risk", action: "Reduce Risk", situation: "Collateral coverage is thinning as LTV approaches the danger zone.", why: "A 20–25% decline in BTC price from here would push your position into dangerous territory. The margin for error is narrow.", what: "Consider paying down the highest-LTV loan or adding collateral to create a more comfortable buffer before deploying further capital.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3 };
  if (dominant >= 0.30) return { label: "Moderate Risk", action: "Monitor Closely", situation: "Leverage is within acceptable bounds but deserves attention.", why: "Your collateral structure can absorb moderate price weakness, but a sustained drawdown would erode your buffer meaningfully.", what: "No immediate intervention required. Review if BTC declines more than 15–20% from current levels.", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090", badge: { bg: "#7A6830", text: "#FAF8F5" }, level: 2 };
  if (dominant >= 0.20) return { label: "Safe", action: "Maintain Structure", situation: "Debt and collateral levels are well-balanced.", why: "Your current LTV provides a healthy buffer against price volatility. The portfolio is structured conservatively.", what: "No action required. Continue your existing strategy and review when market conditions or loan balances change materially.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 1 };
  return { label: "Very Safe", action: "Opportunity to Optimise Collateral", situation: "Portfolio leverage is substantially below optimal levels.", why: "You are holding more collateral than your current debt requires. This capital could be working harder within a still-conservative risk profile.", what: "You may be able to safely release collateral or increase debt capacity while remaining well within safe LTV thresholds.", color: "#1E3F5A", bg: "#F2F6FA", border: "#8AAEC8", badge: { bg: "#1E3F5A", text: "#FAF8F5" }, level: 0 };
}
