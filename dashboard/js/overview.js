// FORGE Dashboard — Daily Overview + F4: Summary Banner

FORGE.renderOverview = function() {
    renderSummaryBanner();
    renderAgentGrid();
};

function renderSummaryBanner() {
    const banner = document.getElementById('summary-banner');
    const data = FORGE.state.agentsData;
    if (!data?.summary) { banner.innerHTML = ''; return; }

    const s = data.summary;
    const plClass = s.aggregatePL >= 0 ? 'positive' : 'negative';
    const plSign = s.aggregatePL >= 0 ? '+' : '';

    let bestHtml = '--';
    if (s.bestTrade) {
        bestHtml = `<span class="positive">${s.bestTrade.symbol} +$${s.bestTrade.profitLoss.toFixed(2)}</span>`;
    }
    let worstHtml = '--';
    if (s.worstTrade) {
        worstHtml = `<span class="negative">${s.worstTrade.symbol} $${s.worstTrade.profitLoss.toFixed(2)}</span>`;
    }

    banner.innerHTML = `
    <div class="summary-banner">
        <div class="stat">
            <span class="stat-label">Aggregate P&L</span>
            <span class="stat-value ${plClass}">${plSign}$${FORGE.fmt(Math.abs(s.aggregatePL))}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Total Deployed</span>
            <span class="stat-value">$${FORGE.fmt(s.totalDeployed)}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Total Positions</span>
            <span class="stat-value">${s.totalPositions}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Best Trade Today</span>
            <span class="stat-value">${bestHtml}</span>
        </div>
        <div class="stat">
            <span class="stat-label">Worst Trade Today</span>
            <span class="stat-value">${worstHtml}</span>
        </div>
    </div>`;
}

function renderAgentGrid() {
    const grid = document.getElementById('agent-grid');
    const data = FORGE.state.agentsData;
    if (!data?.agents) { grid.innerHTML = '<div class="agent-error">Failed to load data</div>'; return; }

    grid.innerHTML = data.agents.map(agent => {
        if (agent.error || !agent.metrics) {
            return `<div class="agent-card" data-agent="${agent.name}">
                <div class="card-header"><h3>${agent.fullName || agent.name}</h3></div>
                <div class="agent-error">${agent.error || 'No data'}</div>
            </div>`;
        }
        const m = agent.metrics;
        return `<div class="agent-card" data-agent="${agent.name}" onclick="FORGE.openDetail('${agent.name}')">
            <div class="card-header">
                <h3>${agent.name}</h3>
                ${FORGE.winRateBadge(m.winRate)}
            </div>
            <div class="card-thesis">${agent.thesis}</div>
            <div class="card-stats">
                <div class="stat">
                    <span class="stat-label">Value</span>
                    <span class="stat-value">$${FORGE.fmt(m.value)}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Cash</span>
                    <span class="stat-value">$${FORGE.fmt(m.cash)}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Deployed</span>
                    <span class="stat-value">${m.deployedPct}%</span>
                </div>
            </div>
            <div class="card-stats">
                <div class="stat">
                    <span class="stat-label">Total P&L</span>
                    <span class="stat-value ${m.totalReturnPct >= 0 ? 'positive' : 'negative'}">
                        ${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct}%
                    </span>
                </div>
                <div class="stat">
                    <span class="stat-label">Closed</span>
                    <span class="stat-value">${m.closedTradeCount}</span>
                </div>
                <div class="stat">
                    <span class="stat-label">Adherence</span>
                    ${FORGE.adherenceBadge(m.adherence)}
                </div>
            </div>
            ${positionsList(m.positions)}
            ${activityList(m.todayTrades)}
        </div>`;
    }).join('');
}

function positionsList(positions) {
    if (!positions.length) return `<div class="positions-header">Positions</div><div class="empty-state">No positions — sitting flat</div>`;
    return `<div class="positions-header">Open Positions (${positions.length})</div>` +
        positions.map(p => `<div class="position-row">
            <span class="position-symbol">${p.symbol}</span>
            <span class="position-detail">${p.shares} sh @ $${p.entryPrice?.toFixed(2) || '?'}</span>
            <span class="position-detail">${p.daysHeld !== null ? p.daysHeld + 'd' : ''}</span>
            <span class="position-detail">C:${p.conviction || '?'}</span>
        </div>`).join('');
}

function activityList(trades) {
    if (!trades.length) return '';
    return `<div class="positions-header">Recent Activity</div>` +
        trades.map(t => `<div class="activity-row">
            <span class="activity-type ${t.type.toLowerCase()}">${t.type}</span>
            <span class="position-symbol">${t.symbol}</span>
            <span class="position-detail">${t.shares} sh @ $${t.price?.toFixed(2)}</span>
            <span class="activity-reasoning" onclick="this.classList.toggle('expanded')">${FORGE.truncate(t.reasoning, 60)}</span>
        </div>`).join('');
}
