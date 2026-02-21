// Draft — The Volume Agent
// Full APEX + hard volume gate
import { BaseAgent } from './base-agent.js';

export class DraftAgent extends BaseAgent {
    validateDecision(decision, candidateData) {
        if (decision.conviction < 7) return false;

        // Hard volume gate
        const volumeTrend = candidateData?.momentum?.volumeTrend ?? 1;
        const structureScore = candidateData?.marketStructure?.structureScore ?? 0;
        const totalReturn5d = candidateData?.momentum?.totalReturn5d ?? 0;

        // Determine if this is a breakout or pullback setup
        const isBreakout = structureScore >= 2 || totalReturn5d > 2;
        const isPullback = totalReturn5d >= -8 && totalReturn5d <= -2 && structureScore >= 0;

        if (isBreakout) {
            // Breakout: need 1.5x ADV (volumeTrend > 1.5)
            if (volumeTrend < 1.5) {
                return false;
            }
        } else if (isPullback) {
            // Pullback: need volume drying (volumeTrend < 0.7)
            if (volumeTrend > 0.7) {
                return false;
            }
        } else {
            // Neither clear breakout nor pullback — still require some volume confirmation
            if (volumeTrend < 1.2) {
                return false;
            }
        }

        return true;
    }
}
