// APEX candidate pool builder — replicates APEX's exact pool logic
import { stockSectors, TOP_CANDIDATES, SECTOR_WILDCARDS, REVERSAL_CANDIDATES } from '../config/constants.js';

/**
 * Build the candidate pool using APEX's exact logic:
 * - Top N by composite score
 * - Always include current holdings
 * - Sector wildcards (best from underrepresented sectors)
 * - Reversal candidates (bullish CHoCH, low-swept, bullish BOS + low momentum)
 *
 * @param {Array} scored - [{ symbol, compositeScore, data }] sorted desc by score
 * @param {object} portfolio - current portfolio state
 * @param {object} sectorRotation - sector → { moneyFlow }
 * @returns {Array} - [{ symbol, compositeScore, data }] deduplicated candidates
 */
export function buildCandidatePool(scored, portfolio, sectorRotation) {
    const pool = new Map();

    // 1. Top N by composite score
    for (let i = 0; i < Math.min(TOP_CANDIDATES, scored.length); i++) {
        pool.set(scored[i].symbol, scored[i]);
    }

    // 2. Always include current holdings
    const holdingSymbols = Object.keys(portfolio.holdings || {});
    for (const sym of holdingSymbols) {
        if (!pool.has(sym)) {
            const entry = scored.find(s => s.symbol === sym);
            if (entry) pool.set(sym, entry);
        }
    }

    // 3. Sector wildcards — best from underrepresented sectors
    const sectorsInPool = new Set();
    for (const [, entry] of pool) {
        sectorsInPool.add(stockSectors[entry.symbol] || 'Unknown');
    }

    let wildcardsAdded = 0;
    for (const entry of scored) {
        if (wildcardsAdded >= SECTOR_WILDCARDS) break;
        const sector = stockSectors[entry.symbol] || 'Unknown';
        if (sector === 'Index Fund') continue;
        if (!sectorsInPool.has(sector) && !pool.has(entry.symbol)) {
            pool.set(entry.symbol, entry);
            sectorsInPool.add(sector);
            wildcardsAdded++;
        }
    }

    // 4. Reversal candidates — bullish CHoCH, low-swept, bullish BOS with low momentum
    let reversalsAdded = 0;
    for (const entry of scored) {
        if (reversalsAdded >= REVERSAL_CANDIDATES) break;
        if (pool.has(entry.symbol)) continue;

        const structure = entry.data?.marketStructure;
        const momentum = entry.data?.momentum;
        if (!structure) continue;

        const isReversal =
            (structure.choch && structure.chochType === 'bullish') ||
            (structure.sweep === 'low-swept') ||
            (structure.bos && structure.bosType === 'bullish' && momentum && momentum.score < 5);

        if (isReversal) {
            pool.set(entry.symbol, entry);
            reversalsAdded++;
        }
    }

    return [...pool.values()];
}
