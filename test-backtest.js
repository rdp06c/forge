#!/usr/bin/env node
// Tests for FORGE Signal Backtester v3.0
import { determineRegime } from './engine/regime.js';
import { deriveConviction, processEntries } from './engine/entry-rules.js';
import { buildSignalPool } from './engine/candidate-pool.js';
import { computeResults, computeMatrixSummary } from './engine/results.js';
import { calculatePositionSize, countTradingDays, addTradingDays, executeBuy, executeSell } from './portfolio/manager.js';
import { createBacktestPortfolio } from './portfolio/schema.js';
import { calculateRSI, calculateSMA, calculateMACD, detectStructure, calculateSMACrossover, calculate5DayMomentum, calculateATR } from './data/technicals.js';
import { calculateCompositeScore } from './data/scoring.js';
import { evaluateAllSignals, meetsQuality, toSignalCandidate, ENTRY_SIGNAL_PATTERNS } from './data/signals.js';
import { DEFAULT_WEIGHTS, CALIBRATED_WEIGHTS, SIGNAL_CALIBRATION_EDGES, getWeights } from './config/calibration.js';
import { SIGNAL_CONFIGS, EXIT_CONFIGS, CONVICTION_MAP, NOSIGNAL_CONVICTION_MAP, UNCONSTRAINED_ENTRY_RULES, buildStrategy, generateMatrix } from './config/strategies.js';
import { DataManager, generateWeekdays, getWeekdaysBefore } from './engine/data-manager.js';

let passed = 0, failed = 0;

