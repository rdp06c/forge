// Draft — The Volume Agent
// Full APEX + hard volume gate
import { BaseAgent } from './base-agent.js';

export class DraftAgent extends BaseAgent {
    validateDecision(decision, candidateData) {
        if (decision.conviction < 7) return false;

        // APEX Red Flag gate: RS < 30 AND momentum < 3 = skip
        const rs = candidateData?.relativeStrength?.rsScore ?? 50;
        const momentumScore = candidateData?.momentum?.score ?? 5;
        if (rs < 30 && momentumScore < 3) return false;

        // Hard volume gate
        const volumeTrend = candidateData?.momentum?.volumeTrend ?? 1;
        const structureScore = candidateData?.marketStructure?.structureScore ?? 0;
        const totalReturn5d = candidateData?.momentum?.totalReturn5d ?? 0;
        const todayChange = candidateData?.changePercent ?? 0;

        // Classify setup type using today's price action + trend context.
        // A stock down today within an uptrend is a pullback (needs drying volume),
        // NOT a breakout just because it has good structure.
        const isPullback = (todayChange < -1 && totalReturn5d > 0) ||
                           (totalReturn5d >= -8 && totalReturn5d <= -2);
        const isBreakout = !isPullback && (structureScore >= 2 || totalReturn5d > 2);

        if (isPullback) {
            // Pullback: need volume drying (volumeTrend < 0.7)
            if (volumeTrend > 0.7) {
                return false;
            }
        } else if (isBreakout) {
            // Breakout: need 1.5x ADV (volumeTrend > 1.5)
            if (volumeTrend < 1.5) {
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
