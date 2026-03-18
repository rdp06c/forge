// Main backtesting simulation engine
// Supports single strategy runs and matrix mode (shared enrichment, N strategy passes)
import { DataManager } from './data-manager.js';
import { determineRegime } from './regime.js';
import { processEntries } from './entry-rules.js';
import { processExits } from './exit-rules.js';
import { computeResults } from './results.js';
import { enrichMarketData } from '../data/scoring.js';
import { createBacktestPortfolio } from '../portfolio/schema.js';
import { executeSell } from '../portfolio/manager.js';
import { getWeights } from '../config/calibration.js';

/**
 * Run a full portfolio backtest for a single signal+exit strategy.
 *
 * @param {object} config
 * @param {string} config.startDate - 'YYYY-MM-DD' first trading day
 * @param {string} config.endDate - 'YYYY-MM-DD' last trading day
 * @param {object} config.strategy - Strategy object from buildStrategy()
 * @param {number} [config.initialBalance=50000]
 * @param {number} [config.lookbackDays=80]
 * @returns {{ portfolio, dailySnapshots, metrics, strategy }}
 */
export async function runBacktest(config) {
    const { startDate, endDate, strategy, initialBalance = 50000, lookbackDays = 80 } = config;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Strategy: ${strategy.displayName || strategy.name}`);
    console.log(`Period: ${startDate} → ${endDate}`);
    console.log(`Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`${'─'.repeat(60)}`);

    // Phase 1: Fetch all historical data upfront
    const dataManager = new DataManager();
    await dataManager.loadDateRange(startDate, endDate, lookbackDays);

    // Phase 2: Initialize portfolio
    const portfolio = createBacktestPortfolio(initialBalance, strategy.name, { unconstrained: !!strategy.entry.unconstrained });

    // Phase 3: Get trading days
    const tradingDays = dataManager.getTradingDays(startDate, endDate);
    if (tradingDays.length === 0) {
        console.error('No trading days found in the specified range.');
        return { portfolio, dailySnapshots: [], metrics: computeResults(portfolio, [], initialBalance), strategy: strategy.name };
    }

    console.log(`Simulating ${tradingDays.length} trading days (${tradingDays[0]} → ${tradingDays[tradingDays.length - 1]})...\n`);

    const weights = getWeights(strategy.weightsName);
    const dailySnapshots = [];

    // Phase 4: Simulate each day
    for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
        const simDate = tradingDays[dayIdx];
        simulateDay(dataManager, portfolio, strategy, weights, simDate, dayIdx, tradingDays, dailySnapshots, initialBalance);
    }

    // Phase 5: Force close all remaining positions
    forceClosePositions(dataManager, portfolio, strategy, tradingDays);

    // Phase 6: Compute metrics
    const metrics = computeResults(portfolio, dailySnapshots, initialBalance);

    return { portfolio, dailySnapshots, metrics, strategy: strategy.name };
}

/**
 * Run matrix mode — multiple strategies sharing the same enriched data per day.
 * This is much faster than running each strategy independently because
 * data fetching and enrichment (~95% of runtime) happen once.
 *
 * @param {object} config
 * @param {string} config.startDate
 * @param {string} config.endDate
 * @param {object[]} config.strategies - Array of strategy objects
 * @param {number} [config.initialBalance=50000]
 * @param {number} [config.lookbackDays=80]
 * @returns {object[]} Array of { portfolio, dailySnapshots, metrics, strategy }
 */
