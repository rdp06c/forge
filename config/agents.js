// FORGE agent personality configs
// Each agent defines its thesis, behavioral rules, and framework modifications

export const AGENTS = {
    Ember: {
        name: 'Ember',
        fullName: 'Ember — The Patience Agent',
        thesis: 'Does extreme selectivity with a simplified decision model outperform APEX\'s complex multi-factor approach?',
        framework: '3-factor-only',
        description: 'Stripped-down 3-factor model: catalyst strength, technical structure, sector context. Ignores fundamentals as a primary signal. Only trades when all three factors align perfectly at 10/10 conviction.',
        rules: {
            minConviction: 10,
            requireAllFactorsAlign: true,
            factorsUsed: ['catalyst', 'structure', 'sector'],
            factorsIgnored: ['fundamentals'],
            fundamentalsNote: 'Noted but do not gate the trade',
            willSitFlat: true,
            noExceptions: true,
        },
        entryFramework: 'custom', // Does NOT use APEX 5-step chain
        exitFramework: 'apex',    // Uses APEX standard sell triggers
        promptModifier: 'ember',
    },

    Strike: {
        name: 'Strike',
        fullName: 'Strike — The Early Exit Agent',
        thesis: 'Is APEX\'s profit-taking framework leaving money on the table, or is his reluctance to exit early actually optimal?',
        framework: 'apex-entry-mechanical-exit',
        description: 'Full APEX entry framework (5-step chain, 7/10 minimum conviction). Mechanical exit: target 55% of expected move, then exit regardless of momentum. Stop-loss and catalyst failure triggers inherited unchanged.',
        rules: {
            minConviction: 7,
            exitTargetPercent: 0.55,  // 55% of expected move
            mechanicalExit: true,
            inheritApexStopLoss: true,
            inheritApexCatalystFailure: true,
            inheritHoldDiscipline: true,
        },
        entryFramework: 'apex',
        exitFramework: 'mechanical',
        promptModifier: 'strike',
    },

    Flux: {
        name: 'Flux',
        fullName: 'Flux — The Contrarian',
        thesis: 'Is there genuine edge in fading overextended moves, and does APEX\'s catalyst-first framework actively prevent him from seeing it?',
        framework: 'overextension-first',
        description: 'Inverts APEX entry logic. Uses overextension as primary signal. Enters fade positions when RS >85 + momentum 8+ AND structure shows early reversal signs (Bearish CHoCH, High-swept patterns). Does NOT use APEX 5-step chain.',
        rules: {
            minConviction: 7,
            requireExtendedTier: true,  // RS >85 + momentum 8+
            requireReversalSigns: true, // Bearish CHoCH or High-swept
            useTightStops: true,
            catalystNotRequired: true,
            ignoreSectorInflow: true,   // Overextended sector inflow is a Flux candidate
        },
        entryFramework: 'custom',
        exitFramework: 'tight-stop',
        promptModifier: 'flux',
    },

    Draft: {
        name: 'Draft',
        fullName: 'Draft — The Volume Agent',
        thesis: 'Should volume confirmation be a hard non-negotiable gate rather than the minor weighted factor (+/-0.5) it currently is in APEX?',
        framework: 'apex-plus-volume-gate',
        description: 'Full APEX 5-step framework with hard volume gate added as final pre-entry check. Volume confirmation: 1.5x average daily volume on breakouts; drying to <0.7x on pullbacks. If volume doesn\'t confirm, trade is vetoed.',
        rules: {
            minConviction: 7,
            volumeGate: true,
            breakoutVolumeThreshold: 1.5,   // 1.5x ADV
            pullbackVolumeThreshold: 0.7,    // <0.7x ADV
            volumeGateOnEntryOnly: true,
        },
        entryFramework: 'apex',
        exitFramework: 'apex',
        promptModifier: 'draft',
    },

    Alloy: {
        name: 'Alloy',
        fullName: 'Alloy — The Setup Purist',
        thesis: 'Does deep specialization in a single setup type produce a sharper edge than APEX\'s adaptive multi-setup approach?',
        framework: 'apex-bos-only',
        description: 'Full APEX 5-step framework applied exclusively to Bullish BOS (Break of Structure) setups — the highest-scoring pattern (+3). All other setup types are ignored regardless of quality.',
        rules: {
            minConviction: 7,
            allowedSetups: ['bullish-bos'],
            requireBullishBOS: true,
            setupLocked: true,  // No mid-cycle changes
        },
        entryFramework: 'apex',
        exitFramework: 'apex',
        promptModifier: 'alloy',
    },
};

export const AGENT_NAMES = Object.keys(AGENTS);
