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

        // Hard rule: structure must be bullish (structureScore >= 1)
        if (candidateData?.marketStructure?.structureScore < 1) {
            return false;
        }

        // Hard rule: sector must not be in outflow
        const sectorFlow = candidateData?.sectorRotation?.moneyFlow;
        if (sectorFlow === 'outflow' || sectorFlow === 'modest-outflow') {
            return false;
        }

        return true;
    }
}
