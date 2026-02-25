// Strike — The Early Exit Agent
// Full APEX entry, mechanical 55% exit target
import { BaseAgent } from './base-agent.js';

export class StrikeAgent extends BaseAgent {
    validateDecision(decision, candidateData) {
        // Minimum conviction 7
        if (decision.conviction < 7) {
            return false;
        }

        return true;
    }

    /**
     * Enforce mechanical 55% exit targets.
     * If current price >= mechanicalExit stored in holdingTheses, force sell.
     */
    enforceExitRules(portfolio, enhanced, vix) {
        const forcedSells = [];
        for (const [symbol, shares] of Object.entries(portfolio.holdings)) {
            const thesis = portfolio.holdingTheses?.[symbol];
            if (!thesis?.mechanicalExit) continue;
            const price = enhanced[symbol]?.price;
            if (!price) continue;
            if (price >= thesis.mechanicalExit) {
                console.log(`  [${this.name}] Mechanical exit: ${symbol} @ $${price.toFixed(2)} >= target $${thesis.mechanicalExit.toFixed(2)}`);
                forcedSells.push({
                    symbol,
                    shares,
                    price,
                    reasoning: `Mechanical 55% exit triggered: price $${price.toFixed(2)} >= target $${thesis.mechanicalExit.toFixed(2)} (entry $${thesis.entryPrice?.toFixed(2)}, expected target $${thesis.expectedTarget?.toFixed(2)})`,
                    exitReason: 'profit_target',
                });
            }
        }
        return forcedSells;
    }
}
