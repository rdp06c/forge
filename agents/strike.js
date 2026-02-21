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
}
