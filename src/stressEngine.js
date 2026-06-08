// ============================================================
// BTC TREASURY — STRESS ENGINE
// stressEngine.js
//
// Principle: TURN MATH INTO MEANING
// Every calculation produces interpretation alongside numbers.
// UI layers consume meaning — they do not produce it.
// ============================================================

// ------------------------------------------------------------
// RISK FRAMEWORK
// BTC Treasury default thresholds (not lender liquidation levels)
// ------------------------------------------------------------
const RISK_ZONES = [
  { label: "Very Safe",      min: 0,    max: 0.20, color: "#1E3F5A", bg: "#F2F6FA", border: "#8AAEC8", badge: { bg: "#1E3F5A", text: "#FAF8F5" } },
  { label: "Safe",           min: 0.20, max: 0.35, color: "#2D5A3D", bg: "#F2F8F4", border: "#8FBD9E", badge: { bg: "#2D5A3D", text: "#FAF8F5" } },
  { label: "Moderate Risk",  min: 0.35, max: 0.50, color: "#7A6830", bg: "#FAF7EE", border: "#CFC090", badge: { bg: "#7A6830", text: "#FAF8F5" } },
  { label: "Elevated Risk",  min: 0.50, max: 0.65, color: "#8B6914", bg: "#FBF8EF", border: "#D4BC7A", badge: { bg: "#8B6914", text: "#FAF8F5" } },
  { label: "Danger Zone",    min: 0.65, max: Infinity, color: "#7B2D2D", bg: "#FBF2F2", border: "#D4A8A8", badge: { bg: "#7B2D2D", text: "#FAF8F5" } },
];

const LENDER_THRESHOLDS = {
  autoTopUp: 0.70,
  liquidation: 0.80,
};

// ------------------------------------------------------------
// SCENARIO DRAWDOWNS
// ------------------------------------------------------------
const SCENARIOS = [0, -0.10, -0.20, -0.30, -0.40, -0.50, -0.60, -0.70, -0.80];

// ------------------------------------------------------------
// HISTORICAL SCENARIOS
// Applied to current price/structure — "would you have survived?"
// ------------------------------------------------------------
const HISTORICAL_SCENARIOS = [
  { name: "March 2020 Crash",        drawdown: -0.60, period: "Mar 2020",  context: "COVID-19 market panic triggered a rapid 60% collapse in Bitcoin price over weeks." },
  { name: "2021 Mid-Cycle Correction", drawdown: -0.53, period: "May 2021", context: "Bitcoin fell 53% from its April 2021 peak during a prolonged mid-bull-market correction." },
  { name: "2022 Bear Market",         drawdown: -0.77, period: "Nov 2022",  context: "Bitcoin declined 77% from its 2021 all-time high during the worst bear market in a decade." },
  { name: "FTX Collapse",             drawdown: -0.25, period: "Nov 2022",  context: "The FTX exchange collapse triggered a rapid 25% drawdown in Bitcoin over days." },
];

// ------------------------------------------------------------
// CORE HELPERS
// ------------------------------------------------------------

function getRiskZone(ltv) {
  return RISK_ZONES.find(z => ltv >= z.min && ltv < z.max) || RISK_ZONES[RISK_ZONES.length - 1];
}

function calcLtv(debt, collateralBtc, btcPrice) {
  if (!btcPrice || !collateralBtc || collateralBtc === 0) return 0;
  return debt / (collateralBtc * btcPrice);
}

function calcPortfolioLtv(loans, btcPrice) {
  const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
  const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
  return calcLtv(totalDebt, totalCollateral, btcPrice);
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
}

