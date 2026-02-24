// FORGE Dashboard — F6: Sector P&L Heatmap

FORGE.renderHeatmap = async function() {
    const container = document.getElementById('heatmap-content');

    try {
        const res = await fetch('/api/sector-heatmap');
        const data = await res.json();
        const grid = data.grid || {};
        const agents = data.agents || FORGE.AGENT_NAMES;
        const sectors = Object.keys(grid).sort();

        if (sectors.length === 0) {
            container.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px">Sector heatmap data appears as trades close</div>';
            return;
        }

        // Find global max for color scaling
        let globalMax = 0;
        for (const sector of sectors) {
            for (const name of agents) {
                const val = Math.abs(grid[sector]?.[name] || 0);
                if (val > globalMax) globalMax = val;
            }
        }

        let html = `
        <div class="table-section">
            <h3>Sector P&L Heatmap</h3>
            <div class="table-wrap"><table class="heatmap-table">
                <tr>
                    <th>Sector</th>
                    ${agents.map(n => `<th style="color:${FORGE.AGENT_COLORS[n]}">${n}</th>`).join('')}
                    <th>Total</th>
                </tr>
                ${sectors.map(sector => {
                    let sectorTotal = 0;
                    const cells = agents.map(name => {
                        const val = grid[sector]?.[name] || 0;
                        sectorTotal += val;
                        const bg = cellColor(val, globalMax);
                        const sign = val >= 0 ? '+' : '';
                        const display = val === 0 ? '--' : `${sign}$${val.toFixed(0)}`;
                        return `<td style="background:${bg};color:${val === 0 ? 'var(--text-muted)' : val > 0 ? 'var(--green)' : 'var(--red)'}">${display}</td>`;
                    }).join('');

                    const totalBg = cellColor(sectorTotal, globalMax);
                    const totalSign = sectorTotal >= 0 ? '+' : '';
                    const totalDisplay = sectorTotal === 0 ? '--' : `${totalSign}$${sectorTotal.toFixed(0)}`;

                    return `<tr>
                        <td class="sector-label">${sector}</td>
                        ${cells}
                        <td style="background:${totalBg};color:${sectorTotal === 0 ? 'var(--text-muted)' : sectorTotal > 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">${totalDisplay}</td>
                    </tr>`;
                }).join('')}
            </table></div>
        </div>`;

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="agent-error">Failed to load sector heatmap</div>';
    }
};

function cellColor(value, globalMax) {
    if (value === 0 || globalMax === 0) return 'transparent';
    const intensity = Math.min(Math.abs(value) / globalMax, 1) * 0.25;
    if (value > 0) return `rgba(34, 197, 94, ${intensity})`;
    return `rgba(239, 68, 68, ${intensity})`;
}
