// Deterministic entry logic for backtesting
import { stockSectors, REGIME_DEPLOYMENT } from '../config/constants.js';
import { buildCandidatePool } from './candidate-pool.js';
import { executeBuy, calculatePositionSize } from '../portfolio/manager.js';

/**
 * Map composite score to conviction level using strategy's tier definitions.
 * @param {number} compositeScore
 * @param {object} convictionMap - { tiers: [{ minScore, conviction }], floor }
 * @returns {number} conviction 6-10, or 0 if below floor
 */
export function scoreToConviction(compositeScore, convictionMap) {
    for (const tier of convictionMap.tiers) {
        if (compositeScore >= tier.minScore) {
            return tier.conviction;
        }
    }
    return 0;
}

/**
 * Process entry decisions for a simulated trading day.
 * Builds candidate pool, ranks by score, applies all entry gates.
 */
export function processEntries(portfolio, enhanced, scored, sectorRotation, regime, strategy, simDate, vix) {
    const candidates = buildCandidatePool(scored, portfolio, sectorRotation);

    // Sort candidates by composite score (highest first)
    candidates.sort((a, b) => b.compositeScore - a.compositeScore);

    const entryRules = strategy.entry;
    let buysThisDay = 0;
    const currentHoldings = Object.keys(portfolio.holdings).length;

    // Calculate current deployment
    let totalValue = portfolio.cash;
    for (const [sym, shares] of Object.entries(portfolio.holdings)) {
        totalValue += shares * (enhanced[sym]?.price || 0);
    }
    const currentDeployed = totalValue - portfolio.cash;
    const regimeDeploy = REGIME_DEPLOYMENT[regime] || REGIME_DEPLOYMENT.choppy;
    const maxDeployment = totalValue * ((regimeDeploy.min + regimeDeploy.max) / 2);

    for (const candidate of candidates) {
        const { symbol, compositeScore, data } = candidate;

        // Skip if already holding
        if (portfolio.holdings[symbol]) continue;

        // Max holdings check
        if (currentHoldings + buysThisDay >= entryRules.maxHoldings) break;

        // Max buys per day
        if (buysThisDay >= (entryRules.maxBuysPerDay || 3)) break;

        // Deployment cap check
        if (currentDeployed >= maxDeployment) break;

        // Skip index funds
        if (stockSectors[symbol] === 'Index Fund') continue;

        // Map score to conviction
        const conviction = scoreToConviction(compositeScore, strategy.convictionMap);
        if (conviction === 0) continue;

        // Red flag gate
        if (entryRules.redFlagGate) {
            const rs = data?.relativeStrength?.rsScore || 50;
            const momentum = data?.momentum?.score || 5;
            if (rs < 30 && momentum < 3) continue;
        }

        // Volume gate (Draft thesis)
        if (entryRules.volumeGate) {
            const vt = data?.momentum?.volumeTrend ?? 1;
            const momentumScore = data?.momentum?.score || 5;
            if (momentumScore >= 6) {
                // Breakout: need 1.5x+ ADV
                if (vt < entryRules.volumeGate.breakoutThreshold) continue;
            } else if (momentumScore < 5) {
                // Pullback: need <0.7x ADV (drying up)
                if (vt > entryRules.volumeGate.pullbackThreshold) continue;
            }
        }

        // Sector concentration check
        if (entryRules.maxSectorConcentration < 1.0) {
            const sector = stockSectors[symbol] || 'Unknown';
            let sectorValue = 0;
            for (const [s, shares] of Object.entries(portfolio.holdings)) {
                if ((stockSectors[s] || 'Unknown') === sector) {
                    sectorValue += shares * (enhanced[s]?.price || 0);
                }
            }
            if (totalValue > 0 && (sectorValue / totalValue) >= entryRules.maxSectorConcentration) continue;
        }

        // Calculate position size
        const price = data?.price;
        if (!price || price <= 0) continue;

        const shares = calculatePositionSize(portfolio, conviction, regime, price, enhanced);
        if (shares <= 0) continue;

        // Execute the buy
        const success = executeBuy(portfolio, {
            symbol, shares, price, conviction,
            reasoning: `Score: ${compositeScore.toFixed(1)}, conviction: ${conviction}`,
            marketData: enhanced,
            vix: vix ? { level: vix } : null,
            agentName: strategy.name || 'Backtester',
            simDate,
        });

        if (success) {
            buysThisDay++;

            // Store mechanical exit target for earlyExit strategy
            if (strategy.exit.mechanicalTarget && portfolio.holdingTheses?.[symbol]) {
                const target = calculateATRTarget(price, enhanced[symbol]?.bars || [], strategy.exit.mechanicalTarget);
                portfolio.holdingTheses[symbol].mechanicalExit = target;
                portfolio.holdingTheses[symbol].originalTarget = price + (target - price) / strategy.exit.mechanicalTarget.targetPct;
            }
        }
    }

    return buysThisDay;
}

/**
 * Calculate ATR-based price target for mechanical exit.
 */
function calculateATRTarget(entryPrice, bars, config) {
    const atrMultiple = config.atrMultiple || 3;
    const targetPct = config.targetPct || 0.55;

    if (!bars || bars.length < 15) {
        return entryPrice * (1 + 0.10 * targetPct); // fallback: 10% * 55%
    }

    const atrBars = bars.slice(-15);
    let atrSum = 0;
    for (let i = 1; i < atrBars.length; i++) {
        const tr = Math.max(
            atrBars[i].h - atrBars[i].l,
            Math.abs(atrBars[i].h - atrBars[i - 1].c),
            Math.abs(atrBars[i].l - atrBars[i - 1].c)
        );
        atrSum += tr;
    }
    const atr = atrSum / (atrBars.length - 1);
    const fullTarget = entryPrice + (atr * atrMultiple);
    return entryPrice + (fullTarget - entryPrice) * targetPct;
}
