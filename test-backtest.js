#!/usr/bin/env node
// Tests for backtester engine modules
import { determineRegime } from './engine/regime.js';
import { scoreToConviction } from './engine/entry-rules.js';
import { buildCandidatePool } from './engine/candidate-pool.js';
import { computeResults } from './engine/results.js';
import { calculatePositionSize, countTradingDays, addTradingDays, executeBuy, executeSell } from './portfolio/manager.js';
import { createBacktestPortfolio } from './portfolio/schema.js';
import { calculateCompositeScore, calculateRSI, calculateSMA, calculateMACD, detectStructure, calculateSMACrossover, DEFAULT_WEIGHTS } from './data/technicals.js';
import { DataManager, generateWeekdays, getWeekdaysBefore } from './engine/data-manager.js';
import { STRATEGIES } from './config/strategies.js';

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

const bearResult = determineRegime({ level: 35, changePercent: 12 }, null, null);
assert(bearResult.regime === 'bear', 'VIX 35 + spiking → bear');

const bullResult = determineRegime({ level: 14, changePercent: -6 }, null, null);
assert(bullResult.regime !== 'bear', 'VIX 14 + falling → not bear');

const choppyResult = determineRegime({ level: 22, changePercent: 2 }, null, null);
assert(choppyResult.regime === 'choppy', 'VIX 22 + stable → choppy');

const nullVixResult = determineRegime(null, null, null);
assert(nullVixResult.regime === 'choppy', 'null VIX → choppy (default)');

// ═══════════════════════════════════════════════════
// 2. Score → Conviction Mapping
// ═══════════════════════════════════════════════════
section('Score → Conviction Mapping');

const baseline = STRATEGIES.baseline;
assert(scoreToConviction(20, baseline.convictionMap) === 10, 'Score 20 → conviction 10');
assert(scoreToConviction(16, baseline.convictionMap) === 9, 'Score 16 → conviction 9');
assert(scoreToConviction(12, baseline.convictionMap) === 8, 'Score 12 → conviction 8');
assert(scoreToConviction(9, baseline.convictionMap) === 7, 'Score 9 → conviction 7');
assert(scoreToConviction(6, baseline.convictionMap) === 6, 'Score 6 → conviction 6');
assert(scoreToConviction(3, baseline.convictionMap) === 0, 'Score 3 → 0 (below floor)');
assert(scoreToConviction(-5, baseline.convictionMap) === 0, 'Negative score → 0');

// ═══════════════════════════════════════════════════
// 3. Position Sizing
// ═══════════════════════════════════════════════════
section('Position Sizing');

const testPortfolio = createBacktestPortfolio(50000, 'test');
const shares7 = calculatePositionSize(testPortfolio, 7, 'bull', 100, {});
assert(shares7 > 0, 'Conviction 7 bull → positive shares');
assert(shares7 <= 100, 'Conviction 7 bull → reasonable shares (≤100 at $100)');

const shares5 = calculatePositionSize(testPortfolio, 5, 'bull', 100, {});
assert(shares5 === 0, 'Conviction 5 → 0 shares (below minimum)');

const shares10 = calculatePositionSize(testPortfolio, 10, 'bull', 100, {});
assert(shares10 > shares7, 'Conviction 10 → more shares than conviction 7');

// Regime deployment is a total portfolio cap enforced at processEntries level.
// Per-position sizing is conviction-driven. At conviction 10 (35%), 17500 < bear cap (30000),
// so individual position size is the same regardless of regime.
const sharesBearHigh = calculatePositionSize(testPortfolio, 10, 'bear', 100, {});
const sharesBullHigh = calculatePositionSize(testPortfolio, 10, 'bull', 100, {});
assert(sharesBearHigh === sharesBullHigh, 'Same per-position size — regime cap is portfolio-level');

// ═══════════════════════════════════════════════════
// 4. Trading Day Calculations
// ═══════════════════════════════════════════════════
section('Trading Day Calculations');

const mon = new Date('2026-03-02'); // Monday
const fri = new Date('2026-03-06'); // Friday
assert(countTradingDays(mon, fri) === 4, 'Mon→Fri = 4 trading days');

const friToMon = countTradingDays(new Date('2026-03-06'), new Date('2026-03-09'));
assert(friToMon === 1, 'Fri→Mon = 1 trading day (skips weekend)');

const added = addTradingDays(new Date('2026-03-02'), 5);
assert(added.getDay() !== 0 && added.getDay() !== 6, 'addTradingDays result is a weekday');

