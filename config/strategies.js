// Strategy definitions — plain config objects, no AI calls
// Each strategy defines: conviction mapping, entry rules, exit rules, pool config

export const STRATEGIES = {
    baseline: {
        name: 'Baseline',
        description: 'Replicates APEX default behavior with deterministic score→conviction mapping',
        convictionMap: {
            tiers: [
                { minScore: 18, conviction: 10 },
                { minScore: 15, conviction: 9 },
                { minScore: 12, conviction: 8 },
                { minScore: 9, conviction: 7 },
                { minScore: 6, conviction: 6 },
            ],
            floor: 6,
        },
        entry: {
            maxHoldings: 12,
            maxSectorConcentration: 0.35,
            redFlagGate: true,        // RS < 30 AND momentum < 3 = skip
            volumeGate: null,
            maxBuysPerDay: 3,
        },
        exit: {
            stopLossTiers: [
                { threshold: -0.05, action: 'watch' },
                { threshold: -0.10, action: 'warning' },
                { threshold: -0.15, action: 'mandatory_sell' },
            ],
            scoreDegradation: {
                enabled: true,
                dropThreshold: 0.5, // sell if score drops below 50% of entry score
            },
            mechanicalTarget: null,
            holdDiscipline: {
                minHoldDays: 3,
                stopOverrideAt: -0.15,
            },
            rebuyCooldownDays: 5,
        },
        pool: {
            topN: 25,
            sectorWildcards: 5,
            reversalCandidates: 10,
            includeHoldings: true,
        },
    },

    earlyExit: {
        name: 'Early Exit (Strike thesis)',
        description: 'Standard entries, mechanical 55% profit target exit',
        convictionMap: {
            tiers: [
                { minScore: 18, conviction: 10 },
                { minScore: 15, conviction: 9 },
                { minScore: 12, conviction: 8 },
                { minScore: 9, conviction: 7 },
            ],
            floor: 7,
        },
        entry: {
            maxHoldings: 12,
            maxSectorConcentration: 0.35,
            redFlagGate: true,
            volumeGate: null,
            maxBuysPerDay: 3,
        },
        exit: {
            stopLossTiers: [
                { threshold: -0.05, action: 'watch' },
                { threshold: -0.10, action: 'warning' },
                { threshold: -0.15, action: 'mandatory_sell' },
            ],
            scoreDegradation: { enabled: false },
            mechanicalTarget: {
                targetPct: 0.55,       // exit at 55% of expected move
                method: 'atr_multiple',
                atrMultiple: 3,
            },
            holdDiscipline: {
                minHoldDays: 3,
                stopOverrideAt: -0.15,
            },
            rebuyCooldownDays: 5,
        },
        pool: {
            topN: 25,
            sectorWildcards: 5,
            reversalCandidates: 10,
            includeHoldings: true,
        },
    },

    volumeGated: {
        name: 'Volume Gated (Draft thesis)',
        description: 'Standard scoring + hard volume confirmation gate on entry',
        convictionMap: {
            tiers: [
                { minScore: 18, conviction: 10 },
                { minScore: 15, conviction: 9 },
                { minScore: 12, conviction: 8 },
                { minScore: 9, conviction: 7 },
            ],
            floor: 7,
        },
        entry: {
            maxHoldings: 12,
            maxSectorConcentration: 0.35,
            redFlagGate: true,
            volumeGate: {
                breakoutThreshold: 1.5,  // 1.5x ADV for breakouts (momentum >= 6)
                pullbackThreshold: 0.7,  // <0.7x ADV for pullbacks (momentum < 5)
            },
            maxBuysPerDay: 3,
        },
        exit: {
            stopLossTiers: [
                { threshold: -0.05, action: 'watch' },
                { threshold: -0.10, action: 'warning' },
                { threshold: -0.15, action: 'mandatory_sell' },
            ],
            scoreDegradation: {
                enabled: true,
                dropThreshold: 0.5,
            },
            mechanicalTarget: null,
            holdDiscipline: {
                minHoldDays: 3,
                stopOverrideAt: -0.15,
            },
            rebuyCooldownDays: 5,
        },
        pool: {
            topN: 25,
            sectorWildcards: 5,
            reversalCandidates: 10,
            includeHoldings: true,
        },
    },

    aggressive: {
        name: 'Aggressive',
        description: 'Lower conviction thresholds, more holdings, wider stops',
        convictionMap: {
            tiers: [
                { minScore: 16, conviction: 10 },
                { minScore: 13, conviction: 9 },
                { minScore: 10, conviction: 8 },
                { minScore: 7, conviction: 7 },
                { minScore: 4, conviction: 6 },
            ],
            floor: 6,
        },
        entry: {
            maxHoldings: 15,
            maxSectorConcentration: 0.50,
            redFlagGate: true,
            volumeGate: null,
            maxBuysPerDay: 5,
        },
        exit: {
            stopLossTiers: [
                { threshold: -0.10, action: 'warning' },
                { threshold: -0.20, action: 'mandatory_sell' },
            ],
            scoreDegradation: { enabled: false },
            mechanicalTarget: null,
            holdDiscipline: {
                minHoldDays: 3,
                stopOverrideAt: -0.20,
            },
            rebuyCooldownDays: 5,
        },
        pool: {
            topN: 25,
            sectorWildcards: 5,
            reversalCandidates: 10,
            includeHoldings: true,
        },
    },
};

export const STRATEGY_NAMES = Object.keys(STRATEGIES);
