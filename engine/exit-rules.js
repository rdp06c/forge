// Deterministic exit logic for backtesting
import { executeSell, getCurrentPositionBuys, countTradingDays } from '../portfolio/manager.js';

/**
 * Evaluate all holdings for exit signals and execute sells.
 * Called once per simulated day, BEFORE entry processing.
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

        // Hold discipline: don't sell before minHoldDays unless stop hit
        const minHold = exitConfig.holdDiscipline?.minHoldDays || 3;
        const stopOverride = exitConfig.holdDiscipline?.stopOverrideAt || -0.15;
        if (holdDays < minHold && returnPct > stopOverride) {
            continue;
        }

        let shouldSell = false;
        let exitReason = '';
        let reasoning = '';

        // 1. Stop-loss tiers
        for (const tier of (exitConfig.stopLossTiers || [])) {
            if (returnPct <= tier.threshold && tier.action === 'mandatory_sell') {
                shouldSell = true;
                exitReason = 'stop_loss';
                reasoning = `Stop-loss at ${(returnPct * 100).toFixed(1)}% (threshold: ${(tier.threshold * 100)}%)`;
                break;
            }
        }

        // 2. Mechanical target exit (Strike thesis)
        if (!shouldSell && exitConfig.mechanicalTarget && thesis.mechanicalExit) {
            if (currentPrice >= thesis.mechanicalExit) {
                shouldSell = true;
                exitReason = 'profit_target';
                reasoning = `Mechanical ${(exitConfig.mechanicalTarget.targetPct * 100).toFixed(0)}% exit: $${currentPrice.toFixed(2)} >= target $${thesis.mechanicalExit.toFixed(2)}`;
            }
        }

        // 3. Score degradation
        if (!shouldSell && exitConfig.scoreDegradation?.enabled) {
            const currentScore = enhanced[symbol]?.compositeScore ?? 0;
            const entryScore = thesis.entryCompositeScore ?? 0;
            const dropThreshold = exitConfig.scoreDegradation.dropThreshold || 0.5;

            if (entryScore > 0 && currentScore < entryScore * dropThreshold) {
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