// ═══════════════════════════════════════════════════
// 5. Buy/Sell with simDate
// ═══════════════════════════════════════════════════
section('Buy/Sell with simDate');

const buyPortfolio = createBacktestPortfolio(50000, 'test');
const buySuccess = executeBuy(buyPortfolio, {
    symbol: 'AAPL', shares: 10, price: 150,
    conviction: 8, reasoning: 'Test buy',
    marketData: { AAPL: { price: 150, momentum: { score: 7 } } },
    vix: { level: 20 },
    agentName: 'Test',
    simDate: '2026-01-15',
});
assert(buySuccess === true, 'executeBuy with simDate succeeds');
assert(buyPortfolio.cash === 48500, 'Cash reduced by 10 * $150');
assert(buyPortfolio.holdings.AAPL === 10, 'Holdings updated');
assert(buyPortfolio.transactions[0].timestamp.startsWith('2026-01-15'), 'Transaction timestamp uses simDate');

// Sell after 5 trading days
const sellSuccess = executeSell(buyPortfolio, {
    symbol: 'AAPL', shares: 10, price: 160,
    reasoning: 'Test sell', exitReason: 'profit_target',
    marketData: {}, agentName: 'Test',
    simDate: '2026-01-22',
});
assert(sellSuccess === true, 'executeSell with simDate succeeds');
assert(buyPortfolio.cash === 50100, 'Cash = 48500 + 1600');
assert(buyPortfolio.closedTrades.length === 1, 'Closed trade recorded');
assert(buyPortfolio.closedTrades[0].returnPercent > 0, 'Positive return recorded');
assert(buyPortfolio.closedTrades[0].holdTimeDays > 0, 'Hold time in days recorded');

// Hold discipline: sell on day 1 should be blocked (unless stop)
const holdPortfolio = createBacktestPortfolio(50000, 'test');
executeBuy(holdPortfolio, {
    symbol: 'MSFT', shares: 5, price: 400,
    conviction: 8, reasoning: 'Test', marketData: {},
    agentName: 'Test', simDate: '2026-02-02',
});
const earlyBadSell = executeSell(holdPortfolio, {
    symbol: 'MSFT', shares: 5, price: 395,
    reasoning: 'Too early', exitReason: 'score_degradation',
    marketData: {}, agentName: 'Test',
    simDate: '2026-02-03', // next day
});
assert(earlyBadSell === false, 'Hold discipline blocks day-1 sell at -1.25%');

// But hard stop (-15%) overrides hold discipline
const earlyStopSell = executeSell(holdPortfolio, {
    symbol: 'MSFT', shares: 5, price: 335,
    reasoning: 'Stop loss', exitReason: 'stop_loss',
    marketData: {}, agentName: 'Test',
    simDate: '2026-02-03',
});
assert(earlyStopSell === true, 'Hard stop (-16.25%) overrides hold discipline');

// Rebuy cooldown
const rebuyCooldown = executeBuy(holdPortfolio, {
    symbol: 'MSFT', shares: 5, price: 330,
    conviction: 8, reasoning: 'Rebuy attempt',
    marketData: {}, agentName: 'Test',
    simDate: '2026-02-04', // next day after sell
});
assert(rebuyCooldown === false, 'Rebuy cooldown blocks immediate rebuy');

// ═══════════════════════════════════════════════════
// 6. Composite Score (synced with APEX)
// ═══════════════════════════════════════════════════
section('Composite Score');

const scoreResult = calculateCompositeScore({
    momentumScore: 7, rsNormalized: 6,
    sectorFlow: 'inflow', structureScore: 2,
    isAccelerating: true, upDays: 4, totalDays: 4,
    todayChange: 2, totalReturn5d: 3,
    rsi: 55, macdCrossover: 'bullish',
    daysToCover: 0, volumeTrend: 1.1,
    fvg: 'none', sma20: 100, currentPrice: 101,
    smaCrossover: { crossover: 'none' },
});
assert(typeof scoreResult === 'object', 'Score returns { total, breakdown }');
assert(typeof scoreResult.total === 'number', 'Score total is a number');
assert(scoreResult.total > 0, 'Bullish setup has positive score');
assert(scoreResult.breakdown.momentumContrib === 7 * 0.6, 'Momentum contrib = 7 * 0.6');
assert(scoreResult.breakdown.structureBonus === 2 * 1.25, 'Structure bonus = 2 * 1.25');
assert(scoreResult.breakdown.declinePenalty === 0, 'Decline penalty removed');
assert(scoreResult.breakdown.entryMultiplier !== undefined, 'Entry multiplier present');

