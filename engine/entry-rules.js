// Signal-based entry logic for backtesting
// Entry triggered by signal quality, not composite score thresholds
import { stockSectors, REGIME_DEPLOYMENT } from '../config/constants.js';
import { buildSignalPool } from './candidate-pool.js';
import { executeBuy, calculatePositionSize } from '../portfolio/manager.js';
import { meetsQuality } from '../data/signals.js';
import { CONVICTION_MAP, NOSIGNAL_CONVICTION_MAP } from '../config/strategies.js';

/**
 * Derive conviction from signal quality + composite score.
 * Signal quality sets the base conviction, high composite score can bump it up.
 *
 * @param {string|null} signalQuality - 'full', 'strong', 'partial', or null
 * @param {number} compositeScore - composite score value
 * @param {boolean} isNoSignal - true for NOSIGNAL baseline strategy
 * @returns {number} conviction 6-10, or 0 if no entry
 */
export function deriveConviction(signalQuality, compositeScore, isNoSignal = false) {
    if (isNoSignal) {
        // NOSIGNAL baseline: old-style score → conviction mapping
        for (const tier of NOSIGNAL_CONVICTION_MAP.tiers) {
            if (compositeScore >= tier.minScore) return tier.conviction;
        }
        return 0;
    }

    if (!signalQuality) return 0;

    const mapping = CONVICTION_MAP[signalQuality];
    if (!mapping) return 0;

    let conviction = mapping.base;
    if (mapping.highScoreThreshold && compositeScore > mapping.highScoreThreshold) {
        conviction = mapping.highScoreConviction;
    }
    return conviction;
}

/**
 * Get the best matching signal code for a stock given a strategy
 * @returns {{ signalCode, quality }} or null
 */
function getBestSignalMatch(signals, strategy) {
    const signalCode = strategy.signal.code;
    const minQuality = strategy.signal.minQuality;

    if (signalCode === 'NOSIGNAL') return { signalCode: 'NOSIGNAL', quality: null };

    if (signalCode === 'ALL') {
        // Find the best matching non-AVOID signal
        let best = null;
        for (const sig of ['REV', 'MOM', 'QMO', 'SQZ', 'LDR']) {
            const q = signals[sig]?.quality;
            if (meetsQuality(q, minQuality)) {
                if (!best || signals[sig].matched > (signals[best.signalCode]?.matched || 0)) {
                    best = { signalCode: sig, quality: q };
                }
            }
        }
        return best;
    }

    const q = signals[signalCode]?.quality;
    if (meetsQuality(q, minQuality)) return { signalCode, quality: q };
    return null;
}

/**
 * Process entry decisions for a simulated trading day.
 * Builds signal-filtered candidate pool, derives conviction, applies gates.
 *
 * @returns {number} number of buys executed
 */
export function processEntries(portfolio, enhanced, scored, regime, strategy, simDate, vix) {
    const candidates = buildSignalPool(enhanced, scored, strategy, portfolio);

    // Sort by composite score (highest first) for prioritization
    candidates.sort((a, b) => b.compositeScore - a.compositeScore);

    const entryRules = strategy.entry;
    const isUnconstrained = !!entryRules.unconstrained;
    let buysThisDay = 0;
    const currentHoldings = Object.keys(portfolio.holdings).length;

    // Calculate current deployment (skip in unconstrained — infinite cash)
    let totalValue = portfolio.cash;
    let maxDeployment = Infinity;
    if (!isUnconstrained) {
        for (const [sym, shares] of Object.entries(portfolio.holdings)) {
            totalValue += shares * (enhanced[sym]?.price || 0);
        }
        const currentDeployed = totalValue - portfolio.cash;
        const deployLimits = REGIME_DEPLOYMENT[regime] || REGIME_DEPLOYMENT.choppy;
        maxDeployment = totalValue * ((deployLimits.min + deployLimits.max) / 2);
    }

    const isNoSignal = strategy.signal.code === 'NOSIGNAL';

    for (const candidate of candidates) {
        const { symbol, compositeScore, data } = candidate;

        // Skip if already holding (even in unconstrained — can't double up same symbol)
        if (portfolio.holdings[symbol]) continue;

        // Constrained checks (skipped in unconstrained)
        if (!isUnconstrained) {
            if (currentHoldings + buysThisDay >= entryRules.maxHoldings) break;
            if (buysThisDay >= (entryRules.maxBuysPerDay || 3)) break;
            const currentDeployed = totalValue - portfolio.cash;
            if (currentDeployed >= maxDeployment) break;
        }

        // Skip index funds
        if (stockSectors[symbol] === 'Index Fund') continue;

        // Get signal match for this stock
        const signals = enhanced[symbol]?.signals;
        const signalMatch = getBestSignalMatch(signals, strategy);
        if (!signalMatch && !isNoSignal) continue;

        // Derive conviction (used for constrained position sizing)
        const signalQuality = signalMatch?.quality || null;
        const conviction = deriveConviction(signalQuality, compositeScore, isNoSignal);
        if (conviction === 0 && !isUnconstrained) continue;

        // Red flag gate (skip in unconstrained — take every signal fire)
        if (!isUnconstrained) {
            const rs = data?.relativeStrength?.rsScore || 50;
            const momentum = data?.momentum?.score || 5;
            if (rs < 30 && momentum < 3) continue;
        }

        // Sector concentration check (skip in unconstrained)
        if (!isUnconstrained && entryRules.maxSectorConcentration < 1.0) {
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

        let shares;
        if (isUnconstrained) {
            // Fixed position size — every signal gets the same dollar amount
            shares = Math.floor(entryRules.fixedPositionSize / price);
        } else {
            shares = calculatePositionSize(portfolio, conviction, regime, price, enhanced);
        }
        if (shares <= 0) continue;

        // Execute the buy
        const success = executeBuy(portfolio, {
            symbol, shares, price,
            conviction: isUnconstrained ? 8 : conviction, // Fixed conviction in unconstrained
            reasoning: `Signal: ${signalMatch?.signalCode || 'NOSIGNAL'} (${signalQuality || 'score'}), Score: ${compositeScore.toFixed(1)}`,
            marketData: enhanced,
            vix: vix ? { level: vix } : null,
            agentName: strategy.name || 'Backtester',
            simDate,
            signalCode: signalMatch?.signalCode || 'NOSIGNAL',
            signalQuality: signalQuality,
        });

        if (success) buysThisDay++;
    }

    return buysThisDay;
}
