// Flux — The Contrarian
// Fades overextended moves — requires Extended tier + reversal signs
import { BaseAgent } from './base-agent.js';

export class FluxAgent extends BaseAgent {
    filterCandidates(candidates, enhanced) {
        // Only pass candidates that are in Extended tier
        const filtered = {};
        for (const [sym, data] of Object.entries(candidates)) {
            const full = enhanced[sym];
            if (!full) continue;

            const rs = full.relativeStrength?.rsScore || 0;
            const momentum = full.momentum?.score || 0;

            // Extended tier: RS >85 + momentum 8+
            if (rs > 85 && momentum >= 8) {
                filtered[sym] = data;
            }
        }
        return filtered;
    }

    validateDecision(decision, candidateData) {
        if (decision.conviction < 7) return false;

        const rs = candidateData?.relativeStrength?.rsScore || 0;
        const momentum = candidateData?.momentum?.score || 0;

        // Must be Extended tier
        if (rs <= 85 || momentum < 8) return false;

        // Must show reversal signs
        const struct = candidateData?.marketStructure;
        const hasReversalSign = (
            (struct?.choch && struct?.chochType === 'bearish') ||
            struct?.sweep === 'high-swept' ||
            (candidateData?.rsi && candidateData.rsi > 75) ||
            candidateData?.macd?.crossover === 'bearish'
        );

        if (!hasReversalSign) return false;

        return true;
    }
}