// Extension penalty
const extendedScore = calculateCompositeScore({
    momentumScore: 9.5, rsNormalized: 9, sectorFlow: 'neutral',
    structureScore: 1, isAccelerating: true, upDays: 4, totalDays: 4,
    todayChange: 1, totalReturn5d: 10, rsi: 75, macdCrossover: 'bullish',
    daysToCover: 0, volumeTrend: 1, fvg: 'none',
    sma20: null, currentPrice: null, smaCrossover: null,
});
assert(extendedScore.breakdown.extensionPenalty < 0, 'Extended stock gets extension penalty');
assert(extendedScore.breakdown.entryMultiplier < 1, 'Extended stock gets entry multiplier < 1');

// SMA proximity bonus
const nearSmaScore = calculateCompositeScore({
    momentumScore: 5, rsNormalized: 5, sectorFlow: 'neutral',
    structureScore: 1, isAccelerating: false, upDays: 2, totalDays: 4,
    todayChange: 0, totalReturn5d: -1, rsi: 45, macdCrossover: 'none',
    daysToCover: 0, volumeTrend: 1, fvg: 'none',
    sma20: 100, currentPrice: 101, smaCrossover: null,
});
assert(nearSmaScore.breakdown.smaProximityBonus === 2.0, 'Near SMA20 with bullish structure gets +2.0');

// ═══════════════════════════════════════════════════
// 7. Technical Indicators
// ═══════════════════════════════════════════════════
section('Technical Indicators');

// Generate 30 bars for testing
const testBars = [];
for (let i = 0; i < 30; i++) {
    const base = 100 + i * 0.5 + (Math.sin(i * 0.5) * 3);
    testBars.push({ o: base - 0.5, h: base + 1, l: base - 1, c: base, v: 1000000, t: Date.now() - (30 - i) * 86400000 });
}

const rsi = calculateRSI(testBars);
assert(rsi !== null, 'RSI computed from 30 bars');
assert(rsi >= 0 && rsi <= 100, 'RSI in 0-100 range');

const sma = calculateSMA(testBars, 20);
assert(sma !== null, 'SMA20 computed from 30 bars');
assert(sma > 0, 'SMA20 is positive');

const macd = calculateMACD(testBars);
// 30 bars is < 35 so MACD should be null
assert(macd === null, 'MACD null with < 35 bars');

// 40 bars for MACD
const testBars40 = [];
for (let i = 0; i < 40; i++) {
    const base = 100 + i * 0.3;
    testBars40.push({ o: base, h: base + 1, l: base - 1, c: base, v: 1000000, t: Date.now() - (40 - i) * 86400000 });
}
const macd40 = calculateMACD(testBars40);
assert(macd40 !== null, 'MACD computed from 40 bars');
assert(typeof macd40.crossover === 'string', 'MACD has crossover signal');

// Structure detection
const structure = detectStructure(testBars);
assert(structure.structure !== 'unknown', 'Structure detected from 30 bars');
assert(typeof structure.structureScore === 'number', 'Structure score is a number');

// SMA crossover needs 52 bars
const smaCrossover = calculateSMACrossover(testBars);
assert(smaCrossover === null, 'SMA crossover null with < 52 bars');

const testBars55 = [];
for (let i = 0; i < 55; i++) {
    const base = 100 + i * 0.2;
    testBars55.push({ o: base, h: base + 1, l: base - 1, c: base, v: 1000000, t: Date.now() - (55 - i) * 86400000 });
}
const smaCross55 = calculateSMACrossover(testBars55);
assert(smaCross55 !== null, 'SMA crossover computed from 55 bars');
assert(typeof smaCross55.crossover === 'string', 'SMA crossover has signal');

// ═══════════════════════════════════════════════════
// 8. Results Computation
// ═══════════════════════════════════════════════════
section('Results Computation');

const mockPortfolio = createBacktestPortfolio(50000, 'test');
mockPortfolio.closedTrades = [
    { profitLoss: 500, returnPercent: 10, holdTimeDays: 5, exitReason: 'profit_target', entryRegime: 'bull', sector: 'Technology' },
    { profitLoss: -200, returnPercent: -4, holdTimeDays: 3, exitReason: 'stop_loss', entryRegime: 'bull', sector: 'Technology' },
    { profitLoss: 300, returnPercent: 6, holdTimeDays: 7, exitReason: 'profit_target', entryRegime: 'choppy', sector: 'Healthcare' },
];

