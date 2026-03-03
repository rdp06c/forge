// VIX-based regime determination — extracted from forge.js
// Returns 'bull', 'bear', or 'choppy'

/**
 * Centralized regime detection.
 * Uses VIX (level + direction), sector breadth, and market breadth.
 * @param {{ level: number, changePercent?: number }} vix
 * @param {object} sectorRotation - sector → { rotationSignal }
 * @param {object} marketData - symbol → { changePercent }
 * @returns {{ regime: string, bullSignals: number, bearSignals: number, signals: string[] }}
 */
export function determineRegime(vix, sectorRotation, marketData) {
    let bearSignals = 0;
    let bullSignals = 0;
    const signals = [];

    // 1. VIX level
    if (vix) {
        if (vix.level > 30) { bearSignals += 2; signals.push(`VIX ${vix.level.toFixed(1)} > 30 (panic)`); }
        else if (vix.level > 25) { bearSignals += 1; signals.push(`VIX ${vix.level.toFixed(1)} > 25 (elevated)`); }
        else if (vix.level < 15) { bullSignals += 1; signals.push(`VIX ${vix.level.toFixed(1)} < 15 (complacent)`); }

        // VIX direction
        const changePct = vix.changePercent || 0;
        if (changePct > 10) { bearSignals += 1.5; signals.push(`VIX spiking +${changePct.toFixed(1)}%`); }
        else if (changePct > 5) { bearSignals += 0.5; signals.push(`VIX rising +${changePct.toFixed(1)}%`); }
        else if (changePct < -10) { bullSignals += 1; signals.push(`VIX dropping ${changePct.toFixed(1)}%`); }
        else if (changePct < -5) { bullSignals += 0.5; signals.push(`VIX falling ${changePct.toFixed(1)}%`); }
    }

    // 2. Sector breadth
    if (sectorRotation) {
        const sectors = Object.values(sectorRotation);
        const total = sectors.length;
        if (total > 0) {
            const outflowCount = sectors.filter(s => s.rotationSignal === 'avoid').length;
            const inflowCount = sectors.filter(s => s.rotationSignal === 'accumulate' || s.rotationSignal === 'favorable').length;

            if (outflowCount >= total * 0.5) { bearSignals += 1; signals.push(`${outflowCount}/${total} sectors outflow`); }
            else if (outflowCount >= total * 0.3) { bearSignals += 0.5; signals.push(`${outflowCount}/${total} sectors outflow`); }

            if (inflowCount >= total * 0.5) { bullSignals += 1; signals.push(`${inflowCount}/${total} sectors inflow`); }
            else if (inflowCount >= total * 0.3) { bullSignals += 0.5; signals.push(`${inflowCount}/${total} sectors inflow`); }
        }
    }

    // 3. Market breadth — % of stocks up today
    if (marketData) {
        const stocks = Object.values(marketData);
        const total = stocks.length;
        if (total > 0) {
            const upCount = stocks.filter(s => (s.changePercent || 0) > 0).length;
            const upPct = upCount / total;
            if (upPct < 0.3) { bearSignals += 1; signals.push(`Only ${(upPct * 100).toFixed(0)}% stocks up`); }
            else if (upPct < 0.4) { bearSignals += 0.5; signals.push(`Only ${(upPct * 100).toFixed(0)}% stocks up`); }
            else if (upPct > 0.7) { bullSignals += 1; signals.push(`${(upPct * 100).toFixed(0)}% stocks up`); }
            else if (upPct > 0.6) { bullSignals += 0.5; signals.push(`${(upPct * 100).toFixed(0)}% stocks up`); }
        }
    }

    // Decision — require clear signal for bull/bear, default to choppy
    let regime;
    if (bearSignals >= 2) regime = 'bear';
    else if (bullSignals >= 2 && bearSignals < 0.5) regime = 'bull';
    else regime = 'choppy';

    return { regime, bullSignals, bearSignals, signals };
}
