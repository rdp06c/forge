// Signal x Exit strategy definitions for FORGE v3.0
// Strategies are defined as combinations of entry signal + exit strategy + weight set

// ═══════════════════════════════════════════════════
// Signal Configs — which signal triggers entry
// ═══════════════════════════════════════════════════

export const SIGNAL_CONFIGS = {
    REV:      { name: 'Reversal',              code: 'REV',      minQuality: 'partial' },
    MOM:      { name: 'Momentum Cont',         code: 'MOM',      minQuality: 'strong'  },
    QMO:      { name: 'Quiet Momentum',        code: 'QMO',      minQuality: 'strong'  },
    SQZ:      { name: 'Squeeze',               code: 'SQZ',      minQuality: 'strong'  },
    LDR:      { name: 'Sector Leader',         code: 'LDR',      minQuality: 'strong'  },
    ALL:      { name: 'Any Signal',            code: 'ALL',      minQuality: 'partial' },
    NOSIGNAL: { name: 'No Signal (Baseline)',  code: 'NOSIGNAL', minQuality: null      },
};

// ═══════════════════════════════════════════════════
// Exit Configs — how positions are closed
// ═══════════════════════════════════════════════════

export const EXIT_CONFIGS = {
    // Fixed stops only (no target)
    stop5:    { name: 'Stop -5%',   stop: -0.05, target: null, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    stop8:    { name: 'Stop -8%',   stop: -0.08, target: null, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    stop10:   { name: 'Stop -10%',  stop: -0.10, target: null, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    stop15:   { name: 'Stop -15%',  stop: -0.15, target: null, trailing: null, timeBased: null, degradation: null, holdMin: 3 },

    // Fixed targets with -10% stop
    target10: { name: 'Target +10%', stop: -0.10, target: 0.10, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    target15: { name: 'Target +15%', stop: -0.10, target: 0.15, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    target20: { name: 'Target +20%', stop: -0.10, target: 0.20, trailing: null, timeBased: null, degradation: null, holdMin: 3 },
    target30: { name: 'Target +30%', stop: -0.15, target: 0.30, trailing: null, timeBased: null, degradation: null, holdMin: 3 },

    // Time-based exits with -10% stop
    time5:    { name: '5-day exit',   stop: -0.10, target: null, trailing: null, timeBased: 5,  degradation: null, holdMin: 3 },
    time8:    { name: '8-day exit',   stop: -0.10, target: null, trailing: null, timeBased: 8,  degradation: null, holdMin: 3 },
    time10:   { name: '10-day exit',  stop: -0.10, target: null, trailing: null, timeBased: 10, degradation: null, holdMin: 3 },
    time15:   { name: '15-day exit',  stop: -0.10, target: null, trailing: null, timeBased: 15, degradation: null, holdMin: 3 },
    time20:   { name: '20-day exit',  stop: -0.10, target: null, trailing: null, timeBased: 20, degradation: null, holdMin: 3 },

    // Score degradation exits
    degrade50: { name: 'Score -50%', stop: -0.10, target: null, trailing: null, timeBased: null, degradation: 0.50, holdMin: 3 },
    degrade35: { name: 'Score -65%', stop: -0.10, target: null, trailing: null, timeBased: null, degradation: 0.35, holdMin: 5 },

    // Trailing stops with -10% initial stop
    trail5:    { name: 'Trail 5%',   stop: -0.10, target: null, trailing: 0.05, timeBased: null, degradation: null, holdMin: 3 },
    trail8:    { name: 'Trail 8%',   stop: -0.10, target: null, trailing: 0.08, timeBased: null, degradation: null, holdMin: 3 },
    trail10:   { name: 'Trail 10%',  stop: -0.10, target: null, trailing: 0.10, timeBased: null, degradation: null, holdMin: 3 },
    trailATR:  { name: 'Trail 2xATR', stop: -0.10, target: null, trailing: 'atr2x', timeBased: null, degradation: null, holdMin: 3 },

    // Combination strategies
    target15_trail8:  { name: '+15% or Trail 8%',  stop: -0.10, target: 0.15, trailing: 0.08, timeBased: null, degradation: null, holdMin: 3 },
    target20_trail10: { name: '+20% or Trail 10%', stop: -0.10, target: 0.20, trailing: 0.10, timeBased: null, degradation: null, holdMin: 5 },
    time10_trail8:    { name: '10d or Trail 8%',   stop: -0.10, target: null, trailing: 0.08, timeBased: 10, degradation: null, holdMin: 3 },
};

// ═══════════════════════════════════════════════════
// Shared entry rules (constant across all strategies)
// ═══════════════════════════════════════════════════

export const ENTRY_RULES = {
    maxHoldings: 100,           // Capital is the real constraint, not an arbitrary cap
    maxSectorConcentration: 0.50,
    maxBuysPerDay: 10,
    rebuyCooldownDays: 5,
};

// Unconstrained entry rules — pure signal accuracy testing
// No portfolio limits, fixed position size, every signal fire gets taken
export const UNCONSTRAINED_ENTRY_RULES = {
    maxHoldings: Infinity,
    maxSectorConcentration: 1.0,
    maxBuysPerDay: Infinity,
    rebuyCooldownDays: 0,
    unconstrained: true,
    fixedPositionSize: 5000, // $5K per position regardless of conviction
};

// ═══════════════════════════════════════════════════
// Conviction derivation from signal quality
// ═══════════════════════════════════════════════════

export const CONVICTION_MAP = {
    full:    { base: 9, highScoreThreshold: 15, highScoreConviction: 10 },
    strong:  { base: 8, highScoreThreshold: 15, highScoreConviction: 9 },
    partial: { base: 7, highScoreThreshold: null, highScoreConviction: null },
};

// For NOSIGNAL baseline: map composite score to conviction (like old FORGE)
export const NOSIGNAL_CONVICTION_MAP = {
    tiers: [
        { minScore: 18, conviction: 10 },
        { minScore: 15, conviction: 9 },
        { minScore: 12, conviction: 8 },
        { minScore: 9, conviction: 7 },
        { minScore: 6, conviction: 6 },
    ],
    floor: 6
};

// ═══════════════════════════════════════════════════
// Named presets for quick CLI access
// ═══════════════════════════════════════════════════

export const PRESETS = {
    'rev-baseline':    { signal: 'REV', exit: 'target15',       weights: 'calibrated' },
    'rev-tight-stop':  { signal: 'REV', exit: 'stop8',          weights: 'calibrated' },
    'rev-trailing':    { signal: 'REV', exit: 'trail8',         weights: 'calibrated' },
    'rev-time10':      { signal: 'REV', exit: 'time10',         weights: 'calibrated' },
    'mom-baseline':    { signal: 'MOM', exit: 'target15',       weights: 'calibrated' },
    'ldr-trailing':    { signal: 'LDR', exit: 'trail8',         weights: 'calibrated' },
    'all-trailing':    { signal: 'ALL', exit: 'trail8',         weights: 'calibrated' },
    'nosignal':        { signal: 'NOSIGNAL', exit: 'target15',  weights: 'calibrated' },
};

// ═══════════════════════════════════════════════════
// Strategy builder
// ═══════════════════════════════════════════════════

/**
 * Build a complete strategy object from signal + exit + weights
 */
/**
 * Build a complete strategy object from signal + exit + weights
 * @param {boolean} [unconstrained=false] — if true, use unconstrained entry rules (pure signal testing)
 */
export function buildStrategy(signalCode, exitCode, weightsName = 'calibrated', unconstrained = false) {
    const signal = SIGNAL_CONFIGS[signalCode];
    const exit = EXIT_CONFIGS[exitCode];
    if (!signal) throw new Error(`Unknown signal: ${signalCode}`);
    if (!exit) throw new Error(`Unknown exit: ${exitCode}`);

    const suffix = unconstrained ? '_unc' : '';
    return {
        name: `${signalCode}_${exitCode}_${weightsName}${suffix}`,
        displayName: `${signal.name} / ${exit.name} (${weightsName}${unconstrained ? ', unconstrained' : ''})`,
        signal: { ...signal },
        exit: { ...exit },
        weightsName,
        entry: unconstrained ? { ...UNCONSTRAINED_ENTRY_RULES } : { ...ENTRY_RULES },
    };
}

/**
 * Generate strategy matrix — all combinations of signals x exits x weights
 */
export function generateMatrix(opts = {}) {
    const signalCodes = opts.signals || Object.keys(SIGNAL_CONFIGS);
    const exitCodes = opts.exits || Object.keys(EXIT_CONFIGS);
    const weightSets = opts.weights || ['calibrated', 'default'];
    const unconstrained = opts.unconstrained || false;

    const strategies = [];
    for (const sig of signalCodes) {
        for (const exit of exitCodes) {
            for (const w of weightSets) {
                strategies.push(buildStrategy(sig, exit, w, unconstrained));
            }
        }
    }
    return strategies;
}

/**
 * Get list of all signal codes
 */
export function getSignalCodes() {
    return Object.keys(SIGNAL_CONFIGS);
}

/**
 * Get list of all exit codes
 */
export function getExitCodes() {
    return Object.keys(EXIT_CONFIGS);
}
