// Ember — The Patience Agent
// 3-factor only (catalyst, structure, sector), conviction 10 or pass
import { BaseAgent } from './base-agent.js';

export class EmberAgent extends BaseAgent {
    filterCandidates(candidates, enhanced) {
        // Ember is extremely selective — pass all candidates to Claude
        // but let validateDecision enforce the hard rules
        return candidates;
    }

    validateDecision(decision, candidateData) {
        // Hard rule: conviction must be exactly 10
        if (decision.conviction < 10) {
            return false;
        }

        // Hard rule: RSI not overbought (stated in Ember's prompt Factor 2)
        if (candidateData?.rsi >= 75) {
            return false;
        }

        // Hard rule: structure must be strong bullish (BOS +3 or CHoCH +2 level)
        if ((candidateData?.marketStructure?.structureScore ?? 0) < 2) {
            return false;
        }

        // Hard rule: sector must be in inflow (perfect alignment, not just absence of headwind)
        const sectorFlow = candidateData?.sectorRotation?.moneyFlow;
        if (sectorFlow !== 'inflow') {
            return false;
        }

        return true;
    }
}