export async function runMatrix(config) {
    const { startDate, endDate, strategies, initialBalance = 50000, lookbackDays = 80 } = config;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`MATRIX MODE: ${strategies.length} strategy combinations`);
    console.log(`Period: ${startDate} → ${endDate}`);
    console.log(`Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Phase 1: Load data once
    const dataManager = new DataManager();
    await dataManager.loadDateRange(startDate, endDate, lookbackDays);

    const tradingDays = dataManager.getTradingDays(startDate, endDate);
    if (tradingDays.length === 0) {
        console.error('No trading days found.');
        return [];
    }

    console.log(`Simulating ${tradingDays.length} trading days × ${strategies.length} strategies...\n`);

    // Phase 2: Initialize one portfolio per strategy
    const runs = strategies.map(strategy => ({
        strategy,
        portfolio: createBacktestPortfolio(initialBalance, strategy.name, { unconstrained: !!strategy.entry.unconstrained }),
        weights: getWeights(strategy.weightsName),
        dailySnapshots: [],
    }));

    // Phase 3: For each day, compute enrichment once then run all strategies
    for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
        const simDate = tradingDays[dayIdx];

        // Get windowed market data (computed once)
        const { marketData, multiDayCache } = dataManager.getMarketState(simDate);

        // VIX data (computed once)
        const vixLevel = dataManager.getVIX(simDate);
        const vixObj = vixLevel != null ? { level: vixLevel, changePercent: 0 } : null;
        if (vixObj && dayIdx > 0) {
            const prevVix = dataManager.getVIX(tradingDays[dayIdx - 1]);
            if (prevVix && prevVix > 0) {
                vixObj.changePercent = ((vixLevel - prevVix) / prevVix) * 100;
            }
        }

        // Group runs by weight set to avoid redundant enrichment
        const byWeights = {};
        for (const run of runs) {
            const wName = run.strategy.weightsName;
            if (!byWeights[wName]) byWeights[wName] = [];
            byWeights[wName].push(run);
        }

        for (const [weightsName, weightRuns] of Object.entries(byWeights)) {
            const weights = getWeights(weightsName);

            const { enhanced, scored, signals, sectorRotation } = enrichMarketData(
                marketData, multiDayCache, { weights, regime: null }
            );

            const regimeResult = determineRegime(vixObj, sectorRotation, marketData);
            const regime = regimeResult.regime;

            // Now update regime on enrichment (signals may depend on it)
            // Re-evaluate signals with regime context if needed
            // (The regime is passed to signal evaluation via enrichMarketData opts)

            // Run each strategy against the shared enriched data
            for (const run of weightRuns) {
                run.portfolio.lastMarketRegime = { regime, date: simDate };

                // Clean expired rebuy cooldowns
                if (run.portfolio.blockedTrades?.length > 0) {
                    const simTime = new Date(simDate + 'T16:00:00Z');
                    run.portfolio.blockedTrades = run.portfolio.blockedTrades.filter(b => new Date(b.blockedUntil) > simTime);
                }

                // Update high-water marks for all holdings
                for (const [sym, thesis] of Object.entries(run.portfolio.holdingTheses || {})) {
                    const price = enhanced[sym]?.price;
                    if (price && (!thesis.highWaterMark || price > thesis.highWaterMark)) {
                        thesis.highWaterMark = price;
                    }
                }

                // EXIT PHASE
                const sellCount = processExits(run.portfolio, enhanced, regime, run.strategy, simDate);

                // ENTRY PHASE
                const buyCount = processEntries(run.portfolio, enhanced, scored, regime, run.strategy, simDate, vixLevel);

                // Record snapshot
                let totalValue = run.portfolio.cash;
                for (const [sym, shares] of Object.entries(run.portfolio.holdings)) {
                    totalValue += shares * (enhanced[sym]?.price || 0);
                }

                run.dailySnapshots.push({
                    date: simDate,
                    portfolioValue: totalValue,
                    cash: run.portfolio.cash,
                    holdingsCount: Object.keys(run.portfolio.holdings).length,
                    regime,
                    vix: vixLevel,
                    spyPrice: enhanced['SPY']?.price || null,
                    buys: buyCount,
                    sells: sellCount,
                });
            }
        }

        // Progress logging every 20 days
        if ((dayIdx + 1) % 20 === 0 || dayIdx === tradingDays.length - 1) {
            console.log(`  Day ${dayIdx + 1}/${tradingDays.length} (${simDate})`);
        }
    }

    // Phase 4: Force close and compute metrics for each strategy
    const results = [];
    for (const run of runs) {
        forceClosePositions(dataManager, run.portfolio, run.strategy, tradingDays);
        const metrics = computeResults(run.portfolio, run.dailySnapshots, initialBalance);
        results.push({
            portfolio: run.portfolio,
            dailySnapshots: run.dailySnapshots,
            metrics,
            strategy: run.strategy.name,
        });
    }

    return results;
}

// ═══════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════

/**
 * Simulate one trading day for a single strategy
 */
function simulateDay(dataManager, portfolio, strategy, weights, simDate, dayIdx, tradingDays, dailySnapshots, initialBalance) {
    // 1. Get windowed market state
    const { marketData, multiDayCache } = dataManager.getMarketState(simDate);

    // 2. Enrich with technicals + scores + signals
    const { enhanced, scored, signals, sectorRotation } = enrichMarketData(
        marketData, multiDayCache, { weights }
    );

    // 3. Determine regime
    const vixLevel = dataManager.getVIX(simDate);
    const vixObj = vixLevel != null ? { level: vixLevel, changePercent: 0 } : null;
    if (vixObj && dayIdx > 0) {
        const prevVix = dataManager.getVIX(tradingDays[dayIdx - 1]);
        if (prevVix && prevVix > 0) {
            vixObj.changePercent = ((vixLevel - prevVix) / prevVix) * 100;
        }
    }
    const regimeResult = determineRegime(vixObj, sectorRotation, marketData);
    const regime = regimeResult.regime;
    portfolio.lastMarketRegime = { regime, date: simDate };

    // Clean expired rebuy cooldowns
    if (portfolio.blockedTrades?.length > 0) {
        const simTime = new Date(simDate + 'T16:00:00Z');
        portfolio.blockedTrades = portfolio.blockedTrades.filter(b => new Date(b.blockedUntil) > simTime);
    }

    // Update high-water marks for trailing stops
    for (const [sym, thesis] of Object.entries(portfolio.holdingTheses || {})) {
        const price = enhanced[sym]?.price;
        if (price && (!thesis.highWaterMark || price > thesis.highWaterMark)) {
            thesis.highWaterMark = price;
        }
    }

    // 4. EXIT PHASE
    const sellCount = processExits(portfolio, enhanced, regime, strategy, simDate);

    // 5. ENTRY PHASE
    const buyCount = processEntries(portfolio, enhanced, scored, regime, strategy, simDate, vixLevel);

    // 6. Record snapshot
    let totalValue = portfolio.cash;
    for (const [sym, shares] of Object.entries(portfolio.holdings)) {
        totalValue += shares * (enhanced[sym]?.price || 0);
    }

    dailySnapshots.push({
        date: simDate,
        portfolioValue: totalValue,
        cash: portfolio.cash,
        holdingsCount: Object.keys(portfolio.holdings).length,
        regime,
        vix: vixLevel,
        spyPrice: enhanced['SPY']?.price || null,
        buys: buyCount,
        sells: sellCount,
    });

    // Progress logging
    if ((dayIdx + 1) % 20 === 0 || dayIdx === tradingDays.length - 1) {
        const ret = ((totalValue - initialBalance) / initialBalance * 100).toFixed(1);
        const holdings = Object.keys(portfolio.holdings).length;
        console.log(`  Day ${dayIdx + 1}/${tradingDays.length} (${simDate}): $${totalValue.toFixed(0)} (${ret}%), ${holdings} holdings, ${regime}`);
    }
}

/**
 * Force close all remaining positions at final prices
 */
function forceClosePositions(dataManager, portfolio, strategy, tradingDays) {
    const finalDate = tradingDays[tradingDays.length - 1];
    const { marketData: finalMarket } = dataManager.getMarketState(finalDate);
    const remainingSymbols = Object.keys(portfolio.holdings);
    if (remainingSymbols.length > 0) {
        for (const symbol of remainingSymbols) {
            const shares = portfolio.holdings[symbol];
            const price = finalMarket[symbol]?.price;
            if (price && shares) {
                executeSell(portfolio, {
                    symbol, shares, price,
                    reasoning: 'End of backtest period',
                    exitReason: 'end_of_backtest',
                    marketData: finalMarket,
                    agentName: strategy.name,
                    simDate: finalDate,
                });
            }
        }
    }
}
