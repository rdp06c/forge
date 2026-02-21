// Alloy — The Setup Purist
// Full APEX, Bullish BOS only — all other setup types rejected
import { BaseAgent } from './base-agent.js';

export class AlloyAgent extends BaseAgent {
    filterCandidates(candidates, enhanced) {
        // Pre-filter: only pass candidates with Bullish BOS
        const filtered = {};
        for (const [sym, data] of Object.entries(candidates)) {
            const full = enhanced[sym];
            if (!full) continue;

            if (full.marketStructure?.bos && full.marketStructure?.bosType === 'bullish') {
                filtered[sym] = data;
            }
        }
        return filtered;
    }

    validateDecision(decision, candidateData) {
        if (decision.conviction < 7) return false;

        // Hard rule: must have Bullish BOS
        if (!candidateData?.marketStructure?.bos || candidateData?.marketStructure?.bosType !== 'bullish') {
            return false;
        }

        return true;
    }
}
