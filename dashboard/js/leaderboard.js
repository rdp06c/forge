// FORGE Dashboard — F10: Agent Leaderboard

FORGE.renderLeaderboard = async function() {
    const container = document.getElementById('leaderboard-content');

    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        const entries = data.entries || [];

        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px">Leaderboard data appears as cycles run</div>';
            return;
        }

        container.innerHTML = `
        <div class="leaderboard-header">
            <h3>Agent Leaderboard</h3>
            <select id="leaderboard-sort" onchange="FORGE.sortLeaderboard()">
                <option value="returnPct">Sort by: Return %</option>
                <option value="winRate">Sort by: Win Rate</option>
                <option value="sharpe">Sort by: Sharpe</option>
                <option value="adherence">Sort by: Adherence</option>
            </select>
        </div>
        <div class="table-section">
            <div class="table-wrap">
                <table class="leaderboard-table" id="leaderboard-table">
                    <tr>
                        <th>#</th>
                        <th>Agent</th>
                        <th>Trend</th>
                        <th>Return %</th>
                        <th>Win Rate</th>
                        <th>Sharpe</th>
                        <th>Adherence</th>
                        <th>Drawdown</th>
                        <th>Trades</th>
                    </tr>
                </table>
            </div>
        </div>`;

        // Store entries and SPY baseline for sorting
        FORGE.state.leaderboardEntries = entries;
        FORGE.state.leaderboardSpyReturn = data.spyReturn;
        FORGE.sortLeaderboard();
    } catch (e) {
        container.innerHTML = '<div class="agent-error">Failed to load leaderboard</div>';
    }
};

FORGE.sortLeaderboard = function() {
    const entries = FORGE.state.leaderboardEntries || [];
    const sortKey = document.getElementById('leaderboard-sort')?.value || 'returnPct';

    // Sort descending (higher is better for all metrics)
    const sorted = [...entries].sort((a, b) => {
        const va = a[sortKey] ?? -Infinity;
        const vb = b[sortKey] ?? -Infinity;
        return vb - va;
    });

    const table = document.getElementById('leaderboard-table');
    if (!table) return;

    // Keep header, replace body
    const headerRow = table.querySelector('tr');
    table.innerHTML = '';
    table.appendChild(headerRow);

    sorted.forEach((entry, idx) => {
        if (entry.error) return;
        const tr = document.createElement('tr');
        tr.onclick = () => FORGE.openDetail(entry.name);

        const sparkId = `spark-${entry.name}`;
        tr.innerHTML = `
            <td class="leaderboard-rank">${idx + 1}</td>
            <td style="color:${entry.color};font-weight:600">${entry.name}</td>
            <td class="sparkline-cell"><canvas id="${sparkId}" width="80" height="30"></canvas></td>
            <td class="${entry.returnPct >= 0 ? 'positive' : 'negative'}">${entry.returnPct >= 0 ? '+' : ''}${entry.returnPct.toFixed(1)}%</td>
            <td>${entry.winRate != null ? entry.winRate + '%' : '--'}</td>
            <td>${entry.sharpe != null ? entry.sharpe.toFixed(2) : '--'}</td>
            <td>${entry.adherence != null ? entry.adherence + '%' : '--'}</td>
            <td class="${entry.maxDrawdown > 0 ? 'negative' : ''}">${entry.maxDrawdown > 0 ? entry.maxDrawdown + '%' : '--'}</td>
            <td>${entry.closedTrades}</td>`;
        table.appendChild(tr);

        // Draw sparkline after DOM insertion
        requestAnimationFrame(() => drawSparkline(sparkId, entry.sparkline, entry.color));
    });

    // SPY benchmark row
    const spyRet = FORGE.state.leaderboardSpyReturn;
    if (spyRet != null) {
        const spyTr = document.createElement('tr');
        spyTr.className = 'spy-baseline-row';
        spyTr.innerHTML = `
            <td class="leaderboard-rank">--</td>
            <td style="color:#888;font-weight:600">SPY</td>
            <td class="sparkline-cell"></td>
            <td class="${spyRet >= 0 ? 'positive' : 'negative'}">${spyRet >= 0 ? '+' : ''}${spyRet.toFixed(1)}%</td>
            <td colspan="5" style="color:#888;font-style:italic">Buy & hold baseline</td>`;
        table.appendChild(spyTr);
    }
};

function drawSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
        const x = padding + (i / (data.length - 1)) * (w - 2 * padding);
        const y = h - padding - ((data[i] - min) / range) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // End dot
    const lastX = w - padding;
    const lastY = h - padding - ((data[data.length - 1] - min) / range) * (h - 2 * padding);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
    ctx.fill();
}
