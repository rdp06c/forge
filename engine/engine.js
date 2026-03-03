// Main backtesting simulation engine
// Loops through historical trading days, simulating APEX's decision pipeline deterministically
import { DataManager } from './data-manager.js';
import { determineRegime } from './regime.js';
import { processEntries } from './entry-rules.js';
import { processExits } from './exit-rules.js';
import { computeResults } from './results.js';
import { enrichMarketData, detectSectorRotation } from '../data/technicals.js';
import { createBacktestPortfolio } from '../portfolio/schema.js';
import { executeSell } from '../portfolio/manager.js';

/**
 * Run a full portfolio backtest over a date range with a given strategy.
 *
 * @param {object} config
 * @param {string} config.startDate - 'YYYY-MM-DD' first trading day
 * @param {string} config.endDate - 'YYYY-MM-DD' last trading day
 * @param {object} config.strategy - Strategy definition from strategies.js
 * @param {number} [config.initialBalance=50000]
 * @param {number} [config.lookbackDays=80]
 * @returns {{ portfolio, dailySnapshots, metrics, strategy }}
 */
export async function runBacktest(config) {
    const { startDate, endDate, strategy, initialBalance = 50000, lookbackDays = 80 } = config;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Strategy: ${strategy.name}`);
    console.log(`Period: ${startDate} → ${endDate}`);
    console.log(`Initial Balance: $${initialBalance.toLocaleString()}`);
    console.log(`${'─'.repeat(60)}`);

    // Phase 1: Fetch all historical data upfront
    const dataManager = new DataManager();
    await dataManager.loadDateRange(startDate, endDate, lookbackDays);

    // Phase 2: Initialize portfolio
    const portfolio = createBacktestPortfolio(initialBalance, strategy.name);

    // Phase 3: Get trading days in simulation range
    const tradingDays = dataManager.getTradingDays(startDate, endDate);
    if (tradingDays.length === 0) {
        console.error('No trading days found in the specified range.');
        return { portfolio, dailySnapshots: [], metrics: computeResults(portfolio, [], initialBalance), strategy: strategy.name };
    }

    console.log(`Simulating ${tradingDays.length} trading days (${tradingDays[0]} → ${tradingDays[tradingDays.length - 1]})...\n`);

    const dailySnapshots = [];

    // Phase 4: Simulate each day
    for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
        const simDate = tradingDays[dayIdx];

        // 1. Get market state (windowed — no look-ahead bias)
        const { marketData, multiDayCache } = dataManager.getMarketState(simDate);

        // 2. Calculate sector rotation + enrich with all technicals
        const sectorRotation = detectSectorRotation(marketData, multiDayCache);
        const { enhanced, scored } = enrichMarketData(
            marketData, multiDayCache, {}, {}, sectorRotation, {}
        );

        // 3. Determine regime from VIX
        const vixLevel = dataManager.getVIX(simDate);
        const vixObj = vixLevel != null ? { level: vixLevel, changePercent: 0 } : null;

        // Try to compute VIX change from previous day
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

        // 4. EXIT PHASE — evaluate all holdings for sell signals
        const sellCount = processExits(portfolio, enhanced, regime, strategy, simDate);

        // 5. ENTRY PHASE — build candidate pool, evaluate entries
        const buyCount = processEntries(portfolio, enhanced, scored, sectorRotation, regime, strategy, simDate, vixLevel);

        // 6. Record daily snapshot
        let totalValue = portfolio.cash;
        for (const [sym, shares] of Object.entries(portfolio.holdings)) {
            totalValue += shares * (enhanced[sym]?.price || 0);
        }
        const spyPrice = enhanced['SPY']?.price || null;

        dailySnapshots.push({
            date: simDate,
            portfolioValue: totalValue,
            cash: portfolio.cash,
            holdingsCount: Object.keys(portfolio.holdings).length,
            regime,
            vix: vixLevel,
            spyPrice,
            buys: buyCount,
            sells: sellCount,
        });

        // Progress logging every 20 days
        if ((dayIdx + 1) % 20 === 0 || dayIdx === tradingDays.length - 1) {
            const ret = ((totalValue - initialBalance) / initialBalance * 100).toFixed(1);
            const holdings = Object.keys(portfolio.holdings).length;
            console.log(`  Day ${dayIdx + 1}/${tradingDays.length} (${simDate}): $${totalValue.toFixed(0)} (${ret}%), ${holdings} holdings, ${regime}`);
        }
    }

    // Phase 5: Force close all remaining positions at final prices
    const finalDate = tradingDays[tradingDays.length - 1];
    const { marketData: finalMarket } = dataManager.getMarketState(finalDate);
    const remainingSymbols = Object.keys(portfolio.holdings);
    if (remainingSymbols.length > 0) {
        console.log(`\nForce-closing ${remainingSymbols.length} remaining positions...`);
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

    // Phase 6: Compute metrics
    const metrics = computeResults(portfolio, dailySnapshots, initialBalance);

    return { portfolio, dailySnapshots, metrics, strategy: strategy.name };
}
