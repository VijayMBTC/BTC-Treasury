// ── Scoring functions ──────────────────────────────────────────────
// Positive score = bullish, Negative score = bearish

export const WEIGHTS = { mvrv: 3, powerLaw: 3, puell: 2, lth: 2, nupl: 2, reserveRisk: 2 };

export function scoreMVRV(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 1.5) return w; if (n > 6) return -w; return 0; }
export function scorePowerLaw(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 25) return w; if (n > 75) return -w; return 0; }
export function scorePuell(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 1.0) return w; if (n > 4) return -w; return 0; }
export function scoreLTH(v, w) { if (v === "Accumulating") return w; if (v === "Dumping") return -w; return 0; }
export function scoreNUPL(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.25) return w; if (n > 0.6) return -w; return 0; }
export function scoreReserveRisk(v, w) { if (v === "" || v === null || v === undefined) return 0; const n = parseFloat(v); if (n < 0.0026) return w; if (n > 0.006) return -w; return 0; }

// ── Market Outlook ─────────────────────────────────────────────────
// High positive = bullish, High negative = bearish

export function getMarketOutlook(score) {
  if (score >= 10) return {
    label: "Generational Buying Opportunity",
    body: "Almost everything you're watching is pointing the same way right now. Conditions like these have historically been among the strongest entry points Bitcoin has ever offered — and you're in a position to take advantage of them.",
    color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E",
    badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 0
  };
  if (score >= 4) return {
    label: "Accumulation Zone",
    body: "The indicators are tilting in your favour. Bitcoin looks undervalued relative to where it has historically traded, and the on-chain picture suggests patient buyers have tended to be rewarded from conditions like these.",
    color: "#4A7C5A", bg: "#F4F9F5", border: "#A0C8AD",
    badge: { bg: "#4A7C5A", text: "#FAF8F5" }, level: 1
  };
  if (score >= -2) return {
    label: "Fair Value",
    body: "The indicators aren't sending a strong signal in either direction right now. Bitcoin appears to be trading around fair value — there's no obvious reason to rush in or pull back. Patience is the right posture here.",
    color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC",
    badge: { bg: "#4A4845", text: "#FAF8F5" }, level: 2
  };
  if (score >= -8) return {
    label: "Overvalued",
    body: "A number of the indicators you're tracking are starting to flash late-cycle signals. Bitcoin may well go higher from here, but the risk of adding fresh capital at these levels has increased meaningfully.",
    color: "#8B6914", bg: "#FCF9F0", border: "#D4BC7A",
    badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3
  };
  return {
    label: "Euphoria",
    body: "Multiple indicators are at the kind of extremes that have historically appeared near cycle tops. That doesn't mean the top is in today — but it does mean the risk profile has shifted significantly.",
    color: "#7B2D2D", bg: "#FDF4F4", border: "#D4A8A8",
    badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4
  };
}

// ── BTC Strategy — market signal only ─────────────────────────────

export function getBtcStrategy(score) {
  if (score >= 10) return {
    action: "Deploy Meaningfully",
    confidence: "High",
    reason: "This is the kind of window long-term Bitcoin holders position themselves for. If you have dry powder sitting anywhere — savings, reduced debt capacity, underdeployed capital — you may want to consider putting it to work now. Conditions like these don't last long, and missing them by waiting for a perfect entry is one of the most common and costly mistakes in Bitcoin treasury management.",
    color: "#1A5C38", bg: "#EDF7F2", border: "#7DC4A0"
  };
  if (score >= 4) return {
    action: "Accumulate Steadily",
    confidence: "High",
    reason: "You don't need to rush, but you do want to keep adding consistently. A disciplined DCA approach works well here — it keeps you building through the accumulation zone without trying to time a precise bottom. Missing this window by waiting for things to get cheaper is a risk in itself.",
    color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E"
  };
  if (score >= -2) return {
    action: "Hold Steady",
    confidence: "Medium",
    reason: "There's no compelling signal to act in either direction right now. Your existing position is well-placed — you may want to consider staying the course and letting it work rather than adding aggressively or reducing prematurely. A clearer opportunity will come.",
    color: "#4A4845", bg: "#F5F3EF", border: "#C8C4BC"
  };
  if (score >= -8) return {
    action: "Stop Accumulating",
    confidence: "High",
    reason: "The risk-reward of adding fresh capital at these levels has shifted. You may want to consider holding what you have and avoiding new purchases for now. This is also a good moment to look at your loan structure — strengthening it while conditions are still relatively comfortable gives you more flexibility if the market turns.",
    color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A"
  };
  return {
    action: "Consider Trimming",
    confidence: "High",
    reason: "You've done the hard work of holding through the cycle — it may be worth considering taking some off the table now. Not a wholesale exit, but a thoughtful reduction: rebuilding cash reserves, covering lifestyle needs, or paying down debt. Cycle tops rarely announce themselves clearly, and there's nothing wrong with banking some of what you've built near one.",
    color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8"
  };
}

// ── Loan Strategy ──────────────────────────────────────────────────

export function getLoanStrategy(portfolioLtv, maxLtv) {
  const dominant = Math.max(portfolioLtv, maxLtv);
  if (dominant >= 0.50) return { label: "Danger Zone", action: "Immediate Attention Required", situation: "Your portfolio LTV has entered dangerous territory and needs attention now.", why: "A modest further decline in BTC price could trigger forced liquidation by your lender — meaning you could lose collateral you've spent years accumulating, at exactly the wrong moment.", what: "You may want to prioritise debt reduction or adding collateral immediately. Everything else is secondary to this right now.", color: "#7B2D2D", bg: "#FDF4F4", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" }, level: 4 };
  if (dominant >= 0.40) return { label: "Elevated Risk", action: "Consider Reducing Risk", situation: "Your collateral coverage is thinning as LTV approaches the danger zone.", why: "A 20–25% decline in BTC from here would push your position into genuinely uncomfortable territory. The margin for error is narrower than you'd want it to be.", what: "You may want to consider paying down the highest-LTV loan or adding collateral before deploying any further capital. Getting ahead of this is much easier than reacting to it.", color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" }, level: 3 };
  if (dominant >= 0.30) return { label: "Moderate Risk", action: "Keep an Eye on This", situation: "Your leverage is within acceptable bounds, but it's worth staying attentive.", why: "Your structure can absorb moderate price weakness, but a sustained drawdown would start to erode your buffer in a way that could limit your options.", what: "No immediate action needed — but you may want to revisit this if BTC declines more than 15–20% from current levels.", color: "#7A6830", bg: "#FAF7EE", border: "#CFC090", badge: { bg: "#7A6830", text: "#FAF8F5" }, level: 2 };
  if (dominant >= 0.20) return { label: "Safe", action: "Stay the Course", situation: "Your debt and collateral levels are well-balanced.", why: "You have a healthy buffer against price volatility. The structure you've built is working as it should.", what: "No action needed. Continue your existing approach and revisit when market conditions or your loan balances change materially.", color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" }, level: 1 };
  return { label: "Very Safe", action: "Your Collateral Could Work Harder", situation: "Your leverage is substantially below where it needs to be.", why: "You're holding more collateral than your current debt requires. That capital has an opportunity cost — it could be deployed more effectively while still keeping you well within a conservative risk profile.", what: "You may want to consider whether there's an opportunity to release some collateral or increase your debt capacity — while staying comfortably within safe LTV thresholds.", color: "#1E3F5A", bg: "#F2F6FA", border: "#8AAEC8", badge: { bg: "#1E3F5A", text: "#FAF8F5" }, level: 0 };
}