const mockSnapshots = [
    { date: '2026-01-02', portfolioValue: 50000, spyPrice: 500 },
    { date: '2026-01-03', portfolioValue: 50200, spyPrice: 502 },
    { date: '2026-01-06', portfolioValue: 49800, spyPrice: 498 },
    { date: '2026-01-07', portfolioValue: 50600, spyPrice: 505 },
];

const metrics = computeResults(mockPortfolio, mockSnapshots, 50000);
assert(metrics.totalReturn === 1.2, 'Total return: (50600-50000)/50000 = 1.2%');
assert(metrics.totalTrades === 3, '3 closed trades');
assert(metrics.winRate === 66.67, 'Win rate: 2/3 = 66.67%');
assert(metrics.avgWinner === 8, 'Avg winner: (10+6)/2 = 8%');
assert(metrics.avgLoser === -4, 'Avg loser: -4%');
assert(metrics.profitFactor > 0, 'Profit factor > 0');
assert(metrics.maxDrawdown > 0, 'Max drawdown > 0');
assert(metrics.spyReturn === 1, 'SPY return: (505-500)/500 = 1%');
assert(metrics.byRegime.bull, 'Bull regime stats present');
assert(metrics.exitReasons.profit_target === 2, '2 profit target exits');
assert(metrics.exitReasons.stop_loss === 1, '1 stop loss exit');

// ═══════════════════════════════════════════════════
// 9. Date Utilities
// ═══════════════════════════════════════════════════
section('Date Utilities');

const weekdays = generateWeekdays('2026-03-02', '2026-03-06');
assert(weekdays.length === 5, 'Mon-Fri = 5 weekdays');

const weekdaysWithWeekend = generateWeekdays('2026-03-06', '2026-03-09');
assert(weekdaysWithWeekend.length === 2, 'Fri-Mon = 2 weekdays (Fri + Mon)');

const before = getWeekdaysBefore('2026-03-09', 5);
assert(before.length === 5, 'getWeekdaysBefore returns 5 dates');
assert(before[0] < before[4], 'Dates are sorted ascending');

// ═══════════════════════════════════════════════════
// 10. Candidate Pool
// ═══════════════════════════════════════════════════
section('Candidate Pool');

const mockScored = [];
for (let i = 0; i < 50; i++) {
    mockScored.push({
        symbol: `SYM${i}`,
        compositeScore: 20 - i * 0.4,
        data: {
            momentum: { score: 7 },
            relativeStrength: { rsScore: 60 },
            marketStructure: { structureScore: 1, choch: false, chochType: 'none', bos: false, bosType: 'none', sweep: 'none' },
        },
    });
}
const mockPool = createBacktestPortfolio(50000, 'test');
mockPool.holdings = { SYM30: 10, SYM45: 5 }; // holdings not in top 25

const pool = buildCandidatePool(mockScored, mockPool, {});
assert(pool.length >= 25, 'Pool has at least 25 candidates');
assert(pool.some(c => c.symbol === 'SYM30'), 'Current holdings included in pool');
assert(pool.some(c => c.symbol === 'SYM45'), 'Current holdings included in pool');

// ═══════════════════════════════════════════════════
// 11. Strategy Configs
// ═══════════════════════════════════════════════════
section('Strategy Configs');

for (const [name, strategy] of Object.entries(STRATEGIES)) {
    assert(strategy.name, `Strategy ${name} has a name`);
    assert(strategy.convictionMap?.tiers?.length > 0, `Strategy ${name} has conviction tiers`);
    assert(strategy.entry, `Strategy ${name} has entry rules`);
    assert(strategy.exit, `Strategy ${name} has exit rules`);
    assert(strategy.exit.holdDiscipline, `Strategy ${name} has hold discipline`);
}

// ═══════════════════════════════════════════════════
// 12. New Strategy-Specific Tests
// ═══════════════════════════════════════════════════
section('New Strategy Configs');

// Conservative: high conviction floor, fewer holdings
const conservative = STRATEGIES.conservative;
assert(conservative.convictionMap.floor >= 8, 'Conservative floor >= 8');
assert(conservative.entry.maxHoldings <= 6, 'Conservative max holdings <= 6');
assert(scoreToConviction(11, conservative.convictionMap) === 0, 'Conservative rejects score 11');
assert(scoreToConviction(12, conservative.convictionMap) >= 8, 'Conservative accepts score 12+');

// PatientExit: longer holds, stricter degradation threshold
const patientExit = STRATEGIES.patientExit;
assert(patientExit.exit.holdDiscipline.minHoldDays >= 8, 'PatientExit min hold >= 8 days');
assert(patientExit.exit.scoreDegradation.dropThreshold < 0.5, 'PatientExit degradation threshold stricter than baseline');
assert(patientExit.exit.mechanicalTarget === null, 'PatientExit has no mechanical target');

