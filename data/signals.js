// Entry signal pattern evaluators — ported from APEX src/trader.js
// Each signal tests 3-4 criteria and classifies as full/strong/partial/null

// Signal quality levels
export const SIGNAL_QUALITY = { FULL: 'full', STRONG: 'strong', PARTIAL: 'partial', NONE: null };

// Quality ordering for comparisons
const QUALITY_RANK = { full: 3, strong: 2, partial: 1 };

/**
 * Check if a quality level meets or exceeds a minimum threshold
 * @param {string|null} quality - actual quality
 * @param {string} minQuality - minimum required ('full', 'strong', 'partial')
 * @returns {boolean}
 */
export function meetsQuality(quality, minQuality) {
    if (!quality || !minQuality) return false;
    return (QUALITY_RANK[quality] || 0) >= (QUALITY_RANK[minQuality] || 0);
}

/**
 * Check if sector flow indicates inflow
 */
function isInflow(flow) {
    return flow === 'inflow' || flow === 'accumulate' || flow === 'favorable' || flow === 'modest-inflow';
}

// ═══════════════════════════════════════════════════
// Signal pattern definitions — data-driven
// ═══════════════════════════════════════════════════

const ENTRY_SIGNAL_PATTERNS = [
    {
        id: 'REV',
        label: 'Reversal Entry',
        badge: 'REV',
        criteria: [
            { id: 'macd', label: 'MACD Bull/Hist≤0', test: c => {
                if (c.macdCrossover === 'bullish') return true;
                // In bear/choppy, require actual crossover — histogram<=0 is default state
                const r = c._regime || 'choppy';
                if (r === 'bearish' || r === 'choppy') return false;
                return c.macdHistogram != null && c.macdHistogram <= 0;
            } },
            { id: 'rsi', label: 'RSI<40', test: c => c.rsi != null && c.rsi < 40 },
            { id: 'structure', label: 'Bull Structure', test: c => c.structure === 'bullish' || c.structure === 'bullish_continuation' },
            { id: 'pullback', label: 'Pullback', test: c => c.return5d != null && c.return5d >= -8 && c.return5d <= -2 }
        ],
        // Earnings gate skipped in backtester — historical earnings dates not available
        gate: [],
        minMatch: 2,
        requireAny: ['rsi', 'pullback']
    },
    {
        id: 'MOM',
        label: 'Momentum Continuation',
        badge: 'MOM',
        criteria: [
            { id: 'momentum', label: 'Mom 5-8', test: c => (c.momentum ?? 0) >= 5 && (c.momentum ?? 0) <= 8 },
            { id: 'rsi', label: 'RSI<50', test: c => c.rsi != null && c.rsi < 50 },
            { id: 'structure', label: 'Bull Structure', test: c => c.structure === 'bullish' || c.structure === 'bullish_continuation' },
            { id: 'rs', label: 'RS>50', test: c => (c.rs ?? 0) > 50 }
        ],
        gate: [],
        minMatch: 3,
        requireAny: ['structure', 'momentum']
    },
    {
        id: 'QMO',
        label: 'Quiet Momentum',
        badge: 'QMO',
        criteria: [
            { id: 'vol_low', label: 'Vol<0.5x', test: c => c.volumeRatio != null && c.volumeRatio < 0.5 },
            { id: 'momentum', label: 'Mom 7+', test: c => (c.momentum ?? 0) >= 7 },
            { id: 'structure', label: 'Bull Structure', test: c => c.structure === 'bullish' || c.structure === 'bullish_continuation' },
            { id: 'not_overbought', label: 'RSI<70', test: c => c.rsi == null || c.rsi < 70 }
        ],
        gate: [],
        minMatch: 3,
        requireAny: ['vol_low', 'momentum']
    },
    {
        id: 'SQZ',
        label: 'Squeeze Setup',
        badge: 'SQZ',
        criteria: [
            { id: 'dtc', label: 'DTC>5', test: c => (c.daysToCover ?? 0) > 5 },
            { id: 'structure', label: 'Bull Structure', test: c => c.structure === 'bullish' || c.structure === 'bullish_continuation' },
            { id: 'sector', label: 'Sector Inflow', test: c => isInflow(c.sectorFlow) }
        ],
        gate: [],
        minMatch: 2,
        requireAny: ['dtc', 'structure']
    },
    {
        id: 'LDR',
        label: 'Sector Leader',
        badge: 'LDR',
        criteria: [
            { id: 'rs', label: 'RS>60', test: c => (c.rs ?? 0) > 60 },
            { id: 'sector', label: 'Sector Inflow', test: c => isInflow(c.sectorFlow) },
            { id: 'structure', label: 'Bull Structure', test: c => c.structure === 'bullish' || c.structure === 'bullish_continuation' }
        ],
        gate: [],
        minMatch: 2,
        requireAny: ['rs', 'sector']
    },
    {
        id: 'AVOID',
        label: 'Exhausted Runner',
        badge: 'AVOID',
        antiPattern: true,
        criteria: [
            { id: 'rsi_high', label: 'RSI>70', test: c => c.rsi != null && c.rsi > 70 },
            { id: 'runner', label: 'Day +5%', test: c => (c.dayChange ?? c.todayChange ?? 0) >= 5 },
            { id: 'mom_high', label: 'Mom 9+', test: c => (c.momentum ?? 0) >= 9 },
            { id: 'vol_decline', label: 'Vol Declining', test: c => (c.volumeRatio ?? 1) < 0.85 }
        ],
        gate: [],
        minMatch: 2,
        requireAny: ['rsi_high', 'runner', 'mom_high']
    }
];

