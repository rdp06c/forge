// Composite scoring + enrichment orchestration
// Wires together technicals + signals into a complete enriched market view
import { stockSectors } from '../config/constants.js';
import { DEFAULT_WEIGHTS } from '../config/calibration.js';
import {
    calculateRSI, calculateSMA, calculateMACD, calculateSMACrossover,
    detectStructure, calculate5DayMomentum, calculateRelativeStrength,
    detectSectorRotation, calculateATR
} from './technicals.js';
import { evaluateMarketSignals } from './signals.js';

// Re-export detectSectorRotation so engine can import from here
export { detectSectorRotation };

/**
 * Composite Score — synced with APEX's current scoring (Mar 3, 2026)
 * Returns { total, breakdown } matching APEX's format
 */
export function calculateCompositeScore({ momentumScore, rsNormalized, sectorFlow, structureScore, isAccelerating, upDays, totalDays, todayChange, totalReturn5d, rsi, macdCrossover, daysToCover, volumeTrend, fvg, sma20, currentPrice, smaCrossover }, weights) {
    const w = weights || DEFAULT_WEIGHTS;

    const momentumContrib = momentumScore * w.momentumMultiplier;
    const rsContrib = rsNormalized * w.rsMultiplier;

    let sectorBonus = 0;
    if (sectorFlow === 'inflow') sectorBonus = w.sectorInflow;
    else if (sectorFlow === 'modest-inflow') sectorBonus = w.sectorModestInflow;
    else if (sectorFlow === 'outflow') sectorBonus = w.sectorOutflow;

    const accelBonus = isAccelerating && momentumScore >= 6 ? w.accelBonus : 0;
    const consistencyBonus = (upDays >= 3 && totalDays >= 4) ? w.consistencyBonus : 0;
    const structureBonus = (structureScore || 0) * w.structureMultiplier;

    const chg = todayChange || 0;
    const runnerPenalty = chg >= 15 ? -3 : chg >= 10 ? -2 : chg >= 7 ? -1 : chg >= 5 ? -0.5 : 0;
    const declinePenalty = 0; // Removed: anti-predictive per APEX calibration

    const extensionPenalty = (momentumScore >= 9 && rsNormalized >= 8.5) ? -5
        : (momentumScore >= 9 || rsNormalized >= 8.5) ? -3.5
        : (momentumScore >= 8 || rsNormalized >= 8) ? -2
        : (momentumScore >= 7.5 || rsNormalized >= 7.5) ? -1
        : 0;

    const ret5d = totalReturn5d ?? 0;
    const pullbackBonus =
        (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 2 && sectorFlow !== 'outflow') ? 5
        : (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow' && sectorFlow !== 'modest-outflow') ? 4
        : (ret5d >= -5 && ret5d < 0 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow') ? 3
        : (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 0) ? 2
        : (ret5d >= -5 && ret5d < 0 && (structureScore ?? 0) >= 0 && sectorFlow !== 'outflow') ? 1
        : 0;

    const rsiBonusPenalty = rsi != null
        ? (rsi < 30 ? w.rsiOversold30 : rsi < 40 ? w.rsiOversold40 : rsi < 50 ? w.rsiOversold50
            : rsi > 80 ? w.rsiOverbought80 : rsi > 70 ? w.rsiOverbought70 : 0)
        : 0;
    const macdBonus = macdCrossover === 'bullish' ? w.macdBullish : macdCrossover === 'bearish' ? w.macdBearish : w.macdNone;

    const rsMeanRevPenalty = rsNormalized >= 9.5 ? w.rsMeanRev95 : rsNormalized >= 9 ? w.rsMeanRev90 : rsNormalized >= 8.5 ? w.rsMeanRev85 : 0;

    const dtc = daysToCover || 0;
    const squeezeBonus = (dtc > 5 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow') ? w.squeezeBonusHigh
        : (dtc > 3 && (structureScore ?? 0) >= 1) ? w.squeezeBonusMod
        : 0;

    const vt = volumeTrend ?? 1;
    const volumeBonus = (momentumScore >= 7 && vt < 0.7) ? -2.0
        : (momentumScore >= 7 && vt > 1.3) ? 1.0
        : (momentumScore < 5 && vt > 1.5 && (structureScore ?? 0) >= 0) ? 1.5
        : (vt > 1.2 ? 0.5 : vt < 0.8 ? -0.5 : 0);

    const fvgBonus = (fvg === 'bullish' && ret5d < 0 && (structureScore ?? 0) >= 0) ? w.fvgBullish
        : (fvg === 'bearish' && (structureScore ?? 0) < 0) ? w.fvgBearish
        : 0;

    let smaProximityBonus = 0;
    if (sma20 != null && currentPrice != null && sma20 > 0) {
        const pctFromSMA20 = ((currentPrice - sma20) / sma20) * 100;
        if (pctFromSMA20 >= 0 && pctFromSMA20 <= 3 && (structureScore ?? 0) >= 1) smaProximityBonus = w.smaProxNear;
        else if (pctFromSMA20 < 0 && pctFromSMA20 >= -3 && (structureScore ?? 0) >= 1) smaProximityBonus = w.smaProxBelow;
        else if (pctFromSMA20 > 15) smaProximityBonus = w.smaProxFar15;
        else if (pctFromSMA20 > 10) smaProximityBonus = w.smaProxFar10;
    }

    const smaCrossoverBonus = smaCrossover?.crossover === 'bullish' ? w.smaCrossoverBullish
        : smaCrossover?.crossover === 'bearish' ? w.smaCrossoverBearish
        : 0;

    const additiveScore = momentumContrib + rsContrib + sectorBonus + accelBonus + consistencyBonus
        + structureBonus + extensionPenalty + pullbackBonus + runnerPenalty + declinePenalty
        + rsiBonusPenalty + macdBonus + rsMeanRevPenalty + squeezeBonus + volumeBonus + fvgBonus
        + smaProximityBonus + smaCrossoverBonus;

    let entryMultiplier = 1.0;
    if (additiveScore > 0) {
        if (rsi != null && rsi > 80 && momentumScore >= 9) entryMultiplier = w.entryMultExtreme;
        else if ((rsi != null && rsi > 70) || momentumScore >= 9 || rsNormalized >= 9) entryMultiplier = w.entryMultExtended;
        else if (ret5d >= -8 && ret5d <= -1 && (structureScore ?? 0) >= 1) entryMultiplier = w.entryMultPullback;
    }

    const compositeScore = additiveScore * entryMultiplier;

    return {
        total: compositeScore,
        breakdown: {
            momentumContrib, rsContrib, sectorBonus, accelBonus, consistencyBonus,
            structureBonus, extensionPenalty, pullbackBonus, runnerPenalty, declinePenalty,
            rsiBonusPenalty, macdBonus, rsMeanRevPenalty, squeezeBonus, volumeBonus, fvgBonus,
            smaProximityBonus, smaCrossoverBonus, entryMultiplier
        }
    };
}

/**
 * Enrich market data with all technicals, composite scores, and signal evaluations.
 * This is the main orchestration function called once per sim day.
 *
 * @param {object} marketData - raw market data from DataManager
 * @param {object} multiDayCache - { symbol: bars[] } windowed historical bars
 * @param {object} opts - { weights, regime }
 * @returns {{ enhanced, scored, signals }}
 */
export function enrichMarketData(marketData, multiDayCache, opts = {}) {
    const { weights, regime } = opts;

    // Group by sector for RS calculation
    const stocksBySector = {};
    for (const [symbol, data] of Object.entries(marketData)) {
        const sector = stockSectors[symbol] || 'Unknown';
        if (!stocksBySector[sector]) stocksBySector[sector] = [];
        stocksBySector[sector].push({ symbol, ...data });
    }

    // Compute sector rotation
    const sectorRotation = detectSectorRotation(marketData, multiDayCache);

    const enhanced = {};
    for (const [symbol, data] of Object.entries(marketData)) {
        const sector = stockSectors[symbol] || 'Unknown';
        const sectorStocks = stocksBySector[sector] || [];
        const bars = multiDayCache[symbol];

        const momentum = calculate5DayMomentum(data, bars);
        const relativeStrength = calculateRelativeStrength(data, sectorStocks, bars, multiDayCache);
        const marketStructure = detectStructure(bars);
        const rsi = calculateRSI(bars);
        const sma20 = calculateSMA(bars, 20);
        const macd = calculateMACD(bars);
        const smaCrossover = calculateSMACrossover(bars);
        const atr = calculateATR(bars);

        enhanced[symbol] = {
            ...data,
            sector,
            momentum,
            relativeStrength,
            sectorRotation: sectorRotation[sector],
            marketStructure,
            rsi, sma20, macd, smaCrossover, atr,
            shortInterest: null, // Not available historically
        };
    }

    // Score and rank
    const scored = Object.entries(enhanced).map(([symbol, data]) => {
        const scoreResult = calculateCompositeScore({
            momentumScore: data.momentum?.score || 0,
            rsNormalized: ((data.relativeStrength?.rsScore || 50) / 100) * 10,
            sectorFlow: data.sectorRotation?.moneyFlow,
            structureScore: data.marketStructure?.structureScore ?? 0,
            isAccelerating: data.momentum?.isAccelerating,
            upDays: data.momentum?.upDays ?? 0,
            totalDays: data.momentum?.totalDays ?? 0,
            todayChange: data.momentum?.todayChange || data.changePercent || 0,
            totalReturn5d: data.momentum?.totalReturn5d ?? 0,
            rsi: data.rsi,
            macdCrossover: data.macd?.crossover,
            daysToCover: data.shortInterest?.daysToCover || 0,
            volumeTrend: data.momentum?.volumeTrend ?? 1,
            fvg: data.marketStructure?.fvg,
            sma20: data.sma20,
            currentPrice: data.price,
            smaCrossover: data.smaCrossover,
        }, weights);
        enhanced[symbol].compositeScore = scoreResult.total;
        enhanced[symbol].scoreBreakdown = scoreResult.breakdown;
        return { symbol, compositeScore: scoreResult.total, breakdown: scoreResult.breakdown, data: enhanced[symbol] };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Evaluate entry signals for all stocks
    const signals = evaluateMarketSignals(enhanced, regime);

    // Attach signals to enhanced data
    for (const [symbol, sig] of Object.entries(signals)) {
        enhanced[symbol].signals = sig;
    }

    return { enhanced, scored, signals, sectorRotation };
}