function fmtUSD(n) {
  if (!n) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ------------------------------------------------------------
// MEANING ENGINE
// Produces plain-English interpretation for every scenario result
// ------------------------------------------------------------

function getPortfolioMeaning(zone, drawdown, ltv) {
  const pct = Math.abs(drawdown * 100).toFixed(0);
  const ltvPct = (ltv * 100).toFixed(1);
  if (zone.label === "Very Safe") return "Your portfolio remains resilient. Even at this price level your collateral structure provides substantial protection.";
  if (zone.label === "Safe") return "Leverage remains conservative. Your treasury can absorb this drawdown without meaningful stress.";
  if (zone.label === "Moderate Risk") return "Your portfolio is under noticeable pressure at this level. Monitor loan health closely and avoid adding new debt.";
  if (zone.label === "Elevated Risk") return "Collateral additions or debt reduction would become necessary. Action should be considered before reaching this level.";
  return "Your current structure becomes vulnerable at this price. Forced collateral top-ups or liquidation risk would be material concerns.";
}

function getLoanMeaning(zone, loanName) {
  if (zone.label === "Very Safe") return "This loan remains well within safe thresholds at this price level.";
  if (zone.label === "Safe") return "Current leverage on " + loanName + " remains conservative at this level.";
  if (zone.label === "Moderate Risk") return "Monitor " + loanName + " closely during major drawdowns. No immediate action required but buffer is thinning.";
  if (zone.label === "Elevated Risk") return "Additional collateral on " + loanName + " may become necessary at this level. This approaches lender auto top-up territory.";
  return loanName + " becomes vulnerable at this price. Lender intervention or forced top-up is a material risk.";
}

function getHistoricalMeaning(zone, scenarioName) {
  if (zone.label === "Very Safe") return "Your current structure would have remained resilient throughout the " + scenarioName + ".";
  if (zone.label === "Safe") return "Your treasury would have remained stable during the " + scenarioName + " without requiring intervention.";
  if (zone.label === "Moderate Risk") return "The " + scenarioName + " would have placed your portfolio under meaningful pressure. Monitoring would have been required.";
  if (zone.label === "Elevated Risk") return "The " + scenarioName + " would have required action — collateral additions or debt reduction to avoid further deterioration.";
  return "Your current structure would not have survived the " + scenarioName + " without significant intervention or forced liquidation.";
}

function getBtcBufferMeaning(bufferPct, currentZone) {
  if (bufferPct === null) return "Your portfolio is already in or beyond Elevated Risk. Immediate attention is required.";
  const pct = (bufferPct * 100).toFixed(0);
  if (bufferPct > 0.50) return "Your treasury is exceptionally resilient. Bitcoin could fall another " + pct + "% before portfolio risk reaches Elevated Risk.";
  if (bufferPct > 0.30) return "Your treasury has a solid buffer. Bitcoin could decline another " + pct + "% before portfolio risk reaches Elevated Risk.";
  if (bufferPct > 0.15) return "Your buffer is moderate. A further " + pct + "% decline in Bitcoin would push portfolio risk into Elevated territory.";
  return "Your buffer is thin. Only a " + pct + "% further decline would push your portfolio into Elevated Risk. Consider strengthening your position.";
}

function getWeakestLinkMeaning(loan, bufferPct) {
  const name = loan.lender;
  const pct = bufferPct !== null ? (bufferPct * 100).toFixed(0) : null;
  if (pct === null) return name + " is already in or beyond Elevated Risk and requires immediate attention.";
  if (bufferPct > 0.40) return name + " is your most exposed loan, though it still has a reasonable buffer of " + pct + "% before reaching Elevated Risk.";
  if (bufferPct > 0.20) return name + " would be the first loan to enter Elevated Risk during a major Bitcoin decline. A " + pct + "% further drop would trigger that threshold.";
  return name + " has a thin buffer of only " + pct + "%. This loan deserves priority attention and should be the first to receive additional collateral or debt reduction.";
}

// ------------------------------------------------------------
// ENGINE EXPORTS
// ------------------------------------------------------------

export function runPortfolioStressTest(loans, btcPrice) {
  if (!btcPrice || !loans || loans.length === 0) return [];

  return SCENARIOS.map(drawdown => {
    const scenarioPrice = btcPrice * (1 + drawdown);
    const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
    const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
    const collateralValue = totalCollateral * scenarioPrice;
    const ltv = totalDebt / collateralValue;
    const zone = getRiskZone(ltv);
    const breachesAutoTopUp = ltv >= LENDER_THRESHOLDS.autoTopUp;
    const breachesLiquidation = ltv >= LENDER_THRESHOLDS.liquidation;

    return {
      drawdown,
      drawdownLabel: drawdown === 0 ? "Current" : (drawdown * 100).toFixed(0) + "%",
      btcPrice: scenarioPrice,
      btcPriceFormatted: fmtUSD(Math.round(scenarioPrice)),
      collateralValue,
      collateralValueFormatted: fmtUSD(Math.round(collateralValue)),
      totalDebt,
      ltv,
      ltvFormatted: fmtPct(ltv),
      zone,
      breachesAutoTopUp,
      breachesLiquidation,
      meaning: getPortfolioMeaning(zone, drawdown, ltv),
      isCurrent: drawdown === 0,
    };
  });
}

export function runLoanStressTest(loan, btcPrice) {
  if (!btcPrice || !loan) return [];
  const debt = parseFloat(loan.debt) || 0;
  const collateral = parseFloat(loan.collateral) || 0;

  return SCENARIOS.map(drawdown => {
    const scenarioPrice = btcPrice * (1 + drawdown);
    const ltv = calcLtv(debt, collateral, scenarioPrice);
    const zone = getRiskZone(ltv);
    const breachesAutoTopUp = ltv >= LENDER_THRESHOLDS.autoTopUp;
    const breachesLiquidation = ltv >= LENDER_THRESHOLDS.liquidation;

    return {
      drawdown,
      drawdownLabel: drawdown === 0 ? "Current" : (drawdown * 100).toFixed(0) + "%",
      btcPrice: scenarioPrice,
      btcPriceFormatted: fmtUSD(Math.round(scenarioPrice)),
      ltv,
      ltvFormatted: fmtPct(ltv),
      zone,
      breachesAutoTopUp,
      breachesLiquidation,
      meaning: getLoanMeaning(zone, loan.lender),
      isCurrent: drawdown === 0,
    };
  });
}

export function calcBtcBuffer(loans, btcPrice) {
  if (!btcPrice || !loans || loans.length === 0) return { bufferPct: null, bufferPrice: null, meaning: getBtcBufferMeaning(null, null) };

  const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
  const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);

  // Find price at which portfolio hits Elevated Risk threshold (50% LTV)
  const elevatedThreshold = RISK_ZONES.find(z => z.label === "Elevated Risk").min;
  // debt / (collateral * price) = threshold => price = debt / (collateral * threshold)
  const priceAtElevated = totalDebt / (totalCollateral * elevatedThreshold);
  const bufferPct = priceAtElevated < btcPrice ? (btcPrice - priceAtElevated) / btcPrice : null;

  const currentLtv = calcPortfolioLtv(loans, btcPrice);
  const currentZone = getRiskZone(currentLtv);

  return {
    bufferPct,
    bufferPctFormatted: bufferPct !== null ? (bufferPct * 100).toFixed(0) + "%" : "—",
    bufferPrice: priceAtElevated,
    bufferPriceFormatted: fmtUSD(Math.round(priceAtElevated)),
    currentZone,
    thresholdZone: RISK_ZONES.find(z => z.label === "Elevated Risk"),
    meaning: getBtcBufferMeaning(bufferPct, currentZone),
    tooltip: "BTC Buffer measures how much additional downside Bitcoin could experience before your portfolio enters Elevated Risk. Higher values indicate greater resilience. The purpose is to answer: \"How much pain can my treasury absorb?\"",
  };
}

