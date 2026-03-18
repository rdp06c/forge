// Signal-filtered candidate pool builder
// Replaces old top-N-by-composite-score approach
import { stockSectors, TOP_CANDIDATES } from '../config/constants.js';
import { meetsQuality } from '../data/signals.js';

/**
 * Build candidate pool filtered by signal match quality.
 *
 * For signal-based strategies: includes stocks where the specified signal fires at minimum quality.
 * For NOSIGNAL baseline: includes top N stocks by composite score (no signal filter).
 * Always includes current holdings (for exit evaluation).
 * Always excludes stocks where AVOID signal fires.
 *
 * @param {object} enhancedMarket - { symbol: enrichedData } with signals attached
 * @param {Array} scored - [{ symbol, compositeScore, data }] sorted desc by score
 * @param {object} strategy - strategy object from buildStrategy()
 * @param {object} portfolio - current portfolio state
 * @returns {Array} [{ symbol, compositeScore, data }] candidates
 */
export function buildSignalPool(enhancedMarket, scored, strategy, portfolio) {
    const pool = new Map();
    const signalCode = strategy.signal.code;
    const minQuality = strategy.signal.minQuality;

    if (signalCode === 'NOSIGNAL') {
        // Baseline: top N by composite score, no signal filtering
        for (let i = 0; i < Math.min(TOP_CANDIDATES, scored.length); i++) {
            const entry = scored[i];
            // Still exclude AVOID signals
            const signals = enhancedMarket[entry.symbol]?.signals;
            if (signals?.AVOID?.quality) continue;
            if (stockSectors[entry.symbol] === 'Index Fund') continue;
            pool.set(entry.symbol, entry);
        }
    } else {
        // Signal-based: filter by signal match quality
        for (const entry of scored) {
            const signals = enhancedMarket[entry.symbol]?.signals;
            if (!signals) continue;
            if (stockSectors[entry.symbol] === 'Index Fund') continue;

            // Block if AVOID signal fires
            if (signals.AVOID?.quality) continue;

            if (signalCode === 'ALL') {
                // ANY non-AVOID signal at minimum quality
                const hasSignal = ['REV', 'MOM', 'QMO', 'SQZ', 'LDR'].some(
                    sig => meetsQuality(signals[sig]?.quality, minQuality)
                );
                if (hasSignal) pool.set(entry.symbol, entry);
            } else {
                // Specific signal at minimum quality
                if (meetsQuality(signals[signalCode]?.quality, minQuality)) {
                    pool.set(entry.symbol, entry);
                }
            }
        }
    }

    // Always include current holdings (needed for exit evaluation)
    const holdingSymbols = Object.keys(portfolio.holdings || {});
    for (const sym of holdingSymbols) {
        if (!pool.has(sym)) {
            const entry = scored.find(s => s.symbol === sym);
            if (entry) pool.set(sym, entry);
        }
    }

    return [...pool.values()];
}
