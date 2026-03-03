// Metrics computation and output for backtest results
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const RESULTS_DIR = join(import.meta.dirname, '..', 'results');

/**
 * Compute all backtest metrics from portfolio state and daily snapshots.
 */
export function computeResults(portfolio, dailySnapshots, initialBalance) {
    const closed = portfolio.closedTrades || [];
    const finalValue = dailySnapshots.length > 0
        ? dailySnapshots[dailySnapshots.length - 1].portfolioValue
        : initialBalance;

    // Return metrics
    const totalReturn = ((finalValue - initialBalance) / initialBalance) * 100;
    const tradingDays = dailySnapshots.length;
    const annualizedReturn = tradingDays > 0
        ? (Math.pow(finalValue / initialBalance, 252 / tradingDays) - 1) * 100
        : 0;

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
        equityCurve,
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
 * Print comparison table for multiple strategy results.
 */
export function printComparison(allResults) {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('STRATEGY COMPARISON');
    console.log('═══════════════════════════════════════════════════');
    console.log(`${'Strategy'.padEnd(20)} ${'Return'.padStart(8)} ${'Sharpe'.padStart(8)} ${'Win%'.padStart(6)} ${'Trades'.padStart(7)} ${'MaxDD'.padStart(7)} ${'PF'.padStart(6)}`);
    console.log('─'.repeat(62));
    for (const r of allResults) {
        const m = r.metrics;
        console.log(
            `${(r.strategy || '?').padEnd(20)} ` +
            `${(m.totalReturn >= 0 ? '+' : '') + m.totalReturn + '%'}`.padStart(8) + ' ' +
            `${m.sharpe ?? 'N/A'}`.padStart(8) + ' ' +
            `${m.winRate}%`.padStart(6) + ' ' +
            `${m.totalTrades}`.padStart(7) + ' ' +
            `${'-' + m.maxDrawdown + '%'}`.padStart(7) + ' ' +
            `${m.profitFactor}`.padStart(6)
        );
    }
    if (allResults.length > 0 && allResults[0].metrics.spyReturn !== null) {
        console.log('─'.repeat(62));
        console.log(`${'SPY (buy & hold)'.padEnd(20)} ${(allResults[0].metrics.spyReturn >= 0 ? '+' : '') + allResults[0].metrics.spyReturn + '%'}`.padStart(8));
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

function round2(v) {
    if (v === Infinity || v === -Infinity) return v;
    return Math.round(v * 100) / 100;
}
