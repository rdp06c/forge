// Configurable multi-strategy exit logic for backtesting
// Supports: fixed stops, fixed targets, trailing stops, time-based, score degradation, combos
import { executeSell, getCurrentPositionBuys, countTradingDays } from '../portfolio/manager.js';

/**
 * Evaluate all holdings for exit signals and execute sells.
 * Called once per simulated day, BEFORE entry processing.
 *
 * Exit evaluation order (first match wins):
 * 1. Hard stop — returnPct <= exitConfig.stop
 * 2. Profit target — returnPct >= exitConfig.target
 * 3. Trailing stop — price dropped trailing% below high-water mark
 * 4. Time-based — holdDays >= exitConfig.timeBased
 * 5. Score degradation — currentScore < entryScore * exitConfig.degradation
 *
 * @param {object} portfolio - current portfolio state
 * @param {object} enhanced - enriched market data
 * @param {string} regime - current regime
 * @param {object} strategy - strategy object with exit config
 * @param {string} simDate - YYYY-MM-DD
 * @returns {number} number of sells executed
 */
export function processExits(portfolio, enhanced, regime, strategy, simDate) {
    const exitConfig = strategy.exit;
    const holdingSymbols = Object.keys(portfolio.holdings);
    let sellCount = 0;

    for (const symbol of holdingSymbols) {
        const shares = portfolio.holdings[symbol];
        if (!shares) continue;

        const thesis = portfolio.holdingTheses?.[symbol];
        if (!thesis) continue;

        const currentPrice = enhanced[symbol]?.price;
        if (!currentPrice) continue;

        const entryPrice = thesis.entryPrice;
        if (!entryPrice) continue;

        const returnPct = (currentPrice - entryPrice) / entryPrice;
        const buys = getCurrentPositionBuys(portfolio, symbol);
        const holdDays = buys.length > 0
            ? countTradingDays(new Date(buys[0].timestamp), new Date(simDate + 'T16:00:00Z'))
            : 0;

        // Update high-water mark for trailing stops
        if (!thesis.highWaterMark || currentPrice > thesis.highWaterMark) {
            thesis.highWaterMark = currentPrice;
        }

        // Hold discipline: don't sell before holdMin unless extreme stop hit
        const minHold = exitConfig.holdMin || 3;
        const extremeStop = -0.15; // Always allow exit at -15% regardless of hold time
        if (holdDays < minHold && returnPct > extremeStop) {
            continue;
        }

        let shouldSell = false;
        let exitReason = '';
        let reasoning = '';

        // 1. Hard stop
        if (exitConfig.stop != null && returnPct <= exitConfig.stop) {
            shouldSell = true;
            exitReason = 'stop_loss';
            reasoning = `Stop-loss at ${(returnPct * 100).toFixed(1)}% (threshold: ${(exitConfig.stop * 100).toFixed(0)}%)`;
        }

        // 2. Profit target
        if (!shouldSell && exitConfig.target != null && returnPct >= exitConfig.target) {
            shouldSell = true;
            exitReason = 'profit_target';
            reasoning = `Target hit at ${(returnPct * 100).toFixed(1)}% (target: +${(exitConfig.target * 100).toFixed(0)}%)`;
        }

        // 3. Trailing stop
        if (!shouldSell && exitConfig.trailing != null && thesis.highWaterMark) {
            let trailPct;
            if (exitConfig.trailing === 'atr2x') {
                // ATR-based trailing: 2x ATR as trail distance
                const atr = enhanced[symbol]?.atr;
                trailPct = atr && thesis.highWaterMark > 0
                    ? (atr * 2) / thesis.highWaterMark
                    : 0.10; // Fallback to 10% if ATR unavailable
            } else {
                trailPct = exitConfig.trailing;
            }

            const trailPrice = thesis.highWaterMark * (1 - trailPct);
            if (currentPrice <= trailPrice) {
                shouldSell = true;
                exitReason = 'trailing_stop';
                const fromHWM = ((currentPrice - thesis.highWaterMark) / thesis.highWaterMark * 100).toFixed(1);
                reasoning = `Trailing stop: ${fromHWM}% from HWM $${thesis.highWaterMark.toFixed(2)} (trail: ${(trailPct * 100).toFixed(1)}%)`;
            }
        }

        // 4. Time-based exit
        if (!shouldSell && exitConfig.timeBased != null && holdDays >= exitConfig.timeBased) {
            shouldSell = true;
            exitReason = 'time_exit';
            reasoning = `Time exit after ${holdDays} days (limit: ${exitConfig.timeBased})`;
        }

        // 5. Score degradation
        if (!shouldSell && exitConfig.degradation != null) {
            const currentScore = enhanced[symbol]?.compositeScore ?? 0;
            const entryScore = thesis.entryCompositeScore ?? 0;
            if (entryScore > 0 && currentScore < entryScore * exitConfig.degradation) {
                shouldSell = true;
                exitReason = 'score_degradation';
                reasoning = `Score degraded: ${currentScore.toFixed(1)} vs entry ${entryScore.toFixed(1)} (${((currentScore / entryScore) * 100).toFixed(0)}%)`;
            }
        }

        if (shouldSell) {
            const success = executeSell(portfolio, {
                symbol, shares, price: currentPrice,
                conviction: null,
                reasoning,
                exitReason,
                marketData: enhanced,
                vix: null,
                agentName: strategy.name || 'Backtester',
                simDate,
            });
            if (success) sellCount++;
        }
    }

    return sellCount;
}
