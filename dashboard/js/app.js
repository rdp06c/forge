// FORGE Backtester Dashboard — Client-side application

const COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'];

let chartInstances = {};

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

    if (viewName === 'overview') loadOverview();
    if (viewName === 'comparison') loadComparison();
    if (viewName === 'mytrades') loadMyTrades();
}

document.querySelectorAll('.nav button').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ═══════════════════════════════════════════════════
// Overview — list of backtest results
// ═══════════════════════════════════════════════════

async function loadOverview() {
    const el = document.getElementById('results-list');
    try {
        const resp = await fetch('/api/results');
        const { results } = await resp.json();

        if (!results || results.length === 0) {
            el.innerHTML = `<div class="empty-state">
                <h2>No backtest results yet</h2>
                <p>Run a backtest to see results here</p>
                <code>node backtest.js --strategy=baseline</code>
            </div>`;
            return;
        }

        el.innerHTML = `<table class="results-table">
            <thead><tr>
                <th>Strategy</th><th>Period</th><th>Return</th><th>SPY</th>
                <th>Sharpe</th><th>Win Rate</th><th>Trades</th><th>Max DD</th><th>PF</th>
            </tr></thead>
            <tbody>${results.map(r => {
                if (r.error) return `<tr><td colspan="9">${r.filename} — error loading</td></tr>`;
                const retClass = (r.totalReturn || 0) >= 0 ? 'positive' : 'negative';
                const spyClass = (r.spyReturn || 0) >= 0 ? 'positive' : 'negative';
                return `<tr onclick="loadDetail('${r.filename}')">
                    <td><strong>${r.strategy}</strong></td>
                    <td>${r.startDate || '?'} &rarr; ${r.endDate || '?'}</td>
                    <td class="${retClass}">${fmtSign(r.totalReturn, '%')}</td>
                    <td class="${spyClass}">${fmtSign(r.spyReturn, '%')}</td>
                    <td>${r.sharpe ?? 'N/A'}</td>
                    <td>${fmt(r.winRate, '%')}</td>
                    <td>${r.totalTrades ?? 0}</td>
                    <td class="negative">${r.maxDrawdown != null ? '-' + r.maxDrawdown + '%' : 'N/A'}</td>
                    <td>${r.profitFactor ?? 'N/A'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch (err) {
        el.innerHTML = `<div class="empty-state"><h2>Error loading results</h2><p>${err.message}</p></div>`;
    }
}

// ═══════════════════════════════════════════════════
// Detail — full metrics for one backtest result
// ═══════════════════════════════════════════════════

async function loadDetail(filename) {
    const el = document.getElementById('detail-content');
    const tab = document.getElementById('detail-tab');
    tab.style.display = '';

    try {
        const resp = await fetch('/api/result/' + encodeURIComponent(filename));
        const data = await resp.json();
        if (data.error) { el.innerHTML = `<p>${data.error}</p>`; showView('detail'); return; }

        const m = data.metrics || {};
        const trades = data.portfolio?.closedTrades || [];

        // Metrics cards
        let html = `<h2 style="margin-bottom:16px">${data.strategy} <span style="color:var(--text-muted);font-size:13px">${m.equityCurve?.[0]?.date || ''} &rarr; ${m.equityCurve?.[m.equityCurve.length-1]?.date || ''}</span></h2>`;

        html += `<div class="metrics-grid">
            ${metricCard('Total Return', fmtSign(m.totalReturn, '%'), m.totalReturn >= 0)}
            ${metricCard('Annualized', fmtSign(m.annualizedReturn, '%'), m.annualizedReturn >= 0)}
            ${metricCard('Final Value', '$' + (m.finalValue?.toLocaleString() || '?'), true, '$' + (m.initialBalance?.toLocaleString() || '?') + ' initial')}
            ${metricCard('Max Drawdown', '-' + m.maxDrawdown + '%', false, m.maxDrawdownDuration + ' days')}
            ${metricCard('Sharpe Ratio', m.sharpe ?? 'N/A', (m.sharpe || 0) >= 0)}
            ${metricCard('SPY Return', fmtSign(m.spyReturn, '%'), (m.spyReturn || 0) >= 0)}
            ${metricCard('Win Rate', fmt(m.winRate, '%'), (m.winRate || 0) >= 50)}
            ${metricCard('Total Trades', m.totalTrades, true)}
            ${metricCard('Avg Winner', '+' + m.avgWinner + '%', true)}
            ${metricCard('Avg Loser', m.avgLoser + '%', false)}
            ${metricCard('Profit Factor', m.profitFactor, (m.profitFactor || 0) >= 1)}
            ${metricCard('Avg Hold', m.avgHoldDays + 'd', true)}
        </div>`;

        // Equity curve chart
        html += `<div class="charts-row">
            <div class="chart-box full-width"><h3>Equity Curve</h3><canvas id="equity-chart"></canvas></div>
        </div>`;

        // Regime performance
        if (m.byRegime && Object.keys(m.byRegime).length > 0) {
            html += `<h3 class="section-header">Regime Performance</h3><div class="regime-grid">`;
            for (const [regime, d] of Object.entries(m.byRegime)) {
                const badgeClass = regime === 'bull' ? 'badge-bull' : regime === 'bear' ? 'badge-bear' : 'badge-choppy';
                html += `<div class="metric-card">
                    <div class="label"><span class="badge ${badgeClass}">${regime}</span></div>
                    <div class="value">${d.trades} trades</div>
                    <div class="sub">${d.winRate}% win rate &middot; ${d.totalPL >= 0 ? '+' : ''}$${d.totalPL.toLocaleString()}</div>
                </div>`;
            }
            html += `</div>`;
        }

        // Exit reasons
        if (m.exitReasons && Object.keys(m.exitReasons).length > 0) {
            html += `<h3 class="section-header">Exit Reasons</h3>`;
            const maxCount = Math.max(...Object.values(m.exitReasons));
            for (const [reason, count] of Object.entries(m.exitReasons)) {
                const pct = m.totalTrades > 0 ? ((count / m.totalTrades) * 100).toFixed(1) : '0';
                const width = maxCount > 0 ? (count / maxCount * 100) : 0;
                html += `<div class="exit-bar">
                    <span class="exit-bar-label">${reason}</span>
                    <div class="exit-bar-fill" style="width:${width}%"></div>
                    <span class="exit-bar-count">${count} (${pct}%)</span>
                </div>`;
            }
        }

        // Trade log
        if (trades.length > 0) {
            html += `<h3 class="section-header">Trade Log (${trades.length} trades)</h3>`;
            html += `<div class="filters">
                <select id="filter-exit" onchange="filterTrades()">
                    <option value="">All exits</option>
                    ${[...new Set(trades.map(t => t.exitReason))].map(r => `<option value="${r}">${r}</option>`).join('')}
                </select>
                <select id="filter-result" onchange="filterTrades()">
                    <option value="">All results</option>
                    <option value="win">Winners</option>
                    <option value="loss">Losers</option>
                </select>
            </div>`;
            html += `<div class="table-section"><div class="table-wrap">
                <table class="data-table" id="trade-table">
                    <thead><tr>
                        <th>Symbol</th><th>Sector</th><th>Buy</th><th>Sell</th>
                        <th>Return</th><th>P&L</th><th>Hold</th><th>Exit</th><th>Regime</th>
                    </tr></thead>
                    <tbody>${trades.map((t, idx) => {
                        const retClass = (t.returnPercent || 0) >= 0 ? 'positive' : 'negative';
                        const hasAttr = t.entryBreakdown || t.exitBreakdown;
                        return `<tr data-exit="${t.exitReason || ''}" data-result="${(t.profitLoss || 0) >= 0 ? 'win' : 'loss'}" ${hasAttr ? `class="clickable" onclick="toggleAttribution(${idx})"` : ''}>
                            <td><strong>${t.symbol}</strong>${hasAttr ? ' <span style="color:var(--text-muted);font-size:9px">▸</span>' : ''}</td>
                            <td style="color:var(--text-muted)">${t.sector || '?'}</td>
                            <td>$${t.buyPrice?.toFixed(2) || '?'}<br><span style="color:var(--text-muted);font-size:10px">${t.buyDate?.split('T')[0] || '?'}</span></td>
                            <td>$${t.sellPrice?.toFixed(2) || '?'}<br><span style="color:var(--text-muted);font-size:10px">${t.sellDate?.split('T')[0] || '?'}</span></td>
                            <td class="${retClass}">${fmtSign(t.returnPercent, '%')}</td>
                            <td class="${retClass}">${t.profitLoss >= 0 ? '+' : ''}$${t.profitLoss?.toFixed(2) || '0'}</td>
                            <td>${t.holdTimeDays ?? '?'}d</td>
                            <td>${t.exitReason || '?'}</td>
                            <td>${t.entryRegime || '?'}</td>
                        </tr>
                        ${hasAttr ? `<tr class="attr-row" id="attr-${idx}" style="display:none"><td colspan="9">${renderAttribution(t)}</td></tr>` : ''}`;
                    }).join('')}</tbody>
                </table>
            </div></div>`;
        }

        el.innerHTML = html;
        showView('detail');

        // Draw equity curve
        if (m.equityCurve?.length > 0) {
            drawEquityCurve('equity-chart', m.equityCurve, m.initialBalance);
        }

    } catch (err) {
        el.innerHTML = `<p>Error: ${err.message}</p>`;
        showView('detail');
    }
}

function toggleAttribution(idx) {
    const row = document.getElementById('attr-' + idx);
    if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function filterTrades() {
    const exitFilter = document.getElementById('filter-exit')?.value || '';
    const resultFilter = document.getElementById('filter-result')?.value || '';
    const rows = document.querySelectorAll('#trade-table tbody tr');
    rows.forEach(row => {
        const matchExit = !exitFilter || row.dataset.exit === exitFilter;
        const matchResult = !resultFilter || row.dataset.result === resultFilter;
        row.style.display = matchExit && matchResult ? '' : 'none';
    });
}

// ═══════════════════════════════════════════════════
// Comparison — all strategies side by side
// ═══════════════════════════════════════════════════

async function loadComparison() {
    const el = document.getElementById('comparison-content');
    try {
        const resp = await fetch('/api/comparison');
        const { results } = await resp.json();

        if (!results || results.length === 0) {
            el.innerHTML = `<div class="empty-state">
                <h2>No results to compare</h2>
                <p>Run multiple strategies to see a comparison</p>
                <code>node backtest.js --all</code>
            </div>`;
            return;
        }

        // Comparison table
        const metrics = [
            { key: 'totalReturn', label: 'Return', fmt: v => fmtSign(v, '%'), higher: true },
            { key: 'sharpe', label: 'Sharpe', fmt: v => v ?? 'N/A', higher: true },
            { key: 'winRate', label: 'Win Rate', fmt: v => fmt(v, '%'), higher: true },
            { key: 'totalTrades', label: 'Trades', fmt: v => v, higher: false },
            { key: 'maxDrawdown', label: 'Max DD', fmt: v => '-' + v + '%', higher: false },
            { key: 'profitFactor', label: 'Profit Factor', fmt: v => v ?? 'N/A', higher: true },
            { key: 'spyReturn', label: 'SPY Return', fmt: v => fmtSign(v, '%'), higher: false },
        ];

        let html = `<div class="table-section"><table class="compare-table">
            <thead><tr><th>Metric</th>${results.map(r => `<th>${r.strategy}</th>`).join('')}</tr></thead>
            <tbody>`;

        for (const m of metrics) {
            const vals = results.map(r => r[m.key]);
            const bestIdx = m.higher ? indexOfMax(vals) : indexOfMin(vals);
            html += `<tr><td style="color:var(--text-muted)">${m.label}</td>`;
            results.forEach((r, i) => {
                const isBest = i === bestIdx && results.length > 1 && m.key !== 'spyReturn';
                html += `<td class="${isBest ? 'best' : ''}">${m.fmt(r[m.key])}</td>`;
            });
            html += `</tr>`;
        }
        html += `</tbody></table></div>`;

        // Equity curve overlay
        const curvesExist = results.some(r => r.equityCurve?.length > 0);
        if (curvesExist) {
            html += `<div class="chart-box"><h3>Equity Curves — All Strategies</h3><canvas id="compare-chart"></canvas></div>`;
        }

        el.innerHTML = html;

        if (curvesExist) {
            drawComparisonChart('compare-chart', results);
        }

    } catch (err) {
        el.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
}

// ═══════════════════════════════════════════════════
// My Trades — APEX live trade comparison
// ═══════════════════════════════════════════════════

async function loadMyTrades() {
    const el = document.getElementById('mytrades-content');
    try {
        const [myResp, compResp] = await Promise.all([
            fetch('/api/my-trades'),
            fetch('/api/comparison'),
        ]);
        const myData = await myResp.json();
        const compData = await compResp.json();

        if (myData.error) {
            el.innerHTML = `<div class="empty-state"><h2>APEX Portfolio Not Found</h2><p>${myData.error}</p></div>`;
            return;
        }

        const m = myData.metrics;
        const closed = myData.closedTrades || [];
        const benchmarks = compData.results || [];

        let html = `<h2 style="margin-bottom:8px">My Trades vs Benchmarks</h2>
            <p style="color:var(--text-muted);margin-bottom:16px">${myData.firstDate || '?'} &rarr; ${myData.lastDate || '?'} &middot; ${m.totalTrades} closed trades &middot; ${m.openPositions} open positions</p>`;

        // Metrics cards
        html += `<div class="metrics-grid">
            ${metricCard('Closed P&L', (m.totalPL >= 0 ? '+$' : '-$') + Math.abs(m.totalPL).toLocaleString(), m.totalPL >= 0)}
            ${metricCard('Win Rate', fmt(m.winRate, '%'), m.winRate >= 50)}
            ${metricCard('Avg Winner', '+' + m.avgWinner + '%', true)}
            ${metricCard('Avg Loser', m.avgLoser + '%', false)}
            ${metricCard('Profit Factor', m.profitFactor ?? 'N/A', (m.profitFactor || 0) >= 1)}
            ${metricCard('Avg Hold', m.avgHoldDays + 'd', true)}
        </div>`;

        // Comparison table: my trades vs each benchmark (over overlapping period only)
        if (benchmarks.length > 0) {
            html += `<h3 class="section-header">Benchmark Comparison</h3>`;
            html += `<div class="table-section"><table class="compare-table">
                <thead><tr><th>Metric</th><th>My Trades</th>${benchmarks.map(b => `<th>${b.strategy}</th>`).join('')}</tr></thead>
                <tbody>
                    <tr><td style="color:var(--text-muted)">Win Rate</td><td>${fmt(m.winRate, '%')}</td>${benchmarks.map(b => `<td>${fmt(b.winRate, '%')}</td>`).join('')}</tr>
                    <tr><td style="color:var(--text-muted)">Profit Factor</td><td>${m.profitFactor ?? 'N/A'}</td>${benchmarks.map(b => `<td>${b.profitFactor ?? 'N/A'}</td>`).join('')}</tr>
                    <tr><td style="color:var(--text-muted)">Total Trades</td><td>${m.totalTrades}</td>${benchmarks.map(b => `<td>${b.totalTrades ?? 0}</td>`).join('')}</tr>
                    <tr><td style="color:var(--text-muted)">Avg Winner</td><td>+${m.avgWinner}%</td>${benchmarks.map(b => `<td>—</td>`).join('')}</tr>
                    <tr><td style="color:var(--text-muted)">Avg Loser</td><td>${m.avgLoser}%</td>${benchmarks.map(b => `<td>—</td>`).join('')}</tr>
                </tbody>
            </table></div>`;
        }

        // Trade log with attribution
        if (closed.length > 0) {
            html += `<h3 class="section-header">Closed Trades (${closed.length})</h3>`;
            html += `<div class="table-section"><div class="table-wrap">
                <table class="data-table">
                    <thead><tr>
                        <th>Symbol</th><th>Buy</th><th>Sell</th>
                        <th>Return</th><th>P&L</th><th>Hold</th><th>Exit</th>
                    </tr></thead>
                    <tbody>${closed.map(t => {
                        const retClass = (t.returnPercent || 0) >= 0 ? 'positive' : 'negative';
                        const holdDays = t.holdTime ? Math.round(t.holdTime / 86400000 * 10) / 10 : '?';
                        return `<tr>
                            <td><strong>${t.symbol}</strong></td>
                            <td>$${t.buyPrice?.toFixed(2) || '?'}<br><span style="color:var(--text-muted);font-size:10px">${t.buyDate?.split('T')[0] || '?'}</span></td>
                            <td>$${t.sellPrice?.toFixed(2) || '?'}<br><span style="color:var(--text-muted);font-size:10px">${t.sellDate?.split('T')[0] || '?'}</span></td>
                            <td class="${retClass}">${fmtSign(Math.round(t.returnPercent * 100) / 100, '%')}</td>
                            <td class="${retClass}">${t.profitLoss >= 0 ? '+' : ''}$${t.profitLoss?.toFixed(2) || '0'}</td>
                            <td>${holdDays}d</td>
                            <td>${t.exitReason || '?'}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div></div>`;
        }

        // Open positions
        const holdingSymbols = Object.keys(myData.holdings || {});
        if (holdingSymbols.length > 0) {
            html += `<h3 class="section-header">Open Positions (${holdingSymbols.length})</h3>`;
            html += `<div class="metrics-grid">`;
            for (const sym of holdingSymbols) {
                const shares = myData.holdings[sym];
                html += `<div class="metric-card"><div class="label">${sym}</div><div class="value">${shares} shares</div></div>`;
            }
            html += `</div>`;
        }

        el.innerHTML = html;
    } catch (err) {
        el.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
}

// ═══════════════════════════════════════════════════
// Attribution — score breakdown display for FORGE trades
// ═══════════════════════════════════════════════════

function renderAttribution(trade) {
    if (!trade.entryBreakdown && !trade.exitBreakdown) return '';

    const keys = [
        { key: 'momentumContrib', label: 'Momentum' },
        { key: 'rsContrib', label: 'Rel Strength' },
        { key: 'structureBonus', label: 'Structure' },
        { key: 'sectorBonus', label: 'Sector' },
        { key: 'smaProximityBonus', label: 'SMA Prox' },
        { key: 'smaCrossoverBonus', label: 'SMA Cross' },
        { key: 'accelBonus', label: 'Accel' },
        { key: 'consistencyBonus', label: 'Consistency' },
        { key: 'macdBonus', label: 'MACD' },
        { key: 'extensionPenalty', label: 'Extension' },
        { key: 'pullbackBonus', label: 'Pullback' },
        { key: 'rsiBonusPenalty', label: 'RSI' },
        { key: 'entryMultiplier', label: 'Entry Mult' },
    ];

    const entry = trade.entryBreakdown || {};
    const exit = trade.exitBreakdown || {};
    const delta = trade.breakdownDelta || {};

    let rows = '';
    for (const { key, label } of keys) {
        const eVal = entry[key] ?? '—';
        const xVal = exit[key] ?? '—';
        const dVal = delta[key];
        const dStr = dVal != null ? (dVal >= 0 ? '+' : '') + dVal.toFixed(2) : '—';
        const dClass = dVal > 0 ? 'positive' : dVal < 0 ? 'negative' : '';
        // Skip rows where both entry and exit are 0 or null
        if ((entry[key] ?? 0) === 0 && (exit[key] ?? 0) === 0) continue;
        rows += `<tr><td style="color:var(--text-muted)">${label}</td><td>${typeof eVal === 'number' ? eVal.toFixed(2) : eVal}</td><td>${typeof xVal === 'number' ? xVal.toFixed(2) : xVal}</td><td class="${dClass}">${dStr}</td></tr>`;
    }

    if (!rows) return '';
    return `<div class="attribution-table">
        <table class="data-table" style="font-size:11px">
            <thead><tr><th>Signal</th><th>Entry</th><th>Exit</th><th>Delta</th></tr></thead>
            <tbody>
                <tr style="font-weight:bold"><td>Composite</td><td>${trade.entryCompositeScore?.toFixed(1) ?? '—'}</td><td>${trade.exitCompositeScore?.toFixed(1) ?? '—'}</td><td class="${(trade.exitCompositeScore - trade.entryCompositeScore) >= 0 ? 'positive' : 'negative'}">${trade.entryCompositeScore != null && trade.exitCompositeScore != null ? fmtSign(Math.round((trade.exitCompositeScore - trade.entryCompositeScore) * 10) / 10, '') : '—'}</td></tr>
                ${rows}
            </tbody>
        </table>
    </div>`;
}

// ═══════════════════════════════════════════════════
// Charts
// ═══════════════════════════════════════════════════

function drawEquityCurve(canvasId, equityCurve, initialBalance) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = equityCurve.map(p => p.date);
    const values = equityCurve.map(p => p.value);

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Portfolio Value',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.1,
                pointRadius: 0,
                borderWidth: 2,
            }, {
                label: 'Initial Balance',
                data: labels.map(() => initialBalance),
                borderColor: '#4b5563',
                borderDash: [5, 5],
                pointRadius: 0,
                borderWidth: 1,
            }],
        },
        options: chartOptions('$'),
    });
}

function drawComparisonChart(canvasId, results) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Normalize all to % return from start
    const datasets = results
        .filter(r => r.equityCurve?.length > 0)
        .map((r, i) => {
            const initial = r.equityCurve[0]?.value || 1;
            return {
                label: r.strategy,
                data: r.equityCurve.map(p => ((p.value - initial) / initial * 100)),
                borderColor: COLORS[i % COLORS.length],
                tension: 0.1,
                pointRadius: 0,
                borderWidth: 2,
            };
        });

    // Use the longest curve's dates as labels
    const longest = results.reduce((a, b) => (a.equityCurve?.length || 0) > (b.equityCurve?.length || 0) ? a : b);
    const labels = (longest.equityCurve || []).map(p => p.date);

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: chartOptions('%'),
    });
}

function chartOptions(suffix) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        scales: {
            x: {
                ticks: { color: '#5a5e72', maxTicksLimit: 12, font: { size: 10 } },
                grid: { color: '#1a1d27' },
            },
            y: {
                ticks: {
                    color: '#5a5e72',
                    font: { size: 10 },
                    callback: v => suffix === '$' ? '$' + v.toLocaleString() : v.toFixed(1) + '%',
                },
                grid: { color: '#1a1d27' },
            },
        },
        plugins: {
            legend: { labels: { color: '#8b8fa3', font: { size: 11 } } },
            tooltip: {
                backgroundColor: '#1a1d27',
                borderColor: '#2a2e3f',
                borderWidth: 1,
                titleColor: '#e4e6ed',
                bodyColor: '#8b8fa3',
            },
        },
    };
}

function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function fmt(v, suffix = '') {
    if (v == null) return 'N/A';
    return v + suffix;
}

function fmtSign(v, suffix = '') {
    if (v == null) return 'N/A';
    return (v >= 0 ? '+' : '') + v + suffix;
}

function metricCard(label, value, isPositive, sub = '') {
    const cls = isPositive ? 'positive' : 'negative';
    return `<div class="metric-card">
        <div class="label">${label}</div>
        <div class="value ${cls}">${value}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;
}

function indexOfMax(arr) {
    let max = -Infinity, idx = -1;
    arr.forEach((v, i) => { if (v != null && v > max) { max = v; idx = i; } });
    return idx;
}

function indexOfMin(arr) {
    let min = Infinity, idx = -1;
    arr.forEach((v, i) => { if (v != null && v < min) { min = v; idx = i; } });
    return idx;
}

// ═══════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════

loadOverview();