// RegimeIgnore: deployment override to always be fully deployed
const regimeIgnore = STRATEGIES.regimeIgnore;
assert(regimeIgnore.entry.deploymentOverride, 'RegimeIgnore has deployment override');
assert(regimeIgnore.entry.deploymentOverride.min >= 0.90, 'RegimeIgnore deploys 90%+ regardless of regime');

// ═══════════════════════════════════════════════════
// 13. Deployment Override in Entry Rules
// ═══════════════════════════════════════════════════
section('Deployment Override');

import { processEntries } from './engine/entry-rules.js';

// Create a bear market scenario with regimeIgnore strategy — should still deploy
const overridePortfolio = createBacktestPortfolio(50000, 'test');
const overrideEnhanced = {};
const overrideScored = [];
for (let i = 0; i < 10; i++) {
    const sym = `OVR${i}`;
    overrideEnhanced[sym] = {
        price: 100,
        bars: Array(20).fill({ o: 99, h: 101, l: 98, c: 100, v: 1000000, t: Date.now() }),
        momentum: { score: 7, volumeTrend: 1.1 },
        relativeStrength: { rsScore: 60 },
        compositeScore: 15,
    };
    overrideScored.push({ symbol: sym, compositeScore: 15, data: overrideEnhanced[sym] });
}

// With regimeIgnore in bear market, should still buy (deployment override)
const bearBuys = processEntries(overridePortfolio, overrideEnhanced, overrideScored, {}, 'bear', regimeIgnore, '2026-01-15', 35);
assert(bearBuys > 0, 'RegimeIgnore buys in bear market');

// With baseline in bear market and same setup, deployment cap is tighter
const baselinePortfolio = createBacktestPortfolio(50000, 'test');
const baselineBearBuys = processEntries(baselinePortfolio, overrideEnhanced, overrideScored, {}, 'bear', baseline, '2026-01-15', 35);
// Both should buy since starting from 100% cash, but regimeIgnore should buy at least as many
assert(bearBuys >= baselineBearBuys, 'RegimeIgnore buys >= baseline in bear market');

// ═══════════════════════════════════════════════════
// 14. DataManager (unit tests — no API calls)
// ═══════════════════════════════════════════════════
section('DataManager Windowing');

const dm = new DataManager();
// Manually inject test data — need at least 5 bars visible for getMarketState to include a symbol
dm.masterBars = {
    'TEST': [
        { o: 96, h: 97, l: 95, c: 96, v: 800, t: new Date('2025-12-29T16:00:00Z').getTime() },
        { o: 97, h: 98, l: 96, c: 97, v: 900, t: new Date('2025-12-30T16:00:00Z').getTime() },
        { o: 98, h: 99, l: 97, c: 98, v: 950, t: new Date('2025-12-31T16:00:00Z').getTime() },
        { o: 100, h: 101, l: 99, c: 100, v: 1000, t: new Date('2026-01-02T16:00:00Z').getTime() },
        { o: 101, h: 102, l: 100, c: 101, v: 1100, t: new Date('2026-01-03T16:00:00Z').getTime() },
        { o: 102, h: 103, l: 101, c: 102, v: 1200, t: new Date('2026-01-06T16:00:00Z').getTime() },
        { o: 103, h: 104, l: 102, c: 103, v: 1300, t: new Date('2026-01-07T16:00:00Z').getTime() },
        { o: 104, h: 105, l: 103, c: 104, v: 1400, t: new Date('2026-01-08T16:00:00Z').getTime() },
    ],
};

// Windowed view on Jan 6 should NOT include Jan 7 or Jan 8
const { marketData: md1, multiDayCache: mdc1 } = dm.getMarketState('2026-01-06');
assert(mdc1.TEST.length === 6, 'Windowed to 6 bars (Dec 29,30,31, Jan 2,3,6)');
assert(md1.TEST.price === 102, 'Current price is Jan 6 close');

// Full view on Jan 8 should include all 8 bars
const { marketData: md2, multiDayCache: mdc2 } = dm.getMarketState('2026-01-08');
assert(mdc2.TEST.length === 8, 'All 8 bars visible on Jan 8');
assert(md2.TEST.price === 104, 'Current price is Jan 8 close');

// View BEFORE any data should return empty (< 5 bars visible)
const { marketData: md0 } = dm.getMarketState('2025-12-29');
assert(!md0.TEST, 'No data with fewer than 5 bars');

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════');

if (failed > 0) process.exit(1);
