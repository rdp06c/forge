// Technical analysis functions — ported from APEX trader.js
// All functions are pure: they take bars/data as parameters (no globals)
import { stockSectors } from '../config/constants.js';

// RSI (Relative Strength Index) using Wilder's smoothing
export function calculateRSI(bars, period = 14) {
    if (!bars || bars.length < period + 1) return null;
    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
        const change = bars[i].c - bars[i - 1].c;
        if (change > 0) gainSum += change;
        else lossSum += Math.abs(change);
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    for (let i = period + 1; i < bars.length; i++) {
        const change = bars[i].c - bars[i - 1].c;
        avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

// Simple Moving Average
export function calculateSMA(bars, period = 20) {
    if (!bars || bars.length < period) return null;
    const slice = bars.slice(-period);
    return Math.round(slice.reduce((sum, b) => sum + b.c, 0) / period * 100) / 100;
}

// Exponential Moving Average (returns array of EMA values)
export function calculateEMAArray(closes, period) {
    if (closes.length < period) return [];
    const multiplier = 2 / (period + 1);
    const emaValues = [];
    let ema = closes.slice(0, period).reduce((s, c) => s + c, 0) / period;
    emaValues.push(ema);
    for (let i = period; i < closes.length; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
        emaValues.push(ema);
    }
    return emaValues;
}

// MACD (12, 26, 9)
export function calculateMACD(bars) {
    if (!bars || bars.length < 35) return null;
    const closes = bars.map(b => b.c);
    const ema12 = calculateEMAArray(closes, 12);
    const ema26 = calculateEMAArray(closes, 26);
    const offset = 26 - 12;
    const macdLine = [];
    for (let i = 0; i < ema26.length; i++) {
        macdLine.push(ema12[i + offset] - ema26[i]);
    }
    const signalLine = calculateEMAArray(macdLine, 9);
    if (signalLine.length < 2) return null;
    const currentMACD = macdLine[macdLine.length - 1];
    const currentSignal = signalLine[signalLine.length - 1];
    const prevMACD = macdLine[macdLine.length - 2];
    const prevSignal = signalLine.length >= 2 ? signalLine[signalLine.length - 2] : currentSignal;
    const histogram = currentMACD - currentSignal;
    let crossover = 'none';
    if (prevMACD <= prevSignal && currentMACD > currentSignal) crossover = 'bullish';
    else if (prevMACD >= prevSignal && currentMACD < currentSignal) crossover = 'bearish';
    return {
        macd: Math.round(currentMACD * 1000) / 1000,
        signal: Math.round(currentSignal * 1000) / 1000,
        histogram: Math.round(histogram * 1000) / 1000,
        crossover
    };
}

// Market Structure Detection: CHoCH, BOS, Sweeps, FVG
export function detectStructure(bars) {
    if (!bars || bars.length < 7) {
        return { structure: 'unknown', structureSignal: 'neutral', structureScore: 0, choch: false, chochType: 'none', bos: false, bosType: 'none', sweep: 'none', fvg: 'none', swingHighs: 0, swingLows: 0, lastSwingHigh: null, lastSwingLow: null, currentPrice: null, basis: 'insufficient-data' };
    }

    const swingHighs = [];
    const swingLows = [];

    for (let i = 1; i < bars.length - 1; i++) {
        if (bars[i].h > bars[i-1].h && bars[i].h > bars[i+1].h) {
            swingHighs.push({ index: i, price: bars[i].h, time: bars[i].t });
        }
        if (bars[i].l < bars[i-1].l && bars[i].l < bars[i+1].l) {
            swingLows.push({ index: i, price: bars[i].l, time: bars[i].t });
        }
    }

    if (swingHighs.length < 2 || swingLows.length < 2) {
        return { structure: 'unknown', structureSignal: 'neutral', structureScore: 0, choch: false, chochType: 'none', bos: false, bosType: 'none', sweep: 'none', fvg: 'none', swingHighs: swingHighs.length, swingLows: swingLows.length, lastSwingHigh: null, lastSwingLow: null, currentPrice: null, basis: 'insufficient-swings' };
    }

    const lastSH = swingHighs[swingHighs.length - 1];
    const prevSH = swingHighs[swingHighs.length - 2];
    const lastSL = swingLows[swingLows.length - 1];
    const prevSL = swingLows[swingLows.length - 2];

    const higherHigh = lastSH.price > prevSH.price;
    const higherLow = lastSL.price > prevSL.price;
    const lowerHigh = lastSH.price < prevSH.price;
    const lowerLow = lastSL.price < prevSL.price;

    let structure = 'ranging';
    if (higherHigh && higherLow) structure = 'bullish';
    else if (lowerHigh && lowerLow) structure = 'bearish';
    else if (higherHigh && lowerLow) structure = 'ranging';
    else if (lowerHigh && higherLow) structure = 'contracting';

    // CHoCH detection
    let choch = false, chochType = null;
    if (swingHighs.length >= 3 && swingLows.length >= 3) {
        const prevPrevSH = swingHighs[swingHighs.length - 3];
        const prevPrevSL = swingLows[swingLows.length - 3];
        const wasBullish = prevSH.price > prevPrevSH.price && prevSL.price > prevPrevSL.price;
        const wasBearish = prevSH.price < prevPrevSH.price && prevSL.price < prevPrevSL.price;
        if (wasBullish && lowerLow) { choch = true; chochType = 'bearish'; }
        else if (wasBearish && higherHigh) { choch = true; chochType = 'bullish'; }
    }

    // BOS detection
    let bos = false, bosType = null;
    const currentPrice = bars[bars.length - 1].c;
    if (structure === 'bullish' && currentPrice > prevSH.price) { bos = true; bosType = 'bullish'; }
    else if (structure === 'bearish' && currentPrice < prevSL.price) { bos = true; bosType = 'bearish'; }

    // Liquidity sweep
    let sweepType = null;
    const latestBar = bars[bars.length - 1];
    if (latestBar.h > lastSH.price && latestBar.c < lastSH.price) sweepType = 'high-swept';
    if (latestBar.l < lastSL.price && latestBar.c > lastSL.price) sweepType = 'low-swept';

    // Fair Value Gap
    let fvg = null;
    for (let i = Math.max(1, bars.length - 4); i < bars.length - 1; i++) {
        if (bars[i-1].h < bars[i+1].l) fvg = { type: 'bullish', gapTop: bars[i+1].l, gapBottom: bars[i-1].h };
        if (bars[i-1].l > bars[i+1].h) fvg = { type: 'bearish', gapTop: bars[i-1].l, gapBottom: bars[i+1].h };
    }

    // Composite signal
    let structureSignal = 'neutral', structureScore = 0;
    if (bos && bosType === 'bullish') { structureSignal = 'strong-bullish'; structureScore = 3; }
    else if (bos && bosType === 'bearish') { structureSignal = 'strong-bearish'; structureScore = -3; }
    else if (choch && chochType === 'bullish') { structureSignal = 'reversal-bullish'; structureScore = 2; }
    else if (choch && chochType === 'bearish') { structureSignal = 'reversal-bearish'; structureScore = -2; }
    else if (structure === 'bullish') { structureSignal = 'bullish'; structureScore = 1; }
    else if (structure === 'bearish') { structureSignal = 'bearish'; structureScore = -1; }

    if (sweepType === 'low-swept') structureScore += 1;
    if (sweepType === 'high-swept') structureScore -= 1;

    return {
        structure, structureSignal,
        structureScore: Math.max(-3, Math.min(3, structureScore)),
        choch, chochType: chochType || 'none',
        bos, bosType: bosType || 'none',
        sweep: sweepType || 'none',
        fvg: fvg ? fvg.type : 'none',
        swingHighs: swingHighs.length, swingLows: swingLows.length,
        lastSwingHigh: lastSH.price, lastSwingLow: lastSL.price,
        currentPrice, basis: '20-day-structure'
    };
}

// 5-Day Momentum Score
export function calculate5DayMomentum(priceData, bars) {
    if (!bars || bars.length < 2) {
        if (!priceData || !priceData.price) return { score: 0, trend: 'unknown', basis: 'no-data' };
        const cp = priceData.changePercent || 0;
        let score = 5;
        if (cp > 5) score = 7; else if (cp > 2) score = 6.5; else if (cp > 0) score = 6;
        else if (cp > -2) score = 4; else if (cp > -5) score = 2; else score = 0;
        return { score, trend: score >= 6 ? 'building' : score <= 4 ? 'fading' : 'neutral', changePercent: cp, basis: '1-day-fallback' };
    }

    const recentBars = bars.slice(-5);
    const latest = recentBars[recentBars.length - 1], oldest = recentBars[0], mid = recentBars[Math.floor(recentBars.length / 2)];
    const totalReturn = ((latest.c - oldest.c) / oldest.c) * 100;
    const firstHalfReturn = ((mid.c - oldest.c) / oldest.c) * 100;
    const secondHalfReturn = ((latest.c - mid.c) / mid.c) * 100;
    const isAccelerating = secondHalfReturn > firstHalfReturn;

    let upDays = 0;
    for (let i = 1; i < recentBars.length; i++) { if (recentBars[i].c > recentBars[i-1].c) upDays++; }
    const upDayRatio = upDays / (recentBars.length - 1);

    const recentVol = recentBars.slice(-2).reduce((s, b) => s + b.v, 0) / 2;
    const earlyVol = recentBars.slice(0, 2).reduce((s, b) => s + b.v, 0) / 2;
    const volumeTrend = earlyVol > 0 ? recentVol / earlyVol : 1;

    let score = 5;
    if (totalReturn > 8) score += 3; else if (totalReturn > 4) score += 2; else if (totalReturn > 1) score += 1;
    else if (totalReturn < -8) score -= 3; else if (totalReturn < -4) score -= 2; else if (totalReturn < -1) score -= 1;

    if (upDayRatio >= 0.8) score += 1.5; else if (upDayRatio >= 0.6) score += 0.5;
    else if (upDayRatio <= 0.2) score -= 1.5; else if (upDayRatio <= 0.4) score -= 0.5;

    if (isAccelerating && totalReturn > 0) score += 0.5;
    else if (!isAccelerating && totalReturn < 0) score -= 0.5;

    score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

    let trend = 'neutral';
    if (score >= 7 && isAccelerating) trend = 'building';
    else if (score >= 6) trend = 'steady-up';
    else if (score <= 3 && !isAccelerating) trend = 'fading';
    else if (score <= 4) trend = 'steady-down';

    return {
        score: Math.round(score * 10) / 10, trend,
        totalReturn5d: Math.round(totalReturn * 100) / 100,
        todayChange: priceData?.changePercent || 0,
        upDays, totalDays: recentBars.length - 1,
        isAccelerating, volumeTrend: Math.round(volumeTrend * 100) / 100,
        basis: '5-day-real'
    };
}

// Relative Strength vs Sector
export function calculateRelativeStrength(stockData, sectorStocks, bars, multiDayCache) {
    if (!stockData || !sectorStocks || sectorStocks.length === 0) return { rsScore: 50, strength: 'neutral' };

    let stockReturn = stockData.changePercent || 0, usedMultiDay = false;
    if (bars && bars.length >= 2) {
        const recent5 = bars.slice(-5);
        stockReturn = ((recent5[recent5.length - 1].c - recent5[0].c) / recent5[0].c) * 100;
        usedMultiDay = true;
    }

    let sectorTotal = 0, sectorCount = 0;
    for (const stock of sectorStocks) {
        const sBars = multiDayCache[stock.symbol];
        if (sBars && sBars.length >= 2) {
            const sRecent5 = sBars.slice(-5);
            sectorTotal += ((sRecent5[sRecent5.length - 1].c - sRecent5[0].c) / sRecent5[0].c) * 100;
        } else {
            sectorTotal += (stock.changePercent || 0);
        }
        sectorCount++;
    }

    const sectorAvg = sectorCount > 0 ? sectorTotal / sectorCount : 0;
    const relativePerformance = stockReturn - sectorAvg;
    const multiplier = usedMultiDay ? 5 : 10;
    let rsScore = 50 + (relativePerformance * multiplier);
    rsScore = Math.max(0, Math.min(100, rsScore));

    const strength = rsScore >= 70 ? 'outperforming' : rsScore >= 55 ? 'above-average' : rsScore >= 45 ? 'neutral' : rsScore >= 30 ? 'below-average' : 'underperforming';

    return {
        rsScore: Math.round(rsScore), strength,
        stockReturn5d: Math.round(stockReturn * 100) / 100,
        sectorAvg5d: Math.round(sectorAvg * 100) / 100,
        relativePerformance: Math.round(relativePerformance * 100) / 100,
        basis: usedMultiDay ? '5-day' : '1-day-fallback'
    };
}

// Sector Rotation Detection
export function detectSectorRotation(marketData, multiDayCache) {
    const sectors = {};
    for (const [symbol, data] of Object.entries(marketData)) {
        const sector = stockSectors[symbol] || 'Unknown';
        if (!sectors[sector]) sectors[sector] = { stocks: [], totalReturn5d: 0, totalChangeToday: 0, leaders5d: 0, laggards5d: 0, leadersToday: 0, laggardsToday: 0 };
        const bars = multiDayCache[symbol];
        let return5d = data.changePercent || 0;
        if (bars && bars.length >= 2) {
            const recent5 = bars.slice(-5);
            return5d = ((recent5[recent5.length - 1].c - recent5[0].c) / recent5[0].c) * 100;
        }
        sectors[sector].stocks.push({ symbol, ...data, return5d });
        sectors[sector].totalReturn5d += return5d;
        sectors[sector].totalChangeToday += (data.changePercent || 0);
        if (return5d > 2) sectors[sector].leaders5d++;
        if (return5d < -2) sectors[sector].laggards5d++;
        if ((data.changePercent || 0) > 1) sectors[sector].leadersToday++;
        if ((data.changePercent || 0) < -1) sectors[sector].laggardsToday++;
    }

    const sectorAnalysis = {};
    for (const [sector, data] of Object.entries(sectors)) {
        const count = data.stocks.length;
        const avgReturn5d = data.totalReturn5d / count;
        const avgChange = data.totalChangeToday / count;
        const leaderRatio5d = data.leaders5d / count;
        const laggardRatio5d = data.laggards5d / count;

        let flow = 'neutral', rotationSignal = 'hold';
        if (avgReturn5d > 2 && leaderRatio5d > 0.5) { flow = 'inflow'; rotationSignal = 'accumulate'; }
        else if (avgReturn5d > 1 && leaderRatio5d > 0.35) { flow = 'modest-inflow'; rotationSignal = 'favorable'; }
        else if (avgReturn5d < -2 && laggardRatio5d > 0.5) { flow = 'outflow'; rotationSignal = 'avoid'; }
        else if (avgReturn5d < -1 && laggardRatio5d > 0.35) { flow = 'modest-outflow'; rotationSignal = 'caution'; }

        sectorAnalysis[sector] = {
            avgChange: avgChange.toFixed(2), avgReturn5d: avgReturn5d.toFixed(2),
            leaders5d: data.leaders5d, laggards5d: data.laggards5d,
            leadersToday: data.leadersToday, laggardsToday: data.laggardsToday,
            total: count, leaderRatio5d: (leaderRatio5d * 100).toFixed(0) + '%',
            moneyFlow: flow, rotationSignal
        };
    }
    return sectorAnalysis;
}

// Composite Score — used for candidate ranking
// Synced with APEX's rebalanced scoring (Feb 26, 2026): reduced momentum dominance,
// stronger structure/pullback signals, RS mean-reversion penalty, conditional decline penalty
export function calculateCompositeScore({ momentumScore, rsNormalized, sectorFlow, structureScore, isAccelerating, upDays, totalDays, todayChange, totalReturn5d, rsi, macdCrossover, daysToCover, volumeTrend, fvg }) {
    // [1] Scale momentum + RS by 0.6 to reduce base dominance (0-12 instead of 0-20)
    const momentumContrib = momentumScore * 0.6;
    const rsContrib = rsNormalized * 0.6;

    let sectorBonus = 0;
    if (sectorFlow === 'inflow') sectorBonus = 2;
    else if (sectorFlow === 'modest-inflow') sectorBonus = 1;
    else if (sectorFlow === 'outflow') sectorBonus = -1;

    const accelBonus = isAccelerating && momentumScore >= 6 ? 1.5 : 0;
    const consistencyBonus = (upDays >= 3 && totalDays >= 4) ? 1.0 : 0;
    // [6] Increase structure weight: *1.25 (max ±3.75, was ±2.25)
    const structureBonus = (structureScore || 0) * 1.25;

    const chg = todayChange || 0;
    // [7] Scale runner penalty proportionally with 0.6 base reduction
    const runnerPenalty = chg >= 15 ? -3 : chg >= 10 ? -2 : chg >= 7 ? -1 : chg >= 5 ? -0.5 : 0;
    // [4] Conditional decline penalty: no penalty for bullish structure dips
    const declinePenalty = (structureScore ?? 0) >= 1
        ? (chg <= -8 ? -1 : 0)
        : (chg <= -5 ? -3 : chg <= -3 ? -2 : chg <= -2 ? -1 : 0);

    const extensionPenalty = (momentumScore >= 9 && rsNormalized >= 8.5) ? -5
        : (momentumScore >= 9 || rsNormalized >= 8.5) ? -3.5
        : (momentumScore >= 8 || rsNormalized >= 8) ? -2
        : (momentumScore >= 7.5 || rsNormalized >= 7.5) ? -1
        : 0;

    const ret5d = totalReturn5d ?? 0;
    // [3] Bigger, more tiered pullback bonus (max +5, was +2)
    const pullbackBonus =
        (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 2 && sectorFlow !== 'outflow') ? 5
        : (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow' && sectorFlow !== 'modest-outflow') ? 4
        : (ret5d >= -5 && ret5d < 0 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow') ? 3
        : (ret5d >= -8 && ret5d <= -2 && (structureScore ?? 0) >= 0) ? 2
        : (ret5d >= -5 && ret5d < 0 && (structureScore ?? 0) >= 0 && sectorFlow !== 'outflow') ? 1
        : 0;

    // [5] Steeper RSI penalties, broader oversold bonuses
    const rsiBonusPenalty = rsi != null
        ? (rsi < 30 ? 2.5 : rsi < 40 ? 1.5 : rsi < 50 ? 0.5
            : rsi > 80 ? -5 : rsi > 70 ? -3 : 0)
        : 0;
    const macdBonus = macdCrossover === 'bullish' ? 2.5 : macdCrossover === 'bearish' ? -2.0 : -0.5;

    // [2] RS mean-reversion penalty: RS=100 has 11.1% win rate in APEX data
    const rsMeanRevPenalty = rsNormalized >= 9.5 ? -3 : rsNormalized >= 9 ? -2 : rsNormalized >= 8.5 ? -1 : 0;

    const dtc = daysToCover || 0;
    const squeezeBonus = (dtc > 5 && (structureScore ?? 0) >= 1 && sectorFlow !== 'outflow') ? 1.5
        : (dtc > 3 && (structureScore ?? 0) >= 1) ? 0.75
        : 0;

    const vt = volumeTrend ?? 1;
    const volumeBonus = vt > 1.2 ? 0.5 : vt < 0.8 ? -0.5 : 0;

    const fvgBonus = (fvg === 'bullish' && ret5d < 0 && (structureScore ?? 0) >= 0) ? 0.5
        : (fvg === 'bearish' && (structureScore ?? 0) < 0) ? -0.5
        : 0;

    return momentumContrib + rsContrib + sectorBonus + accelBonus + consistencyBonus
        + structureBonus + extensionPenalty + pullbackBonus + runnerPenalty + declinePenalty
        + rsiBonusPenalty + macdBonus + rsMeanRevPenalty + squeezeBonus + volumeBonus + fvgBonus;
}

// ═══════════════════════════════════════════════════
// Enrich: run all technicals on market data
// ═══════════════════════════════════════════════════
export function enrichMarketData(marketData, multiDayCache, tickerDetails, shortInterest, sectorRotation, newsCache) {
    // Group by sector for RS calc
    const stocksBySector = {};
    for (const [symbol, data] of Object.entries(marketData)) {
        const sector = stockSectors[symbol] || 'Unknown';
        if (!stocksBySector[sector]) stocksBySector[sector] = [];
        stocksBySector[sector].push({ symbol, ...data });
    }

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

        enhanced[symbol] = {
            ...data,
            sector,
            momentum,
            relativeStrength,
            sectorRotation: sectorRotation[sector],
            marketStructure,
            rsi, sma20, macd,
            marketCap: tickerDetails[symbol]?.marketCap || null,
            companyName: tickerDetails[symbol]?.name || null,
            sicDescription: tickerDetails[symbol]?.sicDescription || null,
            shortInterest: shortInterest[symbol] || null,
            recentNews: newsCache?.[symbol] || null
        };
    }

    // Score and rank
    const scored = Object.entries(enhanced).map(([symbol, data]) => {
        const compositeScore = calculateCompositeScore({
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
        });
        enhanced[symbol].compositeScore = compositeScore;
        return { symbol, compositeScore, data: enhanced[symbol] };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    return { enhanced, scored };
}
