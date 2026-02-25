// Flux — The Dip Buyer
// Buys meaningful pullbacks in structurally sound stocks showing stabilization
import { BaseAgent } from './base-agent.js';

export class FluxAgent extends BaseAgent {
    /**
     * Override candidate pool — scan full ~490 stock universe for dip candidates.
     * The standard composite-scored pool is structurally hostile to dip candidates
     * (decline penalties push them out of the top 25), so Flux sources its own.
     */
    buildCandidatePool(scored, portfolio, enhanced) {
        const pool = new Set();

        // Always include current holdings
        for (const sym of Object.keys(portfolio.holdings)) {
            if (enhanced[sym]) pool.add(sym);
        }

        // Scan full universe for stocks down 8-25% over 5 days
        const dipCandidates = [];
        for (const [sym, data] of Object.entries(enhanced)) {
            const ret5d = data.momentum?.totalReturn5d ?? 0;
            if (ret5d <= -8 && ret5d >= -25) {
                dipCandidates.push({ symbol: sym, ret5d, compositeScore: data.compositeScore ?? 0 });
            }
        }

        // Sort by composite score descending (best quality among dips first)
        dipCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

        for (const dc of dipCandidates.slice(0, 25)) {
            pool.add(dc.symbol);
        }

        console.log(`  [Flux] Dip scan: ${dipCandidates.length} stocks down 8-25% in 5d (taking top ${Math.min(dipCandidates.length, 25)})`);

        return pool;
    }

    filterCandidates(candidates, enhanced) {
        // Pool is already dip-sourced, but re-validate the 5d return
        // (holdings or edge cases may not meet the criteria)
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
