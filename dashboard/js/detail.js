// FORGE Dashboard — Agent Detail + F5: Setup Effectiveness + F9: Risk Metrics

FORGE.openDetail = async function(name) {
    FORGE.state.currentDetailAgent = name;
    document.getElementById('detail-tab').style.display = '';
    FORGE.showView('detail');

    const res = await fetch(`/api/agent/${name}`);
    const agent = await res.json();
    if (agent.error) {
        document.getElementById('detail-content').innerHTML = `<div class="agent-error">${agent.error}</div>`;
        return;
    }

    // Cache closed trades for modal
    FORGE.state.closedTradesCache[name] = agent.closedTrades || [];

    const m = agent.metrics;
    const chartRes = await fetch(`/api/agent/${name}/charts`);
    const chartData = await chartRes.json();

    let html = `
    <div class="detail-header" style="border-left: 3px solid ${FORGE.AGENT_COLORS[name]}">
        <h2>${agent.fullName}</h2>
        <div class="thesis">${agent.thesis}</div>
        <div class="desc">${agent.description}</div>
        <div style="margin-top:8px; font-size:12px; color:var(--text-muted)">
            Entry: ${agent.entryFramework} | Exit: ${agent.exitFramework} | Framework: ${agent.framework}
        </div>
    </div>

    <div class="detail-stats">
        <div class="detail-stat-card">
            <div class="stat-label">Value</div>
            <div class="stat-value">$${FORGE.fmt(m.value)}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Cash</div>
            <div class="stat-value">$${FORGE.fmt(m.cash)}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Deployed</div>
            <div class="stat-value">${m.deployedPct}%</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Return</div>
            <div class="stat-value ${m.totalReturnPct >= 0 ? 'positive' : 'negative'}">${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct}%</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value">${m.winRate !== null ? m.winRate + '%' : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Adherence</div>
            <div class="stat-value">${m.adherence !== null ? m.adherence + '%' : '--'}</div>
        </div>
    </div>`;

    // F9: Risk Metrics Panel
    const risk = agent.riskMetrics || {};
    html += `
    <div class="detail-stats">
        <div class="detail-stat-card">
            <div class="stat-label">Max Drawdown</div>
            <div class="stat-value ${risk.maxDrawdown > 0 ? 'negative' : ''}">${risk.maxDrawdown != null ? risk.maxDrawdown + '%' : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Sharpe Ratio</div>
            <div class="stat-value">${risk.sharpe != null ? risk.sharpe.toFixed(2) : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Win/Loss Ratio</div>
            <div class="stat-value">${risk.winLossRatio != null ? risk.winLossRatio.toFixed(2) : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Avg Winner</div>
            <div class="stat-value ${risk.avgWinner > 0 ? 'positive' : ''}">${risk.avgWinner != null ? '+' + risk.avgWinner + '%' : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Avg Loser</div>
            <div class="stat-value ${risk.avgLoser < 0 ? 'negative' : ''}">${risk.avgLoser != null ? risk.avgLoser + '%' : '--'}</div>
        </div>
        <div class="detail-stat-card">
            <div class="stat-label">Profit Factor</div>
            <div class="stat-value">${risk.profitFactor != null ? risk.profitFactor.toFixed(2) : '--'}</div>
        </div>
    </div>`;

    // Portfolio value chart
    html += `
    <div class="chart-box" style="margin-bottom:16px">
        <h3>${name} Portfolio Value</h3>
        <canvas id="detail-value-chart" height="200"></canvas>
    </div>`;

    // Open positions table
    if (m.positions.length > 0) {
        html += `<div class="table-section">
            <h3>Open Positions (${m.positions.length})</h3>
            <div class="table-wrap"><table class="data-table">
                <tr><th>Symbol</th><th>Shares</th><th>Entry</th><th>Conviction</th><th>Days Held</th><th>RS</th><th>RSI</th><th>Structure</th></tr>
                ${m.positions.map(p => `<tr>
                    <td><strong>${p.symbol}</strong></td>
                    <td>${p.shares}</td>
                    <td>$${p.entryPrice?.toFixed(2) || '?'}</td>
                    <td>${p.conviction || '?'}/10</td>
                    <td>${p.daysHeld ?? '--'}</td>
                    <td>${p.entryRS ?? '--'}</td>
                    <td>${p.entryRSI ?? '--'}</td>
                    <td>${p.entryStructure || '--'}</td>
                </tr>`).join('')}
            </table></div>
        </div>`;
    }

    // Closed trades table — with F3 modal on click
    const closed = agent.closedTrades || [];
    if (closed.length > 0) {
        html += `<div class="table-section">
            <h3>Closed Trades (${closed.length})</h3>
            <div class="table-wrap"><table class="data-table">
                <tr><th>Symbol</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Return</th><th>Hold</th><th>Exit Reason</th><th>Thesis</th><th>Notes</th></tr>
                ${closed.map((t, idx) => {
                    const holdDays = t.holdTime ? Math.round(t.holdTime / 86400000) : '--';
                    const exitReason = t.exitReason || 'unknown';
                    const qualified = t.forgeMetadata?.thesisQualified;
                    const notes = t.forgeMetadata?.thesisAdherenceNotes || '';
                    return `<tr class="clickable" onclick="FORGE.openTradeModal('${name}', ${idx})">
                        <td><strong>${t.symbol}</strong></td>
                        <td>$${t.buyPrice?.toFixed(2)}</td>
                        <td>$${t.sellPrice?.toFixed(2)}</td>
                        <td class="${t.profitLoss >= 0 ? 'positive' : 'negative'}">$${t.profitLoss?.toFixed(2)}</td>
                        <td class="${t.returnPercent >= 0 ? 'positive' : 'negative'}">${t.returnPercent >= 0 ? '+' : ''}${t.returnPercent?.toFixed(1)}%</td>
                        <td>${holdDays}d</td>
                        <td><span class="badge badge-${exitReason}">${exitReason.replace(/_/g, ' ')}</span></td>
                        <td>${qualified === true ? '<span class="badge badge-green">YES</span>' : qualified === false ? '<span class="badge badge-red">NO</span>' : '<span class="badge badge-gray">--</span>'}</td>
                        <td class="expandable" onclick="event.stopPropagation();this.classList.toggle('expanded')">${notes || '--'}</td>
                    </tr>`;
                }).join('')}
            </table></div>
        </div>`;
    } else {
        html += `<div class="table-section"><h3>Closed Trades</h3><div style="padding:20px;text-align:center" class="empty-state">No closed trades yet</div></div>`;
    }

    // F5: Setup Effectiveness table
    const setups = agent.setupEffectiveness || [];
    if (setups.length > 0) {
        html += `<div class="table-section">
            <h3>Setup Effectiveness</h3>
            <div class="table-wrap"><table class="data-table">
                <tr><th>Setup Type</th><th>Trades</th><th>Wins</th><th>Win Rate</th><th>Avg Return</th></tr>
                ${setups.map(s => `<tr>
                    <td>${s.setup}</td>
                    <td>${s.trades}</td>
                    <td>${s.wins}</td>
                    <td>${s.winRate}%</td>
                    <td class="${s.avgReturn >= 0 ? 'positive' : 'negative'}">${s.avgReturn >= 0 ? '+' : ''}${s.avgReturn}%</td>
                </tr>`).join('')}
            </table></div>
        </div>`;
    } else {
        html += `<div class="table-section"><h3>Setup Effectiveness</h3><div style="padding:20px;text-align:center" class="empty-state">Data appears as trades close</div></div>`;
    }

    document.getElementById('detail-content').innerHTML = html;

    // Render individual chart with regime annotations
    if (chartData.valueSeries?.length > 0) {
        const regimeAnnotations = buildDetailRegimeAnnotations(chartData.regimeTimeline);
        new Chart(document.getElementById('detail-value-chart'), {
            type: 'line',
            data: {
                datasets: [{
                    label: name,
                    data: chartData.valueSeries.map(p => ({ x: p.t, y: p.v })),
                    borderColor: FORGE.AGENT_COLORS[name],
                    backgroundColor: FORGE.AGENT_COLORS[name] + '20',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3,
                }, {
                    label: 'Baseline',
                    data: [
                        { x: chartData.valueSeries[0].t, y: 50000 },
                        { x: chartData.valueSeries[chartData.valueSeries.length - 1].t, y: 50000 }
                    ],
                    borderColor: '#4b5563',
                    borderDash: [6, 3],
                    borderWidth: 1,
                    pointRadius: 0,
                }]
            },
            options: FORGE.chartOptions('$', regimeAnnotations),
        });
    }
};

function buildDetailRegimeAnnotations(regimeTimeline) {
    if (!regimeTimeline || regimeTimeline.length === 0) return {};
    const colors = {
        bull: 'rgba(34, 197, 94, 0.06)',
        bear: 'rgba(239, 68, 68, 0.06)',
        choppy: 'rgba(234, 179, 8, 0.06)',
    };
    const annotations = {};
    let start = 0;
    for (let i = 1; i <= regimeTimeline.length; i++) {
        if (i === regimeTimeline.length || regimeTimeline[i].regime !== regimeTimeline[start].regime) {
            const regime = regimeTimeline[start].regime;
            if (regime && colors[regime]) {
                annotations[`regime_${start}`] = {
                    type: 'box',
                    xMin: regimeTimeline[start].t,
                    xMax: regimeTimeline[i - 1].t,
                    backgroundColor: colors[regime],
                    borderWidth: 0,
                };
            }
            start = i;
        }
    }
    return annotations;
}
