// FORGE Dashboard — F2: Agent Comparison Mode

FORGE.renderCompare = function() {
    const container = document.getElementById('compare-content');
    const names = FORGE.AGENT_NAMES;

    container.innerHTML = `
    <div class="compare-controls">
        <select id="compare-a">
            ${names.map((n, i) => `<option value="${n}" ${i === 0 ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <span>vs</span>
        <select id="compare-b">
            ${names.map((n, i) => `<option value="${n}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <button class="detail-back" onclick="FORGE.loadComparison()" style="margin-bottom:0">Compare</button>
    </div>
    <div id="compare-results"></div>`;

    FORGE.loadComparison();
};

FORGE.loadComparison = async function() {
    const a = document.getElementById('compare-a').value;
    const b = document.getElementById('compare-b').value;
    const resultsDiv = document.getElementById('compare-results');

    if (a === b) {
        resultsDiv.innerHTML = '<div class="empty-state">Select two different agents to compare</div>';
        return;
    }

    try {
        const res = await fetch(`/api/compare?a=${a}&b=${b}`);
        const data = await res.json();
        if (data.error) {
            resultsDiv.innerHTML = `<div class="agent-error">${data.error}</div>`;
            return;
        }
        renderComparisonTable(data.a, data.b, resultsDiv);
    } catch (e) {
        resultsDiv.innerHTML = '<div class="agent-error">Failed to load comparison data</div>';
    }
};

function renderComparisonTable(a, b, container) {
    const metrics = [
        { label: 'Return %', key: 'returnPct', fmt: v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '--', higher: true },
        { label: 'Win Rate', key: 'winRate', fmt: v => v != null ? v + '%' : '--', higher: true },
        { label: 'Avg Hold (days)', key: 'avgHoldDays', fmt: v => v != null ? v + 'd' : '--', higher: false },
        { label: 'Closed Trades', key: 'closedTrades', fmt: v => v != null ? v : '--', higher: true },
        { label: 'Adherence', key: 'adherence', fmt: v => v != null ? v + '%' : '--', higher: true },
        { label: 'Deployed %', key: 'deployedPct', fmt: v => v != null ? v + '%' : '--', higher: null },
    ];

    let html = `
    <div class="table-section">
        <div class="table-wrap"><table class="compare-table">
            <tr>
                <th>Metric</th>
                <th style="color:${a.color}">${a.name}</th>
                <th style="color:${b.color}">${b.name}</th>
            </tr>
            ${metrics.map(m => {
                const va = a[m.key];
                const vb = b[m.key];
                let aClass = '', bClass = '';
                if (va != null && vb != null && m.higher !== null) {
                    if (m.higher ? va > vb : va < vb) { aClass = 'winner'; bClass = 'loser'; }
                    else if (m.higher ? vb > va : vb < va) { bClass = 'winner'; aClass = 'loser'; }
                }
                return `<tr>
                    <td>${m.label}</td>
                    <td class="${aClass}">${m.fmt(va)}</td>
                    <td class="${bClass}">${m.fmt(vb)}</td>
                </tr>`;
            }).join('')}
        </table></div>
    </div>`;

    // Sector exposure breakdown
    const allSectors = new Set([...Object.keys(a.sectorExposure || {}), ...Object.keys(b.sectorExposure || {})]);
    if (allSectors.size > 0) {
        html += `<div class="table-section">
            <h3>Sector Exposure (trade count)</h3>
            <div class="table-wrap"><table class="compare-table">
                <tr><th>Sector</th><th style="color:${a.color}">${a.name}</th><th style="color:${b.color}">${b.name}</th></tr>
                ${[...allSectors].sort().map(sec => {
                    const va = a.sectorExposure?.[sec] || 0;
                    const vb = b.sectorExposure?.[sec] || 0;
                    return `<tr><td>${sec}</td><td>${va}</td><td>${vb}</td></tr>`;
                }).join('')}
            </table></div>
        </div>`;
    }

    // Setup distribution
    const allSetups = new Set([...Object.keys(a.setupDistribution || {}), ...Object.keys(b.setupDistribution || {})]);
    if (allSetups.size > 0) {
        html += `<div class="table-section">
            <h3>Setup Distribution (trade count)</h3>
            <div class="table-wrap"><table class="compare-table">
                <tr><th>Setup</th><th style="color:${a.color}">${a.name}</th><th style="color:${b.color}">${b.name}</th></tr>
                ${[...allSetups].sort().map(setup => {
                    const va = a.setupDistribution?.[setup] || 0;
                    const vb = b.setupDistribution?.[setup] || 0;
                    return `<tr><td>${setup}</td><td>${va}</td><td>${vb}</td></tr>`;
                }).join('')}
            </table></div>
        </div>`;
    }

    if (allSectors.size === 0 && allSetups.size === 0) {
        html += '<div class="empty-state" style="text-align:center;padding:20px">Detailed comparison data appears as trades close</div>';
    }

    container.innerHTML = html;
}