/**
 * Evaluate a single signal pattern against a candidate
 * @param {object} pattern - signal pattern definition
 * @param {object} candidate - enriched stock data, normalized to flat fields
 * @returns {{ id, badge, quality, matched, total, criteria, gatePass }}
 */
function evaluatePattern(pattern, candidate) {
    const criteriaResults = {};
    let matchCount = 0;
    for (const crit of pattern.criteria) {
        const passed = crit.test(candidate);
        criteriaResults[crit.id] = passed;
        if (passed) matchCount++;
    }

    // Check gate criteria
    let gatePass = true;
    const gateResults = {};
    if (pattern.gate) {
        for (const g of pattern.gate) {
            const passed = g.test(candidate);
            gateResults[g.id] = passed;
            if (!passed) gatePass = false;
        }
    }

    const total = pattern.criteria.length;
    let quality = null;
    if (gatePass) {
        if (matchCount === total) {
            quality = 'full';
        } else if (matchCount >= total - 1) {
            quality = 'strong';
        } else if (matchCount >= pattern.minMatch) {
            const hasRequired = pattern.requireAny.some(id => criteriaResults[id]);
            if (hasRequired) quality = 'partial';
        }
    }

    return {
        id: pattern.id,
        badge: pattern.badge,
        quality,
        matched: matchCount,
        total,
        criteria: criteriaResults,
        gatePass,
        antiPattern: !!pattern.antiPattern
    };
}

/**
 * Normalize enriched market data into a flat candidate object for signal evaluation
 * @param {object} enriched - enriched stock data from scoring.js
 * @param {string} regime - current market regime ('bull', 'bear', 'choppy')
 * @returns {object} flat candidate for signal pattern tests
 */
export function toSignalCandidate(enriched, regime) {
    return {
        macdCrossover: enriched.macd?.crossover ?? 'none',
        macdHistogram: enriched.macd?.histogram ?? null,
        rsi: enriched.rsi ?? null,
        structure: enriched.marketStructure?.structure ?? 'unknown',
        return5d: enriched.momentum?.totalReturn5d ?? null,
        momentum: enriched.momentum?.score ?? 0,
        rs: enriched.relativeStrength?.rsScore ?? 50,
        volumeRatio: enriched.momentum?.volumeTrend ?? 1,
        dayChange: enriched.momentum?.todayChange ?? enriched.changePercent ?? 0,
        todayChange: enriched.momentum?.todayChange ?? enriched.changePercent ?? 0,
        sectorFlow: enriched.sectorRotation?.moneyFlow ?? 'neutral',
        daysToCover: enriched.shortInterest?.daysToCover ?? 0,
        _regime: regime || 'choppy',
    };
}

/**
 * Evaluate all 6 signal patterns for a single stock
 * @param {object} candidate - flat candidate from toSignalCandidate()
 * @returns {{ REV, MOM, QMO, SQZ, LDR, AVOID, bestSignal, bestQuality, antiPattern }}
 */
export function evaluateAllSignals(candidate) {
    const results = {};
    let bestSignal = null;
    let bestQuality = null;
    let bestMatchCount = 0;
    let antiPattern = null;

    for (const pattern of ENTRY_SIGNAL_PATTERNS) {
        const result = evaluatePattern(pattern, candidate);
        results[pattern.id] = result;

        if (result.antiPattern && result.quality) {
            antiPattern = result;
        } else if (result.quality && result.matched > bestMatchCount) {
            bestMatchCount = result.matched;
            bestQuality = result.quality;
            bestSignal = result.id;
        }
    }

    return {
        ...results,
        bestSignal,
        bestQuality,
        antiPattern
    };
}

/**
 * Evaluate all signals for entire market
 * @param {object} enhancedMarket - { symbol: enrichedData } from scoring.js
 * @param {string} regime - current market regime
 * @returns {object} { symbol: signalResults }
 */
export function evaluateMarketSignals(enhancedMarket, regime) {
    const results = {};
    for (const [symbol, data] of Object.entries(enhancedMarket)) {
        const candidate = toSignalCandidate(data, regime);
        results[symbol] = evaluateAllSignals(candidate);
    }
    return results;
}

// Export pattern definitions for testing
export { ENTRY_SIGNAL_PATTERNS };
