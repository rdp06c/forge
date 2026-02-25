// Flux — The Dip Buyer
// Buys meaningful pullbacks in structurally sound stocks showing stabilization
import { BaseAgent } from './base-agent.js';

export class FluxAgent extends BaseAgent {
    filterCandidates(candidates, enhanced) {
        // Only pass candidates with meaningful pullbacks (down 8-25% over 5d)
        const filtered = {};
        for (const [sym, data] of Object.entries(candidates)) {
            const full = enhanced[sym];
            if (!full) continue;

            const ret5d = full.momentum?.totalReturn5d ?? 0;

            // Must be down 8-25% over 5 days — meaningful pullback territory
            if (ret5d <= -8 && ret5d >= -25) {
                filtered[sym] = data;
            }
        }
        return filtered;
    }

    validateDecision(decision, candidateData) {
        if (decision.conviction < 7) return false;

        const ret5d = candidateData?.momentum?.totalReturn5d ?? 0;

        // Must be down 8-25% over 5 days
        if (ret5d > -8 || ret5d < -25) return false;

        // Must show stabilization — at least one of:
        // 1. Volume drying (sellers exhausting)
        // 2. Bullish CHoCH (reversal pattern forming)
        // 3. Low-swept (wick below support, closed above — liquidity taken, buyers stepped in)
        // 4. RSI oversold (< 30)
        const struct = candidateData?.marketStructure;
        const volumeTrend = candidateData?.momentum?.volumeTrend ?? 1;
        const hasStabilization = (
            volumeTrend < 0.7 ||
            (struct?.choch && struct?.chochType === 'bullish') ||
            struct?.sweep === 'low-swept' ||
            (candidateData?.rsi != null && candidateData.rsi < 30)
        );

        if (!hasStabilization) return false;

        // Must NOT have broken structure completely (bearish BOS = trend confirmed down)
        if (struct?.bos && struct?.bosType === 'bearish') return false;

        return true;
    }
}