export function getWeakestLink(loans, btcPrice) {
  if (!btcPrice || !loans || loans.length === 0) return null;

  const elevatedThreshold = RISK_ZONES.find(z => z.label === "Elevated Risk").min;

  const analyzed = loans.map(loan => {
    const debt = parseFloat(loan.debt) || 0;
    const collateral = parseFloat(loan.collateral) || 0;
    const currentLtv = calcLtv(debt, collateral, btcPrice);
    const currentZone = getRiskZone(currentLtv);
    const priceAtElevated = debt / (collateral * elevatedThreshold);
    const bufferPct = priceAtElevated < btcPrice ? (btcPrice - priceAtElevated) / btcPrice : null;

    return {
      ...loan,
      currentLtv,
      currentLtvFormatted: fmtPct(currentLtv),
      currentZone,
      bufferPct,
      bufferPctFormatted: bufferPct !== null ? (bufferPct * 100).toFixed(0) + "%" : "Already Elevated",
      meaning: getWeakestLinkMeaning(loan, bufferPct),
    };
  });

  // Weakest = smallest buffer (or already in elevated/danger)
  analyzed.sort((a, b) => {
    if (a.bufferPct === null && b.bufferPct === null) return b.currentLtv - a.currentLtv;
    if (a.bufferPct === null) return -1;
    if (b.bufferPct === null) return 1;
    return a.bufferPct - b.bufferPct;
  });

  return analyzed[0];
}

export function runHistoricalScenarios(loans, btcPrice) {
  if (!btcPrice || !loans || loans.length === 0) return [];

  return HISTORICAL_SCENARIOS.map(scenario => {
    const scenarioPrice = btcPrice * (1 + scenario.drawdown);
    const totalDebt = loans.reduce((s, l) => s + (parseFloat(l.debt) || 0), 0);
    const totalCollateral = loans.reduce((s, l) => s + (parseFloat(l.collateral) || 0), 0);
    const portfolioLtv = totalDebt / (totalCollateral * scenarioPrice);
    const portfolioZone = getRiskZone(portfolioLtv);

    const loanResults = loans.map(loan => {
      const debt = parseFloat(loan.debt) || 0;
      const collateral = parseFloat(loan.collateral) || 0;
      const ltv = calcLtv(debt, collateral, scenarioPrice);
      return { ...loan, ltv, ltvFormatted: fmtPct(ltv), zone: getRiskZone(ltv) };
    });

    const highestLoanLtv = Math.max(...loanResults.map(l => l.ltv));
    const highestLoanZone = getRiskZone(highestLoanLtv);
    const wouldSurvive = portfolioZone.label !== "Danger Zone";

    return {
      ...scenario,
      drawdownLabel: (scenario.drawdown * 100).toFixed(0) + "%",
      scenarioPrice,
      scenarioPriceFormatted: fmtUSD(Math.round(scenarioPrice)),
      portfolioLtv,
      portfolioLtvFormatted: fmtPct(portfolioLtv),
      portfolioZone,
      highestLoanLtv,
      highestLoanLtvFormatted: fmtPct(highestLoanLtv),
      highestLoanZone,
      loanResults,
      wouldSurvive,
      meaning: getHistoricalMeaning(portfolioZone, scenario.name),
    };
  });
}

export function getRiskZoneStyle(ltv) {
  return getRiskZone(ltv);
}

export { RISK_ZONES, LENDER_THRESHOLDS, fmtPct, fmtUSD };
