// Metrics computation and output for backtest results
// Extended with per-signal accuracy metrics and matrix summary
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const RESULTS_DIR = join(import.meta.dirname, '..', 'results');

/**
 * Compute all backtest metrics from portfolio state and daily snapshots.
 */
export function computeResults(portfolio, dailySnapshots, initialBalance) {
    const closed = portfolio.closedTrades || [];
    const isUnconstrained = !!portfolio.unconstrained;

    // For unconstrained: compute return from total P&L vs total capital deployed
    // (portfolio value is meaningless with infinite cash)
    let totalReturn, annualizedReturn, finalValue;
    const tradingDays = dailySnapshots.length;

    if (isUnconstrained) {
        const totalPL = closed.reduce((s, t) => s + (t.profitLoss || 0), 0);
        const totalDeployed = closed.reduce((s, t) => s + (t.buyPrice * t.shares), 0);
        finalValue = initialBalance + totalPL;
        totalReturn = totalDeployed > 0 ? (totalPL / totalDeployed) * 100 : 0;
        annualizedReturn = tradingDays > 0 && totalDeployed > 0
            ? (Math.pow(1 + totalPL / totalDeployed, 252 / tradingDays) - 1) * 100
            : 0;
    } else {
        finalValue = dailySnapshots.length > 0
            ? dailySnapshots[dailySnapshots.length - 1].portfolioValue
            : initialBalance;
        totalReturn = ((finalValue - initialBalance) / initialBalance) * 100;
        annualizedReturn = tradingDays > 0
            ? (Math.pow(finalValue / initialBalance, 252 / tradingDays) - 1) * 100
            : 0;
    }

    // Win/Loss metrics
    const winners = closed.filter(t => t.profitLoss > 0);
    const losers = closed.filter(t => t.profitLoss <= 0);
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;

    const avgWinner = winners.length > 0
        ? winners.reduce((s, t) => s + t.returnPercent, 0) / winners.length : 0;
    const avgLoser = losers.length > 0
        ? losers.reduce((s, t) => s + t.returnPercent, 0) / losers.length : 0;

    const grossProfit = winners.reduce((s, t) => s + t.profitLoss, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.profitLoss, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    // Drawdown
    let maxDrawdown = 0;
    let maxDrawdownDuration = 0;
    let peak = initialBalance;
    let drawdownStart = 0;
    for (let i = 0; i < dailySnapshots.length; i++) {
        const v = dailySnapshots[i].portfolioValue;
        if (v > peak) {
            peak = v;
            drawdownStart = i;
        }
        const dd = (peak - v) / peak * 100;
        if (dd > maxDrawdown) {
            maxDrawdown = dd;
            maxDrawdownDuration = i - drawdownStart;
        }
    }

    // Sharpe Ratio
    let sharpe = null;
    if (dailySnapshots.length > 2) {
        const returns = [];
        for (let i = 1; i < dailySnapshots.length; i++) {
            const prev = dailySnapshots[i - 1].portfolioValue;
            if (prev > 0) returns.push((dailySnapshots[i].portfolioValue - prev) / prev);
        }
        if (returns.length > 1) {
            const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
            const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
            const stdDev = Math.sqrt(variance);
            sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
        }
    }

    // Average hold time
    const avgHoldDays = closed.length > 0
        ? closed.reduce((s, t) => s + (t.holdTimeDays || 0), 0) / closed.length : 0;

    // Regime-segmented performance
    const byRegime = {};
    for (const t of closed) {
        const r = t.entryRegime || t.exitMarketRegime || 'unknown';
        if (!byRegime[r]) byRegime[r] = { trades: 0, wins: 0, totalPL: 0 };
        byRegime[r].trades++;
        if (t.profitLoss > 0) byRegime[r].wins++;
        byRegime[r].totalPL += t.profitLoss;
    }
    for (const r of Object.keys(byRegime)) {
        byRegime[r].winRate = round2(byRegime[r].wins / byRegime[r].trades * 100);
        byRegime[r].totalPL = round2(byRegime[r].totalPL);
    }

    // Exit reason distribution
    const exitReasons = {};
    for (const t of closed) {
        const reason = t.exitReason || 'unknown';
        exitReasons[reason] = (exitReasons[reason] || 0) + 1;
    }

    // Sector performance
    const bySector = {};
    for (const t of closed) {
        const s = t.sector || 'Unknown';
        if (!bySector[s]) bySector[s] = { trades: 0, wins: 0, totalPL: 0 };
        bySector[s].trades++;
        if (t.profitLoss > 0) bySector[s].wins++;
        bySector[s].totalPL += t.profitLoss;
    }

    // SPY benchmark
    let spyReturn = null;
    if (dailySnapshots.length >= 2) {
        const firstSpy = dailySnapshots[0].spyPrice;
        const lastSpy = dailySnapshots[dailySnapshots.length - 1].spyPrice;
        if (firstSpy && lastSpy) {
            spyReturn = round2(((lastSpy - firstSpy) / firstSpy) * 100);
        }
    }

    // Signal accuracy metrics
    const signalAccuracy = computeSignalAccuracy(closed);

    // Equity curve
    const equityCurve = dailySnapshots.map(s => ({ date: s.date, value: round2(s.portfolioValue) }));

    return {
        totalReturn: round2(totalReturn),
        annualizedReturn: round2(annualizedReturn),
        finalValue: round2(finalValue),
        initialBalance,
        maxDrawdown: round2(maxDrawdown),
        maxDrawdownDuration,
        sharpe: sharpe !== null ? round2(sharpe) : null,
        totalTrades: closed.length,
        winRate: round2(winRate),
        avgWinner: round2(avgWinner),
        avgLoser: round2(avgLoser),
        profitFactor: round2(profitFactor),
        avgHoldDays: round2(avgHoldDays),
        spyReturn,
        byRegime,
        exitReasons,
        bySector,
        signalAccuracy,
        equityCurve,
    };
}

/**
 * Compute per-signal accuracy metrics from closed trades.
 */
function computeSignalAccuracy(closedTrades) {
    const bySignal = {};
    const byQuality = {};

    for (const t of closedTrades) {
        const sig = t.signalCode || 'NOSIGNAL';
        const quality = t.signalQuality || 'none';
        const isWin = t.profitLoss > 0;

        // Per-signal stats
        if (!bySignal[sig]) bySignal[sig] = { trades: 0, wins: 0, losses: 0, totalReturn: 0, totalWinReturn: 0, totalLossReturn: 0, grossProfit: 0, grossLoss: 0 };
        const s = bySignal[sig];
        s.trades++;
        s.totalReturn += t.returnPercent || 0;
        if (isWin) { s.wins++; s.totalWinReturn += t.returnPercent || 0; s.grossProfit += t.profitLoss; }
        else { s.losses++; s.totalLossReturn += t.returnPercent || 0; s.grossLoss += Math.abs(t.profitLoss); }

        // Per-quality stats (nested under signal)
        const qKey = `${sig}_${quality}`;
        if (!byQuality[qKey]) byQuality[qKey] = { signal: sig, quality, trades: 0, wins: 0, totalReturn: 0 };
        const q = byQuality[qKey];
        q.trades++;
        q.totalReturn += t.returnPercent || 0;
        if (isWin) q.wins++;
    }

    // Compute derived metrics
    const result = {};
    for (const [sig, s] of Object.entries(bySignal)) {
        const winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
        const avgReturn = s.trades > 0 ? s.totalReturn / s.trades : 0;
        const avgWinReturn = s.wins > 0 ? s.totalWinReturn / s.wins : 0;
        const avgLossReturn = s.losses > 0 ? s.totalLossReturn / s.losses : 0;
        const profitFactor = s.grossLoss > 0 ? s.grossProfit / s.grossLoss : (s.grossProfit > 0 ? Infinity : 0);

        // Quality breakdown
        const qualityBreakdown = {};
        for (const q of ['full', 'strong', 'partial', 'none']) {
            const qData = byQuality[`${sig}_${q}`];
            if (qData && qData.trades > 0) {
                qualityBreakdown[q] = {
                    trades: qData.trades,
                    wins: qData.wins,
                    winRate: round2((qData.wins / qData.trades) * 100),
                    avgReturn: round2(qData.totalReturn / qData.trades),
                };
            }
        }

        // Check if quality is monotonic (full > strong > partial)
        const fullWR = qualityBreakdown.full?.winRate || 0;
        const strongWR = qualityBreakdown.strong?.winRate || 0;
        const partialWR = qualityBreakdown.partial?.winRate || 0;
        const qualityMatters = fullWR > strongWR && strongWR > partialWR && fullWR > 0;

        result[sig] = {
            trades: s.trades,
            wins: s.wins,
            losses: s.losses,
            winRate: round2(winRate),
            avgReturn: round2(avgReturn),
            avgWinReturn: round2(avgWinReturn),
            avgLossReturn: round2(avgLossReturn),
            profitFactor: round2(profitFactor),
            byQuality: qualityBreakdown,
            qualityMatters,
        };
    }

    return result;
}

/**
 * Compute matrix summary — comparison grid across all strategy results.
 * Also computes vsBaseline (alpha vs NOSIGNAL) for each signal.
 */
export function computeMatrixSummary(allResults, startDate, endDate) {
    const grid = {};

    // Find NOSIGNAL baselines for alpha computation
    const baselines = {};
    for (const r of allResults) {
        const parts = r.strategy.split('_');
        if (parts[0] === 'NOSIGNAL') {
            const exitCode = parts.slice(1, -1).join('_'); // Handle multi-part exit codes
            const weightsName = parts[parts.length - 1];
            baselines[`${exitCode}_${weightsName}`] = r.metrics;
        }
    }

    for (const r of allResults) {
        const parts = r.strategy.split('_');
        const signalCode = parts[0];
        const weightsName = parts[parts.length - 1];
        const exitCode = parts.slice(1, -1).join('_');

        if (!grid[signalCode]) grid[signalCode] = {};
        if (!grid[signalCode][exitCode]) grid[signalCode][exitCode] = {};

        const baseline = baselines[`${exitCode}_${weightsName}`];
        const vsBaseline = baseline ? {
            winRateDelta: round2(r.metrics.winRate - baseline.winRate),
            returnDelta: round2(r.metrics.totalReturn - baseline.totalReturn),
            sharpeDelta: (r.metrics.sharpe != null && baseline.sharpe != null)
                ? round2(r.metrics.sharpe - baseline.sharpe) : null,
        } : null;

        grid[signalCode][exitCode][weightsName] = {
            totalReturn: r.metrics.totalReturn,
            winRate: r.metrics.winRate,
            sharpe: r.metrics.sharpe,
            trades: r.metrics.totalTrades,
            maxDrawdown: r.metrics.maxDrawdown,
            profitFactor: r.metrics.profitFactor,
            avgHoldDays: r.metrics.avgHoldDays,
            vsBaseline,
        };
    }

    // Find best combos
    let bestByReturn = null, bestByWinRate = null, bestBySharpe = null;
    for (const r of allResults) {
        const parts = r.strategy.split('_');
        const sig = parts[0];
        const exit = parts.slice(1, -1).join('_');
        const w = parts[parts.length - 1];

        if (!bestByReturn || r.metrics.totalReturn > bestByReturn.value) {
            bestByReturn = { signal: sig, exit, weights: w, value: r.metrics.totalReturn };
        }
        if (r.metrics.totalTrades >= 5 && (!bestByWinRate || r.metrics.winRate > bestByWinRate.value)) {
            bestByWinRate = { signal: sig, exit, weights: w, value: r.metrics.winRate };
        }
        if (r.metrics.sharpe != null && (!bestBySharpe || r.metrics.sharpe > bestBySharpe.value)) {
            bestBySharpe = { signal: sig, exit, weights: w, value: r.metrics.sharpe };
        }
    }

    return {
        type: 'matrix',
        startDate,
        endDate,
        totalCombinations: allResults.length,
        grid,
        best: { byReturn: bestByReturn, byWinRate: bestByWinRate, bySharpe: bestBySharpe },
    };
}

/**
 * Print formatted results to console.
 */
export function printResults(result) {
    const m = result.metrics || result;
    const strategyName = result.strategy || 'Unknown';
    const startDate = m.equityCurve?.[0]?.date || '?';
    const endDate = m.equityCurve?.[m.equityCurve.length - 1]?.date || '?';

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`BACKTEST RESULTS — ${strategyName} (${startDate} → ${endDate})`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`Return:        ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn}% ($${m.initialBalance.toLocaleString()} → $${m.finalValue.toLocaleString()})`);
    console.log(`Annualized:    ${m.annualizedReturn >= 0 ? '+' : ''}${m.annualizedReturn}%`);
    console.log(`Max Drawdown:  -${m.maxDrawdown}% (${m.maxDrawdownDuration} days)`);
    if (m.sharpe !== null) console.log(`Sharpe:        ${m.sharpe}`);
    if (m.spyReturn !== null) console.log(`SPY Return:    ${m.spyReturn >= 0 ? '+' : ''}${m.spyReturn}%`);
    console.log('');
    console.log(`Trades:        ${m.totalTrades}`);
    console.log(`Win Rate:      ${m.winRate}%`);
    console.log(`Avg Winner:    +${m.avgWinner}%`);
    console.log(`Avg Loser:     ${m.avgLoser}%`);
    console.log(`Profit Factor: ${m.profitFactor}`);
    console.log(`Avg Hold:      ${m.avgHoldDays} days`);

    // Signal accuracy
    if (m.signalAccuracy && Object.keys(m.signalAccuracy).length > 0) {
        console.log('');
        console.log('Signal Accuracy:');
        for (const [sig, data] of Object.entries(m.signalAccuracy)) {
            console.log(`  ${sig.padEnd(10)}: ${data.trades} trades, ${data.winRate}% win rate, avg ${data.avgReturn >= 0 ? '+' : ''}${data.avgReturn}%, PF ${data.profitFactor}`);
            if (data.qualityMatters) console.log(`             Quality matters: full>${data.byQuality?.strong?.winRate || '?'}%>partial`);
        }
    }

    if (Object.keys(m.byRegime).length > 0) {
        console.log('');
        console.log('Regime Performance:');
        for (const [regime, data] of Object.entries(m.byRegime)) {
            console.log(`  ${regime.padEnd(8)}: ${data.trades} trades, ${data.winRate}% win rate, ${data.totalPL >= 0 ? '+' : ''}$${data.totalPL.toLocaleString()}`);
        }
    }

    if (Object.keys(m.exitReasons).length > 0) {
        console.log('');
        console.log('Exit Reasons:');
        for (const [reason, count] of Object.entries(m.exitReasons)) {
            const pct = m.totalTrades > 0 ? ((count / m.totalTrades) * 100).toFixed(1) : '0';
            console.log(`  ${reason.padEnd(20)}: ${count} (${pct}%)`);
        }
    }

    console.log('═══════════════════════════════════════════════════');
}

