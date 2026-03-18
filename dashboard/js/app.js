// FORGE Signal Backtester Dashboard — Client-side application

const COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];

let chartInstances = {};
let matrixData = null;

// ═══════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════

function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));

    const view = document.getElementById('view-' + viewName);
    if (view) view.classList.add('active');

    const btn = document.querySelector(`.nav button[data-view="${viewName}"]`);
    if (btn) btn.classList.add('active');

    if (viewName === 'consistency') loadConsistency();
    if (viewName === 'matrix') loadMatrix();
    if (viewName === 'signals') loadSignalAccuracy();
    if (viewName === 'results') loadResults();
    if (viewName === 'mytrades') loadMyTrades();
}

document.querySelectorAll('.nav button').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ═══════════════════════════════════════════════════
// Consistency View (primary)
// ═══════════════════════════════════════════════════

async function loadConsistency() {
    const container = document.getElementById('consistency-content');
    try {
        const res = await fetch('/api/consistency');
        const { strategies } = await res.json();
        if (!strategies || Object.keys(strategies).length === 0) {
            container.innerHTML = '<p class="empty">No multi-period results. Run: <code>node backtest.js --signal=REV --matrix</code> across multiple time periods.</p>';
            return;
        }

        const periods = ['6mo', '1yr', '3yr', '5yr', '8yr'];

        // Sort: all-profitable first, then by profitable count, then avg return
        const sorted = Object.entries(strategies)
            .filter(([_, s]) => s.periodsCount > 1)
            .sort((a, b) => {
                if (b[1].allProfitable !== a[1].allProfitable) return b[1].allProfitable ? 1 : -1;
                if (b[1].profitableCount !== a[1].profitableCount) return b[1].profitableCount - a[1].profitableCount;
                return b[1].avgReturn - a[1].avgReturn;
            });

        if (sorted.length === 0) {
            container.innerHTML = '<p class="empty">Need results across multiple time periods. Run backtests with different --start dates.</p>';
            return;
        }

        // Find which periods actually have data
        const activePeriods = periods.filter(p =>
            sorted.some(([_, s]) => s.periods[p])
        );

        let html = '<h2>Cross-Timeframe Consistency</h2>';
        html += '<p class="subtitle">Strategies profitable across all tested periods are the most reliable signals.</p>';

        html += '<div class="matrix-wrap"><table class="consistency-table"><thead><tr>';
        html += '<th>Strategy</th>';
        for (const p of activePeriods) html += `<th colspan="2">${p}</th>`;
        html += '<th>Status</th>';
        html += '</tr><tr><th></th>';
        for (const p of activePeriods) html += '<th class="sub-header">Return</th><th class="sub-header">WR</th>';
        html += '<th></th></tr></thead><tbody>';

        for (const [name, s] of sorted) {
            const rowClass = s.allProfitable ? 'consistent-row' : s.profitableCount === 0 ? 'bad-row' : '';
            html += `<tr class="${rowClass}">`;
            html += `<td class="strategy-name">${name}</td>`;
            for (const p of activePeriods) {
                const d = s.periods[p];
                if (!d) {
                    html += '<td class="no-data">-</td><td class="no-data">-</td>';
                } else {
                    const retClass = d.totalReturn >= 0 ? 'positive' : 'negative';
                    html += `<td class="${retClass}">${d.totalReturn >= 0 ? '+' : ''}${d.totalReturn.toFixed(1)}%</td>`;
                    html += `<td>${d.winRate.toFixed(0)}%</td>`;
                }
            }
            // Status badge
            if (s.allProfitable) {
                html += '<td><span class="badge badge-green">ALL PROFIT</span></td>';
            } else if (s.profitableCount > 0) {
                html += `<td><span class="badge badge-gray">${s.profitableCount}/${s.periodsCount}</span></td>`;
            } else {
                html += '<td><span class="badge badge-red">NONE</span></td>';
            }
            html += '</tr>';
        }

        html += '</tbody></table></div>';

        // Summary cards for all-profitable strategies
        const winners = sorted.filter(([_, s]) => s.allProfitable);
        if (winners.length > 0) {
            html += '<h3>Durable Strategies (profitable in every period)</h3>';
            html += '<div class="signal-cards">';
            for (const [name, s] of winners) {
                html += '<div class="signal-card consistent">';
                html += `<h3>${name}</h3>`;
                for (const p of activePeriods) {
                    const d = s.periods[p];
                    if (!d) continue;
                    html += `<div class="stat"><span>${p}:</span> ${d.totalReturn >= 0 ? '+' : ''}${d.totalReturn.toFixed(1)}% (${d.trades} trades, ${d.winRate.toFixed(0)}% WR, PF ${d.profitFactor.toFixed(1)})</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
    }
}

// ═══════════════════════════════════════════════════
// Matrix Heatmap
// ═══════════════════════════════════════════════════

async function loadMatrix() {
    const container = document.getElementById('matrix-content');
    try {
        const res = await fetch('/api/matrix');
        if (!res.ok) {
            container.innerHTML = '<p class="empty">No matrix results yet. Run: <code>node backtest.js --matrix</code></p>';
            return;
        }
        matrixData = await res.json();
        renderMatrix();
    } catch (err) {
        container.innerHTML = `<p class="error">Failed to load matrix: ${err.message}</p>`;
    }
}

function renderMatrix() {
    if (!matrixData || !matrixData.grid) return;
    const container = document.getElementById('matrix-content');
    const metric = document.getElementById('matrix-metric').value;
    const grid = matrixData.grid;
    const signals = Object.keys(grid);
    if (signals.length === 0) {
        container.innerHTML = '<p class="empty">No data in matrix.</p>';
        return;
    }

    // Collect all exits across all signals
    const exitSet = new Set();
    for (const sig of signals) {
        for (const exit of Object.keys(grid[sig])) exitSet.add(exit);
    }
    const exits = [...exitSet].sort();

    // Find min/max for color scaling
    let allValues = [];
    for (const sig of signals) {
        for (const exit of exits) {
            const cell = grid[sig]?.[exit];
            if (!cell) continue;
            for (const w of Object.keys(cell)) {
                const val = cell[w][metric];
                if (val != null && isFinite(val)) allValues.push(val);
            }
        }
    }
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);

    // Build table
    let html = '<div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>Signal</th>';
    for (const exit of exits) html += `<th>${exit}</th>`;
    html += '</tr></thead><tbody>';

    for (const sig of signals) {
        const isBaseline = sig === 'NOSIGNAL';
        html += `<tr class="${isBaseline ? 'baseline-row' : ''}"><td class="signal-name">${sig}</td>`;
        for (const exit of exits) {
            const cell = grid[sig]?.[exit];
            if (!cell) { html += '<td class="no-data">-</td>'; continue; }
            // Use first available weight set
            const wKey = Object.keys(cell)[0];
            const data = cell[wKey];
            const val = data[metric];
            const color = cellColor(val, minVal, maxVal, metric);
            const alpha = data.vsBaseline ? ` (${data.vsBaseline.returnDelta >= 0 ? '+' : ''}${data.vsBaseline.returnDelta}%)` : '';
            html += `<td class="matrix-cell" style="background:${color}" onclick="loadDetail('${sig}_${exit}_${wKey}')" title="${sig}/${exit}: ${metric}=${val}${alpha}">${formatVal(val, metric)}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Best combos
    if (matrixData.best) {
        html += '<div class="best-combos">';
        if (matrixData.best.byReturn) html += `<div class="best"><strong>Best Return:</strong> ${matrixData.best.byReturn.signal}/${matrixData.best.byReturn.exit} (${matrixData.best.byReturn.value >= 0 ? '+' : ''}${matrixData.best.byReturn.value}%)</div>`;
        if (matrixData.best.byWinRate) html += `<div class="best"><strong>Best Win Rate:</strong> ${matrixData.best.byWinRate.signal}/${matrixData.best.byWinRate.exit} (${matrixData.best.byWinRate.value}%)</div>`;
        if (matrixData.best.bySharpe) html += `<div class="best"><strong>Best Sharpe:</strong> ${matrixData.best.bySharpe.signal}/${matrixData.best.bySharpe.exit} (${matrixData.best.bySharpe.value})</div>`;
        html += '</div>';
    }

    container.innerHTML = html;
}

function cellColor(val, min, max, metric) {
    if (val == null || !isFinite(val)) return 'rgba(100,100,100,0.2)';
    const isReversed = metric === 'maxDrawdown'; // Lower is better for drawdown
    let ratio = max !== min ? (val - min) / (max - min) : 0.5;
    if (isReversed) ratio = 1 - ratio;
    // Green for good, red for bad
    const r = Math.round(255 * (1 - ratio));
    const g = Math.round(255 * ratio);
    return `rgba(${r},${g},80,0.35)`;
}

function formatVal(val, metric) {
    if (val == null || !isFinite(val)) return '-';
    if (metric === 'winRate' || metric === 'totalReturn' || metric === 'maxDrawdown') return val.toFixed(1) + '%';
    if (metric === 'sharpe') return val.toFixed(2);
    return val.toFixed(1);
}

document.getElementById('matrix-metric')?.addEventListener('change', renderMatrix);

// ═══════════════════════════════════════════════════
// Signal Accuracy
// ═══════════════════════════════════════════════════

async function loadSignalAccuracy() {
    const container = document.getElementById('signals-content');
    // Load all results and aggregate signal accuracy
    try {
        const res = await fetch('/api/results');
        const { results } = await res.json();
        if (!results || results.length === 0) {
            container.innerHTML = '<p class="empty">No results yet.</p>';
            return;
        }

        // Load full data for each result to get signal accuracy
        const allAccuracy = {};
        for (const r of results.slice(0, 20)) { // Limit to 20 most recent
            try {
                const full = await (await fetch(`/api/result/${r.filename}`)).json();
                const sa = full.metrics?.signalAccuracy;
                if (!sa) continue;
                for (const [sig, data] of Object.entries(sa)) {
                    if (!allAccuracy[sig]) allAccuracy[sig] = { trades: 0, wins: 0, totalReturn: 0, byQuality: {} };
                    allAccuracy[sig].trades += data.trades;
                    allAccuracy[sig].wins += data.wins;
                    allAccuracy[sig].totalReturn += data.avgReturn * data.trades;
                    for (const [q, qd] of Object.entries(data.byQuality || {})) {
                        if (!allAccuracy[sig].byQuality[q]) allAccuracy[sig].byQuality[q] = { trades: 0, wins: 0 };
                        allAccuracy[sig].byQuality[q].trades += qd.trades;
                        allAccuracy[sig].byQuality[q].wins += qd.wins;
                    }
                }
            } catch { /* skip */ }
        }

        let html = '<h2>Signal Accuracy (Aggregated)</h2><div class="signal-cards">';
        for (const [sig, data] of Object.entries(allAccuracy)) {
            const winRate = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(1) : '0';
            const avgReturn = data.trades > 0 ? (data.totalReturn / data.trades).toFixed(1) : '0';
            html += `<div class="signal-card ${sig === 'NOSIGNAL' ? 'baseline' : ''}">
                <h3>${sig}</h3>
                <div class="stat"><span>Trades:</span> ${data.trades}</div>
                <div class="stat"><span>Win Rate:</span> ${winRate}%</div>
                <div class="stat"><span>Avg Return:</span> ${avgReturn}%</div>`;
            if (Object.keys(data.byQuality).length > 0) {
                html += '<div class="quality-breakdown"><h4>By Quality:</h4>';
                for (const q of ['full', 'strong', 'partial', 'none']) {
                    const qd = data.byQuality[q];
                    if (!qd || qd.trades === 0) continue;
                    const qWR = (qd.wins / qd.trades * 100).toFixed(0);
                    html += `<div class="quality-row"><span>${q}:</span> ${qd.trades} trades, ${qWR}% WR</div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<p class="error">Failed to load signal accuracy: ${err.message}</p>`;
    }
}

// ═══════════════════════════════════════════════════
// Strategy Detail
// ═══════════════════════════════════════════════════

async function loadDetail(strategyName) {
    const tab = document.getElementById('detail-tab');
    tab.style.display = 'inline-block';
    tab.textContent = strategyName;
    showView('detail');

    const container = document.getElementById('detail-content');
    container.innerHTML = '<p>Loading...</p>';

    try {
        const res = await fetch('/api/results');
        const { results } = await res.json();
        // Find matching result file
        const match = results.find(r => r.strategy === strategyName || r.filename.startsWith(strategyName));
        if (!match) {
            container.innerHTML = `<p class="error">Result not found for ${strategyName}</p>`;
            return;
        }
        const full = await (await fetch(`/api/result/${match.filename}`)).json();
        renderDetail(full, container);
    } catch (err) {
        container.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
    }
}

function renderDetail(data, container) {
    const m = data.metrics || {};
    let html = `<h2>${data.strategy}</h2>`;
    html += '<div class="metrics-grid">';
    html += metricCard('Return', `${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn}%`);
    html += metricCard('Sharpe', m.sharpe ?? 'N/A');
    html += metricCard('Win Rate', `${m.winRate}%`);
    html += metricCard('Trades', m.totalTrades);
    html += metricCard('Max DD', `-${m.maxDrawdown}%`);
    html += metricCard('Profit Factor', m.profitFactor);
    html += metricCard('Avg Hold', `${m.avgHoldDays}d`);
    html += metricCard('SPY Return', m.spyReturn != null ? `${m.spyReturn}%` : 'N/A');
    html += '</div>';

    // Equity curve
    if (m.equityCurve?.length > 0) {
        html += '<div class="chart-container"><canvas id="detail-chart"></canvas></div>';
    }

    // Exit reasons
    if (m.exitReasons) {
        html += '<h3>Exit Reasons</h3><div class="exit-reasons">';
        for (const [reason, count] of Object.entries(m.exitReasons)) {
            const pct = m.totalTrades > 0 ? (count / m.totalTrades * 100).toFixed(1) : 0;
            html += `<div class="exit-row"><span>${reason}</span> ${count} (${pct}%)</div>`;
        }
        html += '</div>';
    }

    // Signal accuracy
    if (m.signalAccuracy && Object.keys(m.signalAccuracy).length > 0) {
        html += '<h3>Signal Accuracy</h3><div class="signal-table">';
        for (const [sig, s] of Object.entries(m.signalAccuracy)) {
            html += `<div class="sig-row"><strong>${sig}</strong>: ${s.trades} trades, ${s.winRate}% WR, avg ${s.avgReturn >= 0 ? '+' : ''}${s.avgReturn}%</div>`;
        }
        html += '</div>';
    }

    // Trade log
    if (data.portfolio?.closedTrades?.length > 0) {
        html += '<h3>Trade Log</h3><div class="trade-log"><table><thead><tr><th>Symbol</th><th>Signal</th><th>Quality</th><th>Buy</th><th>Sell</th><th>Return</th><th>Hold</th><th>Exit</th></tr></thead><tbody>';
        for (const t of data.portfolio.closedTrades) {
            const cls = t.profitLoss >= 0 ? 'win' : 'loss';
            html += `<tr class="${cls}"><td>${t.symbol}</td><td>${t.signalCode || '-'}</td><td>${t.signalQuality || '-'}</td><td>$${t.buyPrice?.toFixed(2)}</td><td>$${t.sellPrice?.toFixed(2)}</td><td>${t.returnPercent >= 0 ? '+' : ''}${t.returnPercent?.toFixed(1)}%</td><td>${t.holdTimeDays}d</td><td>${t.exitReason || '-'}</td></tr>`;
        }
        html += '</tbody></table></div>';
    }

    container.innerHTML = html;

    // Render chart
    if (m.equityCurve?.length > 0) {
        if (chartInstances.detail) chartInstances.detail.destroy();
        const ctx = document.getElementById('detail-chart').getContext('2d');
        chartInstances.detail = new Chart(ctx, {
            type: 'line',
            data: {
                labels: m.equityCurve.map(p => p.date),
                datasets: [{ label: 'Portfolio', data: m.equityCurve.map(p => p.value), borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false } } }
        });
    }
}

function metricCard(label, value) {
    return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;
}

// ═══════════════════════════════════════════════════
// All Results
// ═══════════════════════════════════════════════════

async function loadResults() {
    const container = document.getElementById('results-list');
    try {
        const res = await fetch('/api/results');
        const { results } = await res.json();
        if (!results || results.length === 0) {
            container.innerHTML = '<p class="empty">No results. Run a backtest first.</p>';
            return;
        }
        let html = '<table class="results-table"><thead><tr><th>Strategy</th><th>Return</th><th>Sharpe</th><th>Win%</th><th>Trades</th><th>Max DD</th><th>PF</th></tr></thead><tbody>';
        for (const r of results) {
            if (r.error) continue;
            html += `<tr onclick="loadDetail('${r.strategy}')"><td>${r.strategy}</td><td>${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn}%</td><td>${r.sharpe ?? '-'}</td><td>${r.winRate}%</td><td>${r.totalTrades}</td><td>-${r.maxDrawdown}%</td><td>${r.profitFactor}</td></tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
    }
}

// ═══════════════════════════════════════════════════
// My Trades
// ═══════════════════════════════════════════════════

async function loadMyTrades() {
    const container = document.getElementById('mytrades-content');
    try {
        const res = await fetch('/api/my-trades');
        if (!res.ok) {
            container.innerHTML = '<p class="empty">APEX portfolio not available.</p>';
            return;
        }
        const data = await res.json();
        if (data.error) {
            container.innerHTML = `<p class="error">${data.error}</p>`;
            return;
        }

        const m = data.metrics;
        let html = '<h2>My APEX Trades</h2>';
        html += '<div class="metrics-grid">';
        html += metricCard('Trades', m.totalTrades);
        html += metricCard('Open', m.openPositions);
        html += metricCard('Total P&L', `$${m.totalPL?.toLocaleString()}`);
        html += metricCard('Win Rate', `${m.winRate}%`);
        html += metricCard('Avg Winner', `+${m.avgWinner}%`);
        html += metricCard('Avg Loser', `${m.avgLoser}%`);
        html += metricCard('Profit Factor', m.profitFactor ?? 'N/A');
        html += metricCard('Avg Hold', `${m.avgHoldDays}d`);
        html += '</div>';

        if (data.closedTrades?.length > 0) {
            html += '<h3>Closed Trades</h3><table class="results-table"><thead><tr><th>Symbol</th><th>Buy</th><th>Sell</th><th>Return</th><th>P&L</th><th>Days</th><th>Exit</th></tr></thead><tbody>';
            for (const t of data.closedTrades.slice().reverse()) {
                const cls = (t.profitLoss || 0) >= 0 ? 'win' : 'loss';
                html += `<tr class="${cls}"><td>${t.symbol}</td><td>$${t.buyPrice?.toFixed(2)}</td><td>$${t.sellPrice?.toFixed(2)}</td><td>${t.returnPercent >= 0 ? '+' : ''}${t.returnPercent?.toFixed(1)}%</td><td>${t.profitLoss >= 0 ? '+' : ''}$${t.profitLoss?.toFixed(0)}</td><td>${t.holdTimeDays || '-'}</td><td>${t.exitReason || '-'}</td></tr>`;
            }
            html += '</tbody></table>';
        }

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<p class="error">Failed: ${err.message}</p>`;
    }
}

// ═══════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════
loadConsistency();