function assert(condition, name) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${name}`);
    }
}

function section(name) {
    console.log(`\n--- ${name} ---`);
}

// ═══════════════════════════════════════════════════
// 1. Regime Detection
// ═══════════════════════════════════════════════════
section('Regime Detection');
{
    // Bull requires bullSignals >= 2: VIX < 15 (+1) and VIX dropping > -10% (+1)
    const bull = determineRegime({ level: 14, changePercent: -12 }, {}, {});
    assert(bull.regime === 'bull', 'VIX 14 dropping 12% → bull');

    const bear = determineRegime({ level: 32, changePercent: 5 }, {}, {});
    assert(bear.regime === 'bear', 'VIX 32 → bear');

    const choppy = determineRegime({ level: 22, changePercent: 2 }, {}, {});
    assert(choppy.regime === 'choppy', 'VIX 22 → choppy');

    const nullVix = determineRegime(null, {}, {});
    assert(nullVix.regime === 'choppy', 'null VIX → choppy');
}

// ═══════════════════════════════════════════════════
// 2. Calibration Config
// ═══════════════════════════════════════════════════
section('Calibration Config');
{
    assert(DEFAULT_WEIGHTS.momentumMultiplier === 0.6, 'Default momentum multiplier = 0.6');
    assert(CALIBRATED_WEIGHTS.momentumMultiplier === 0.45, 'Calibrated momentum multiplier = 0.45');
    assert(CALIBRATED_WEIGHTS.structureMultiplier === 1.5, 'Calibrated structure multiplier = 1.5');
    assert(CALIBRATED_WEIGHTS.accelBonus === 0, 'Calibrated accel bonus = 0 (zeroed)');
    assert(CALIBRATED_WEIGHTS.consistencyBonus === 0, 'Calibrated consistency bonus = 0 (zeroed)');
    assert(getWeights('default') === DEFAULT_WEIGHTS, 'getWeights default');
    assert(getWeights('calibrated') === CALIBRATED_WEIGHTS, 'getWeights calibrated');

    assert(SIGNAL_CALIBRATION_EDGES.REV.winRateEdge === 0.19, 'REV edge = +19pp');
    assert(SIGNAL_CALIBRATION_EDGES.MOM.winRateEdge < 0, 'MOM edge negative');
    assert(SIGNAL_CALIBRATION_EDGES.AVOID.winRateEdge < 0, 'AVOID edge negative');
}

// ═══════════════════════════════════════════════════
// 3. Signal Quality
// ═══════════════════════════════════════════════════
section('Signal Quality');
{
    assert(meetsQuality('full', 'partial') === true, 'full meets partial');
    assert(meetsQuality('full', 'strong') === true, 'full meets strong');
    assert(meetsQuality('full', 'full') === true, 'full meets full');
    assert(meetsQuality('strong', 'full') === false, 'strong does not meet full');
    assert(meetsQuality('partial', 'strong') === false, 'partial does not meet strong');
    assert(meetsQuality(null, 'partial') === false, 'null does not meet partial');
    assert(meetsQuality('strong', null) === false, 'strong does not meet null');
}

// ═══════════════════════════════════════════════════
// 4. Signal Evaluation — REV
// ═══════════════════════════════════════════════════
section('Signal Evaluation — REV');
{
    // Full match: all 4 criteria
    const fullCandidate = {
        macdCrossover: 'bullish', rsi: 35, structure: 'bullish',
        return5d: -4, momentum: 5, rs: 50, volumeRatio: 1, dayChange: 0,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const fullResult = evaluateAllSignals(fullCandidate);
    assert(fullResult.REV.quality === 'full', 'REV full match (4/4 criteria)');
    assert(fullResult.bestSignal === 'REV', 'REV is best signal');

    // Strong match: 3/4 criteria (missing pullback)
    const strongCandidate = {
        macdCrossover: 'bullish', rsi: 35, structure: 'bullish',
        return5d: 1, momentum: 5, rs: 50, volumeRatio: 1, dayChange: 0,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const strongResult = evaluateAllSignals(strongCandidate);
    assert(strongResult.REV.quality === 'strong', 'REV strong match (3/4)');

    // Partial match: 2/4 with required field
    const partialCandidate = {
        macdCrossover: 'none', macdHistogram: 0.5, rsi: 35, structure: 'ranging',
        return5d: -3, momentum: 5, rs: 50, volumeRatio: 1, dayChange: 0,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const partialResult = evaluateAllSignals(partialCandidate);
    assert(partialResult.REV.quality === 'partial', 'REV partial match (2/4 with required)');

    // No match: only 1 criterion
    const noMatchCandidate = {
        macdCrossover: 'none', macdHistogram: 0.5, rsi: 55, structure: 'bearish',
        return5d: 5, momentum: 5, rs: 50, volumeRatio: 1, dayChange: 0,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const noMatchResult = evaluateAllSignals(noMatchCandidate);
    assert(noMatchResult.REV.quality === null, 'REV no match (1/4)');

    // REV in bear regime: MACD histogram<=0 not enough
    const bearCandidate = {
        macdCrossover: 'none', macdHistogram: -0.5, rsi: 35, structure: 'bullish',
        return5d: -4, momentum: 5, rs: 50, volumeRatio: 1, dayChange: 0,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bearish'
    };
    const bearResult = evaluateAllSignals(bearCandidate);
    assert(bearResult.REV.criteria.macd === false, 'REV MACD histogram not enough in bear regime');
}

// ═══════════════════════════════════════════════════
// 5. Signal Evaluation — MOM
// ═══════════════════════════════════════════════════
section('Signal Evaluation — MOM');
{
    const momCandidate = {
        macdCrossover: 'none', rsi: 45, structure: 'bullish',
        return5d: 2, momentum: 6, rs: 60, volumeRatio: 1, dayChange: 1,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const momResult = evaluateAllSignals(momCandidate);
    assert(momResult.MOM.quality === 'full', 'MOM full match (4/4)');

    // MOM needs 3/4
    const momPartialCandidate = {
        macdCrossover: 'none', rsi: 45, structure: 'bullish',
        return5d: 2, momentum: 6, rs: 40, volumeRatio: 1, dayChange: 1,
        sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const momPartialResult = evaluateAllSignals(momPartialCandidate);
    assert(momPartialResult.MOM.quality === 'strong', 'MOM strong match (3/4)');
}

// ═══════════════════════════════════════════════════
// 6. Signal Evaluation — AVOID (Anti-Pattern)
// ═══════════════════════════════════════════════════
section('Signal Evaluation — AVOID');
{
    const avoidCandidate = {
        macdCrossover: 'bullish', rsi: 75, structure: 'bullish',
        return5d: 3, momentum: 9.5, rs: 80, volumeRatio: 0.7, dayChange: 6,
        sectorFlow: 'inflow', daysToCover: 0, _regime: 'bull'
    };
    const avoidResult = evaluateAllSignals(avoidCandidate);
    assert(avoidResult.AVOID.quality !== null, 'AVOID fires on exhausted runner');
    assert(avoidResult.antiPattern !== null, 'Anti-pattern detected');

    // Non-exhausted stock should not fire AVOID
    const safeCandidate = {
        macdCrossover: 'bullish', rsi: 55, structure: 'bullish',
        return5d: 2, momentum: 6, rs: 60, volumeRatio: 1.1, dayChange: 1,
        sectorFlow: 'inflow', daysToCover: 0, _regime: 'bull'
    };
    const safeResult = evaluateAllSignals(safeCandidate);
    assert(safeResult.AVOID.quality === null, 'AVOID does not fire on safe stock');
}

// ═══════════════════════════════════════════════════
// 7. Signal Evaluation — LDR, SQZ, QMO
// ═══════════════════════════════════════════════════
section('Signal Evaluation — LDR, SQZ, QMO');
{
    // LDR: RS>60 + sector inflow + bull structure
    const ldrCandidate = {
        macdCrossover: 'none', rsi: 55, structure: 'bullish',
        return5d: 1, momentum: 5, rs: 70, volumeRatio: 1,
        dayChange: 0, sectorFlow: 'inflow', daysToCover: 0, _regime: 'bull'
    };
    const ldrResult = evaluateAllSignals(ldrCandidate);
    assert(ldrResult.LDR.quality === 'full', 'LDR full match');

    // SQZ: DTC>5 + bull structure + sector inflow
    const sqzCandidate = {
        macdCrossover: 'none', rsi: 50, structure: 'bullish',
        return5d: 0, momentum: 5, rs: 50, volumeRatio: 1,
        dayChange: 0, sectorFlow: 'inflow', daysToCover: 7, _regime: 'bull'
    };
    const sqzResult = evaluateAllSignals(sqzCandidate);
    assert(sqzResult.SQZ.quality === 'full', 'SQZ full match');

    // QMO: vol<0.5x + mom>=7 + bull struct + RSI<70
    const qmoCandidate = {
        macdCrossover: 'none', rsi: 55, structure: 'bullish',
        return5d: 3, momentum: 8, rs: 60, volumeRatio: 0.3,
        dayChange: 1, sectorFlow: 'neutral', daysToCover: 0, _regime: 'bull'
    };
    const qmoResult = evaluateAllSignals(qmoCandidate);
    assert(qmoResult.QMO.quality === 'full', 'QMO full match');
}

// ═══════════════════════════════════════════════════
// 8. Conviction Derivation
// ═══════════════════════════════════════════════════
section('Conviction Derivation');
{
    assert(deriveConviction('full', 10) === 9, 'Full signal, low score → conviction 9');
    assert(deriveConviction('full', 20) === 10, 'Full signal, high score → conviction 10');
    assert(deriveConviction('strong', 10) === 8, 'Strong signal, low score → conviction 8');
    assert(deriveConviction('strong', 20) === 9, 'Strong signal, high score → conviction 9');
    assert(deriveConviction('partial', 10) === 7, 'Partial signal → conviction 7');
    assert(deriveConviction('partial', 20) === 7, 'Partial signal, high score still 7');
    assert(deriveConviction(null, 10) === 0, 'No signal → conviction 0');

    // NOSIGNAL baseline
    assert(deriveConviction(null, 20, true) === 10, 'NOSIGNAL score 20 → conviction 10');
    assert(deriveConviction(null, 15, true) === 9, 'NOSIGNAL score 15 → conviction 9');
    assert(deriveConviction(null, 12, true) === 8, 'NOSIGNAL score 12 → conviction 8');
    assert(deriveConviction(null, 9, true) === 7, 'NOSIGNAL score 9 → conviction 7');
    assert(deriveConviction(null, 3, true) === 0, 'NOSIGNAL score 3 → conviction 0');
}

// ═══════════════════════════════════════════════════
// 9. Strategy Builder
// ═══════════════════════════════════════════════════
section('Strategy Builder');
{
    const strategy = buildStrategy('REV', 'trail8', 'calibrated');
    assert(strategy.name === 'REV_trail8_calibrated', 'Strategy name correct');
    assert(strategy.signal.code === 'REV', 'Signal code correct');
    assert(strategy.exit.trailing === 0.08, 'Exit trailing correct');
    assert(strategy.weightsName === 'calibrated', 'Weights name correct');
    assert(strategy.entry.maxHoldings === 100, 'Entry rules inherited');

    // Unknown signal should throw
    let threw = false;
    try { buildStrategy('INVALID', 'trail8'); } catch { threw = true; }
    assert(threw, 'Unknown signal throws');

    // Matrix generation
    const small = generateMatrix({ signals: ['REV', 'MOM'], exits: ['trail8', 'stop10'], weights: ['calibrated'] });
    assert(small.length === 4, 'Small matrix: 2 signals × 2 exits × 1 weight = 4');

    const full = generateMatrix({ weights: ['calibrated'] });
    const expectedCount = Object.keys(SIGNAL_CONFIGS).length * Object.keys(EXIT_CONFIGS).length;
    assert(full.length === expectedCount, `Full matrix: ${expectedCount} combinations`);
}

// ═══════════════════════════════════════════════════
// 10. Candidate Pool
// ═══════════════════════════════════════════════════
section('Candidate Pool');
{
    // Mock enhanced market with signals
    const enhancedMarket = {
        AAPL: { price: 150, signals: { REV: { quality: 'full' }, MOM: { quality: null }, AVOID: { quality: null } } },
        MSFT: { price: 300, signals: { REV: { quality: 'strong' }, MOM: { quality: 'full' }, AVOID: { quality: null } } },
        GOOG: { price: 140, signals: { REV: { quality: null }, MOM: { quality: null }, AVOID: { quality: null } } },
        BAD: { price: 50, signals: { REV: { quality: 'full' }, MOM: { quality: null }, AVOID: { quality: 'strong' } } },
    };
    const scored = [
        { symbol: 'AAPL', compositeScore: 15, data: enhancedMarket.AAPL },
        { symbol: 'MSFT', compositeScore: 12, data: enhancedMarket.MSFT },
        { symbol: 'GOOG', compositeScore: 10, data: enhancedMarket.GOOG },
        { symbol: 'BAD', compositeScore: 18, data: enhancedMarket.BAD },
    ];
    const portfolio = { holdings: {} };

    // REV signal: AAPL (full) + MSFT (strong) — BAD excluded by AVOID
    const revStrategy = buildStrategy('REV', 'trail8');
    const revPool = buildSignalPool(enhancedMarket, scored, revStrategy, portfolio);
    assert(revPool.length === 2, 'REV pool: 2 candidates (AAPL + MSFT)');
    assert(revPool.some(c => c.symbol === 'AAPL'), 'REV pool includes AAPL');
    assert(revPool.some(c => c.symbol === 'MSFT'), 'REV pool includes MSFT');
    assert(!revPool.some(c => c.symbol === 'BAD'), 'REV pool excludes BAD (AVOID)');

    // NOSIGNAL: all except AVOID and Index Fund
    const nosigStrategy = buildStrategy('NOSIGNAL', 'trail8');
    const nosigPool = buildSignalPool(enhancedMarket, scored, nosigStrategy, portfolio);
    assert(nosigPool.length === 3, 'NOSIGNAL pool: 3 candidates (excludes BAD/AVOID)');
}

// ═══════════════════════════════════════════════════
// 11. Position Sizing
// ═══════════════════════════════════════════════════
section('Position Sizing');
{
    const portfolio = createBacktestPortfolio(100000, 'test');
    const prices = { AAPL: { price: 150 } };

    const shares6 = calculatePositionSize(portfolio, 6, 'bull', 150, prices);
    assert(shares6 > 0, 'Conviction 6 produces shares');

    const shares10 = calculatePositionSize(portfolio, 10, 'bull', 150, prices);
    assert(shares10 > shares6, 'Conviction 10 gets more shares than 6');

    const shares5 = calculatePositionSize(portfolio, 5, 'bull', 150, prices);
    assert(shares5 === 0, 'Conviction 5 → 0 shares');
}

// ═══════════════════════════════════════════════════
// 12. Trading Day Calculations
// ═══════════════════════════════════════════════════
section('Trading Day Calculations');
{
    const friday = new Date('2026-03-06T16:00:00Z'); // Friday
    const nextWeek = addTradingDays(friday, 1);
    assert(nextWeek.getDay() === 1, 'Next trading day after Friday is Monday');

    const days = countTradingDays(new Date('2026-03-02'), new Date('2026-03-06'));
    assert(days === 4, 'Mon→Fri = 4 trading days');

    const weekdays = generateWeekdays(new Date('2026-03-02'), new Date('2026-03-06'));
    assert(weekdays.length === 5, 'Mon-Fri = 5 weekdays');
}

// ═══════════════════════════════════════════════════
// 13. Buy/Sell Execution
// ═══════════════════════════════════════════════════
section('Buy/Sell Execution');
{
    const p = createBacktestPortfolio(50000, 'test');
    const md = { AAPL: { price: 150, momentum: { score: 7 }, relativeStrength: { rsScore: 60 }, marketStructure: { structure: 'bullish', structureScore: 2 }, sectorRotation: { moneyFlow: 'inflow' }, rsi: 45, sma20: 148, macd: { crossover: 'none' }, smaCrossover: null, compositeScore: 12, scoreBreakdown: {} } };

    const bought = executeBuy(p, { symbol: 'AAPL', shares: 10, price: 150, conviction: 8, reasoning: 'Test', marketData: md, vix: { level: 15 }, agentName: 'test', simDate: '2026-03-02', signalCode: 'REV', signalQuality: 'full' });
    assert(bought === true, 'Buy succeeds');
    assert(p.holdings.AAPL === 10, 'Holdings updated');
    assert(p.cash === 48500, 'Cash reduced');
    assert(p.holdingTheses.AAPL.signalCode === 'REV', 'Signal code stored in thesis');
    assert(p.holdingTheses.AAPL.signalQuality === 'full', 'Signal quality stored in thesis');
    assert(p.holdingTheses.AAPL.highWaterMark === 150, 'High water mark initialized');

    const sold = executeSell(p, { symbol: 'AAPL', shares: 10, price: 165, reasoning: 'Trailing stop', exitReason: 'trailing_stop', marketData: md, agentName: 'test', simDate: '2026-03-10' });
    assert(sold === true, 'Sell succeeds');
    assert(!p.holdings.AAPL, 'Holdings cleared');
    assert(p.closedTrades.length === 1, 'Closed trade recorded');
    assert(p.closedTrades[0].signalCode === 'REV', 'Signal code on closed trade');
    assert(p.closedTrades[0].exitReason === 'trailing_stop', 'Exit reason recorded');
}

// ═══════════════════════════════════════════════════
// 14. RSI Calculation
// ═══════════════════════════════════════════════════
section('RSI Calculation');
{
    const bars = [];
    for (let i = 0; i < 20; i++) bars.push({ c: 100 + i * 0.5, h: 101 + i, l: 99, v: 1000 });
    const rsi = calculateRSI(bars);
    assert(rsi !== null, 'RSI calculated');
    assert(rsi > 50, 'Uptrend RSI > 50');

    assert(calculateRSI(null) === null, 'RSI null for null bars');
    assert(calculateRSI(bars.slice(0, 5)) === null, 'RSI null for insufficient bars');
}

// ═══════════════════════════════════════════════════
// 15. SMA Calculation
// ═══════════════════════════════════════════════════
section('SMA Calculation');
{
    const bars = Array.from({ length: 25 }, (_, i) => ({ c: 100 + i, h: 101 + i, l: 99 + i, v: 1000 }));
    const sma = calculateSMA(bars, 20);
    assert(sma !== null, 'SMA calculated');
    assert(sma > 100, 'SMA reasonable value');
    assert(calculateSMA(bars.slice(0, 5), 20) === null, 'SMA null for insufficient bars');
}

// ═══════════════════════════════════════════════════
// 16. MACD Calculation
// ═══════════════════════════════════════════════════
section('MACD Calculation');
{
    const bars = Array.from({ length: 40 }, (_, i) => ({ c: 100 + Math.sin(i * 0.3) * 5, h: 105, l: 95, v: 1000 }));
    const macd = calculateMACD(bars);
    assert(macd !== null, 'MACD calculated');
    assert(typeof macd.histogram === 'number', 'MACD has histogram');
    assert(['bullish', 'bearish', 'none'].includes(macd.crossover), 'MACD has valid crossover');
    assert(calculateMACD(bars.slice(0, 10)) === null, 'MACD null for insufficient bars');
}

// ═══════════════════════════════════════════════════
// 17. Structure Detection
// ═══════════════════════════════════════════════════
section('Structure Detection');
{
    // Create bars with clear swing highs and lows for structure detection
    // Pattern: up, peak, dip, up higher, peak higher, dip higher...
    const bullBars = [
        { h: 102, l: 98, c: 101, v: 1000, t: 1 },
        { h: 105, l: 100, c: 104, v: 1000, t: 2 },  // swing high candidate
        { h: 103, l: 99, c: 100, v: 1000, t: 3 },
        { h: 101, l: 96, c: 97, v: 1000, t: 4 },     // swing low candidate
        { h: 103, l: 98, c: 102, v: 1000, t: 5 },
        { h: 107, l: 102, c: 106, v: 1000, t: 6 },   // higher swing high
        { h: 105, l: 101, c: 103, v: 1000, t: 7 },
        { h: 104, l: 99, c: 100, v: 1000, t: 8 },    // higher swing low
        { h: 106, l: 101, c: 105, v: 1000, t: 9 },
        { h: 110, l: 105, c: 109, v: 1000, t: 10 },  // even higher swing high
        { h: 108, l: 103, c: 105, v: 1000, t: 11 },
    ];
    const struct = detectStructure(bullBars);
    assert(struct.structure !== 'unknown', 'Structure detected');
    assert(typeof struct.structureScore === 'number', 'Structure has score');
    assert(struct.structureScore >= -3 && struct.structureScore <= 3, 'Structure score in range');

    assert(detectStructure(null).structure === 'unknown', 'Null bars → unknown');
    assert(detectStructure([]).structure === 'unknown', 'Empty bars → unknown');
}

// ═══════════════════════════════════════════════════
// 18. ATR Calculation
// ═══════════════════════════════════════════════════
section('ATR Calculation');
{
    const bars = Array.from({ length: 20 }, (_, i) => ({
        h: 105 + i, l: 95 + i, c: 100 + i, v: 1000
    }));
    const atr = calculateATR(bars);
    assert(atr !== null, 'ATR calculated');
    assert(atr > 0, 'ATR positive');
    assert(calculateATR(bars.slice(0, 5)) === null, 'ATR null for insufficient bars');
}

// ═══════════════════════════════════════════════════
// 19. 5-Day Momentum
// ═══════════════════════════════════════════════════
section('5-Day Momentum');
{
    const upBars = [
        { c: 100, h: 101, l: 99, v: 1000 },
        { c: 102, h: 103, l: 101, v: 1200 },
        { c: 104, h: 105, l: 103, v: 1100 },
        { c: 106, h: 107, l: 105, v: 1300 },
        { c: 108, h: 109, l: 107, v: 1400 },
    ];
    const mom = calculate5DayMomentum({ price: 108, changePercent: 2 }, upBars);
    assert(mom.score >= 6, 'Uptrend momentum score >= 6');
    assert(mom.totalReturn5d > 0, 'Positive 5d return');

    const downBars = [
        { c: 100, h: 101, l: 99, v: 1000 },
        { c: 98, h: 99, l: 97, v: 1200 },
        { c: 96, h: 97, l: 95, v: 1100 },
        { c: 94, h: 95, l: 93, v: 1300 },
        { c: 92, h: 93, l: 91, v: 1400 },
    ];
    const momDown = calculate5DayMomentum({ price: 92, changePercent: -2 }, downBars);
    assert(momDown.score <= 4, 'Downtrend momentum score <= 4');
}

// ═══════════════════════════════════════════════════
// 20. Composite Score
// ═══════════════════════════════════════════════════
section('Composite Score');
{
    const result = calculateCompositeScore({
        momentumScore: 7, rsNormalized: 6, sectorFlow: 'inflow',
        structureScore: 2, isAccelerating: true, upDays: 4, totalDays: 4,
        todayChange: 2, totalReturn5d: 3, rsi: 45,
        macdCrossover: 'bullish', daysToCover: 0, volumeTrend: 1.1,
        fvg: 'none', sma20: 150, currentPrice: 152, smaCrossover: null
    });
    assert(result.total > 0, 'Bullish setup has positive score');
    assert(typeof result.breakdown === 'object', 'Score has breakdown');
    assert(result.breakdown.momentumContrib > 0, 'Momentum contributes positively');
    assert(result.breakdown.structureBonus > 0, 'Structure contributes positively');

    // Overbought should have lower or negative adjustments
    const overbought = calculateCompositeScore({
        momentumScore: 9.5, rsNormalized: 9, sectorFlow: 'neutral',
        structureScore: 1, isAccelerating: true, upDays: 4, totalDays: 4,
        todayChange: 8, totalReturn5d: 15, rsi: 82,
        macdCrossover: 'bullish', daysToCover: 0, volumeTrend: 1,
        fvg: 'none', sma20: 150, currentPrice: 180, smaCrossover: null
    });
    assert(overbought.breakdown.extensionPenalty < 0, 'Extension penalty applied');
    assert(overbought.breakdown.rsiBonusPenalty < 0, 'RSI overbought penalty applied');
    assert(overbought.breakdown.entryMultiplier < 1, 'Entry multiplier penalizes extended setups');
}

// ═══════════════════════════════════════════════════
// 21. Signal-to-Candidate Normalization
// ═══════════════════════════════════════════════════
section('Signal Candidate Normalization');
{
    const enriched = {
        macd: { crossover: 'bullish', histogram: 0.5 },
        rsi: 38,
        marketStructure: { structure: 'bullish', structureScore: 2 },
        momentum: { score: 6, totalReturn5d: -3, todayChange: -1, volumeTrend: 0.9 },
        relativeStrength: { rsScore: 65 },
        sectorRotation: { moneyFlow: 'inflow' },
        shortInterest: null,
        changePercent: -1,
    };
    const candidate = toSignalCandidate(enriched, 'bull');
    assert(candidate.macdCrossover === 'bullish', 'MACD crossover mapped');
    assert(candidate.rsi === 38, 'RSI mapped');
    assert(candidate.structure === 'bullish', 'Structure mapped');
    assert(candidate.return5d === -3, 'Return5d mapped');
    assert(candidate.momentum === 6, 'Momentum mapped');
    assert(candidate.rs === 65, 'RS mapped');
    assert(candidate._regime === 'bull', 'Regime mapped');
}

// ═══════════════════════════════════════════════════
// 22. Exit Strategy Configs
// ═══════════════════════════════════════════════════
section('Exit Strategy Configs');
{
    assert(EXIT_CONFIGS.trail8.trailing === 0.08, 'trail8 has 8% trailing');
    assert(EXIT_CONFIGS.target15.target === 0.15, 'target15 has 15% target');
    assert(EXIT_CONFIGS.time10.timeBased === 10, 'time10 has 10 day limit');
    assert(EXIT_CONFIGS.degrade50.degradation === 0.50, 'degrade50 has 50% threshold');
    assert(EXIT_CONFIGS.trailATR.trailing === 'atr2x', 'trailATR uses 2x ATR');
    assert(EXIT_CONFIGS.target15_trail8.target === 0.15 && EXIT_CONFIGS.target15_trail8.trailing === 0.08, 'Combo: target + trailing');
}

// ═══════════════════════════════════════════════════
// 23. Results Metrics
// ═══════════════════════════════════════════════════
section('Results Metrics');
{
    const portfolio = createBacktestPortfolio(50000, 'test');
    portfolio.closedTrades = [
        { profitLoss: 500, returnPercent: 10, holdTimeDays: 5, exitReason: 'profit_target', sector: 'Technology', entryRegime: 'bull', signalCode: 'REV', signalQuality: 'full' },
        { profitLoss: -200, returnPercent: -4, holdTimeDays: 3, exitReason: 'stop_loss', sector: 'Technology', entryRegime: 'bull', signalCode: 'REV', signalQuality: 'strong' },
        { profitLoss: 300, returnPercent: 6, holdTimeDays: 8, exitReason: 'trailing_stop', sector: 'Healthcare', entryRegime: 'choppy', signalCode: 'MOM', signalQuality: 'full' },
    ];
    const snapshots = [
        { date: '2026-01-02', portfolioValue: 50000, spyPrice: 450 },
        { date: '2026-01-03', portfolioValue: 50500, spyPrice: 452 },
        { date: '2026-01-06', portfolioValue: 50600, spyPrice: 454 },
    ];

    const metrics = computeResults(portfolio, snapshots, 50000);
    assert(metrics.totalTrades === 3, 'Total trades = 3');
    assert(metrics.winRate > 50, 'Win rate > 50% (2/3 winners)');
    assert(metrics.exitReasons.profit_target === 1, 'Exit reason tracked');
    assert(metrics.exitReasons.trailing_stop === 1, 'Trailing stop tracked');
    assert(metrics.signalAccuracy.REV.trades === 2, 'REV signal accuracy: 2 trades');
    assert(metrics.signalAccuracy.REV.wins === 1, 'REV: 1 win');
    assert(metrics.signalAccuracy.MOM.trades === 1, 'MOM signal accuracy: 1 trade');
    assert(metrics.signalAccuracy.REV.byQuality.full.trades === 1, 'REV full quality: 1 trade');
    assert(metrics.signalAccuracy.REV.byQuality.strong.trades === 1, 'REV strong quality: 1 trade');
}

// ═══════════════════════════════════════════════════
// 24. Matrix Summary
// ═══════════════════════════════════════════════════
section('Matrix Summary');
{
    const mockResults = [
        { strategy: 'REV_trail8_calibrated', metrics: { totalReturn: 12, winRate: 58, sharpe: 1.2, totalTrades: 24, maxDrawdown: 8, profitFactor: 2.1, avgHoldDays: 5 } },
        { strategy: 'NOSIGNAL_trail8_calibrated', metrics: { totalReturn: 8, winRate: 50, sharpe: 0.8, totalTrades: 30, maxDrawdown: 10, profitFactor: 1.5, avgHoldDays: 6 } },
        { strategy: 'MOM_trail8_calibrated', metrics: { totalReturn: -2, winRate: 42, sharpe: -0.3, totalTrades: 18, maxDrawdown: 12, profitFactor: 0.8, avgHoldDays: 7 } },
    ];
    const summary = computeMatrixSummary(mockResults, '2025-06-01', '2026-03-15');
    assert(summary.type === 'matrix', 'Summary type = matrix');
    assert(summary.totalCombinations === 3, 'Total combinations = 3');
    assert(summary.grid.REV.trail8.calibrated.totalReturn === 12, 'Grid REV/trail8 return = 12');
    assert(summary.grid.REV.trail8.calibrated.vsBaseline.returnDelta === 4, 'REV alpha = +4% vs NOSIGNAL');
    assert(summary.best.byReturn.signal === 'REV', 'Best by return = REV');
}

// ═══════════════════════════════════════════════════
// 25. Data Manager (weekday generation)
// ═══════════════════════════════════════════════════
section('Data Manager');
{
    const start = new Date('2026-03-02');
    const end = new Date('2026-03-06');
    const days = generateWeekdays(start, end);
    assert(days.length === 5, 'Mon-Fri = 5 weekdays');
    assert(days[0] === '2026-03-02', 'First day is Monday');
    assert(days[4] === '2026-03-06', 'Last day is Friday');

    const before = getWeekdaysBefore(new Date('2026-03-06'), 5);
    assert(before.length === 5, '5 weekdays before Friday');
}

// ═══════════════════════════════════════════════════
// 26. Hold Discipline
// ═══════════════════════════════════════════════════
section('Hold Discipline');
{
    const p = createBacktestPortfolio(50000, 'test');
    executeBuy(p, { symbol: 'TEST', shares: 10, price: 100, conviction: 8, reasoning: 'test', marketData: {}, agentName: 'test', simDate: '2026-03-02' });

    // Same-day sell should be blocked
    const sameDaySell = executeSell(p, { symbol: 'TEST', shares: 10, price: 105, reasoning: 'too soon', exitReason: 'profit_target', marketData: {}, agentName: 'test', simDate: '2026-03-02' });
    assert(sameDaySell === false, 'Same-day sell blocked (anti-whipsaw)');

    // Next-day sell at small loss should be blocked (hold discipline, <3 days)
    const earlySmallLoss = executeSell(p, { symbol: 'TEST', shares: 10, price: 95, reasoning: 'small loss', exitReason: 'stop_loss', marketData: {}, agentName: 'test', simDate: '2026-03-03' });
    assert(earlySmallLoss === false, 'Early small-loss sell blocked (<3 days, >-15%)');

    // Extreme loss should override hold discipline
    const extremeLoss = executeSell(p, { symbol: 'TEST', shares: 10, price: 80, reasoning: 'crash', exitReason: 'stop_loss', marketData: {}, agentName: 'test', simDate: '2026-03-03' });
    assert(extremeLoss === true, 'Extreme loss (-20%) overrides hold discipline');
}

// ═══════════════════════════════════════════════════
// 27. Rebuy Cooldown
// ═══════════════════════════════════════════════════
section('Rebuy Cooldown');
{
    const p = createBacktestPortfolio(50000, 'test');
    executeBuy(p, { symbol: 'XYZ', shares: 5, price: 100, conviction: 8, reasoning: 'test', marketData: {}, agentName: 'test', simDate: '2026-03-02' });
    executeSell(p, { symbol: 'XYZ', shares: 5, price: 110, reasoning: 'profit', exitReason: 'profit_target', marketData: {}, agentName: 'test', simDate: '2026-03-06' });

    // Immediate rebuy should be blocked
    const rebuy = executeBuy(p, { symbol: 'XYZ', shares: 5, price: 108, conviction: 8, reasoning: 'rebuy', marketData: {}, agentName: 'test', simDate: '2026-03-07' });
    assert(rebuy === false, 'Rebuy blocked during cooldown');
}

// ═══════════════════════════════════════════════════
// 28. Unconstrained Mode
// ═══════════════════════════════════════════════════
section('Unconstrained Mode');
{
    // Strategy builder with unconstrained flag
    const uncStrategy = buildStrategy('REV', 'time15', 'calibrated', true);
    assert(uncStrategy.entry.unconstrained === true, 'Unconstrained flag set');
    assert(uncStrategy.entry.maxHoldings === Infinity, 'Unconstrained: infinite maxHoldings');
    assert(uncStrategy.entry.maxBuysPerDay === Infinity, 'Unconstrained: infinite buys/day');
    assert(uncStrategy.entry.rebuyCooldownDays === 0, 'Unconstrained: no rebuy cooldown');
    assert(uncStrategy.entry.fixedPositionSize === 5000, 'Unconstrained: $5K position size');
    assert(uncStrategy.name.endsWith('_unc'), 'Unconstrained strategy name has _unc suffix');

    // Constrained strategy should NOT have unconstrained flag
    const conStrategy = buildStrategy('REV', 'time15', 'calibrated', false);
    assert(!conStrategy.entry.unconstrained, 'Constrained: no unconstrained flag');
    assert(conStrategy.entry.maxHoldings === 100, 'Constrained: maxHoldings = 100');

    // Matrix generation with unconstrained
    const uncMatrix = generateMatrix({ signals: ['REV'], exits: ['time15'], weights: ['calibrated'], unconstrained: true });
    assert(uncMatrix.length === 1, 'Unconstrained matrix: 1 combo');
    assert(uncMatrix[0].entry.unconstrained === true, 'Matrix strategy is unconstrained');

    // Unconstrained entry rules config
    assert(UNCONSTRAINED_ENTRY_RULES.maxHoldings === Infinity, 'UNCONSTRAINED_ENTRY_RULES: infinite holdings');
    assert(UNCONSTRAINED_ENTRY_RULES.fixedPositionSize === 5000, 'UNCONSTRAINED_ENTRY_RULES: $5K positions');
    assert(UNCONSTRAINED_ENTRY_RULES.maxSectorConcentration === 1.0, 'UNCONSTRAINED_ENTRY_RULES: no sector cap');

    // Portfolio with unconstrained flag
    const uncPortfolio = createBacktestPortfolio(50000, 'test', { unconstrained: true });
    assert(uncPortfolio.unconstrained === true, 'Unconstrained portfolio flagged');
    assert(uncPortfolio.cash === Infinity, 'Unconstrained portfolio: infinite cash');

    // Unconstrained buy skips rebuy cooldown
    const p = createBacktestPortfolio(50000, 'test', { unconstrained: true });
    executeBuy(p, { symbol: 'XYZ', shares: 5, price: 100, conviction: 8, reasoning: 'test', marketData: {}, agentName: 'test', simDate: '2026-03-02' });
    executeSell(p, { symbol: 'XYZ', shares: 5, price: 110, reasoning: 'profit', exitReason: 'profit_target', marketData: {}, agentName: 'test', simDate: '2026-03-06' });
    const rebuy = executeBuy(p, { symbol: 'XYZ', shares: 5, price: 108, conviction: 8, reasoning: 'rebuy', marketData: {}, agentName: 'test', simDate: '2026-03-07' });
    assert(rebuy === true, 'Unconstrained: rebuy NOT blocked (no cooldown)');
}

// ═══════════════════════════════════════════════════
// 29. Signal Pattern Definitions
// ═══════════════════════════════════════════════════
section('Signal Pattern Definitions');
{
    assert(ENTRY_SIGNAL_PATTERNS.length === 6, '6 signal patterns defined');
    assert(ENTRY_SIGNAL_PATTERNS[0].id === 'REV', 'First pattern is REV');
    assert(ENTRY_SIGNAL_PATTERNS[5].id === 'AVOID', 'Last pattern is AVOID');
    assert(ENTRY_SIGNAL_PATTERNS[5].antiPattern === true, 'AVOID is anti-pattern');

    // All patterns have required fields
    for (const p of ENTRY_SIGNAL_PATTERNS) {
        assert(p.id && p.badge && p.criteria.length > 0, `Pattern ${p.id} has id, badge, criteria`);
        assert(typeof p.minMatch === 'number', `Pattern ${p.id} has minMatch`);
        assert(Array.isArray(p.requireAny), `Pattern ${p.id} has requireAny`);
    }
}

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'═'.repeat(50)}`);
if (failed > 0) process.exit(1);