/**
 * Print matrix comparison summary.
 */
export function printMatrixSummary(summary) {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('MATRIX SUMMARY');
    console.log(`${summary.totalCombinations} combinations tested`);
    console.log('═══════════════════════════════════════════════════');

    if (summary.best.byReturn) {
        const b = summary.best.byReturn;
        console.log(`Best Return:   ${b.signal}/${b.exit} (${b.weights}): ${b.value >= 0 ? '+' : ''}${b.value}%`);
    }
    if (summary.best.byWinRate) {
        const b = summary.best.byWinRate;
        console.log(`Best Win Rate: ${b.signal}/${b.exit} (${b.weights}): ${b.value}%`);
    }
    if (summary.best.bySharpe) {
        const b = summary.best.bySharpe;
        console.log(`Best Sharpe:   ${b.signal}/${b.exit} (${b.weights}): ${b.value}`);
    }

    console.log('═══════════════════════════════════════════════════');
}

/**
 * Save results JSON to results/ directory.
 */
export function saveResults(result, strategyName, startDate, endDate) {
    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    const filename = `${strategyName}_${startDate}_${endDate}.json`;
    const filePath = join(RESULTS_DIR, filename);
    writeFileSync(filePath, JSON.stringify(result, null, 2));
    console.log(`Results saved: ${filePath}`);
}

/**
 * Save matrix summary to results/ directory.
 */
export function saveMatrixResults(summary) {
    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    const filename = `matrix_${summary.startDate}_${summary.endDate}.json`;
    const filePath = join(RESULTS_DIR, filename);
    writeFileSync(filePath, JSON.stringify(summary, null, 2));
    console.log(`Matrix results saved: ${filePath}`);
}

function round2(v) {
    if (v === Infinity || v === -Infinity) return v;
    return Math.round(v * 100) / 100;
}
