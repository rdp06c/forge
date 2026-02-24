// FORGE Dashboard — Charts: Value, Win Rate, F7 Adherence, F8 Duration, F1 Regime Shading

// F1: Build regime background annotations from regime timeline
function buildRegimeAnnotations(regimeTimeline) {
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

FORGE.renderCharts = async function() {
    const names = FORGE.AGENT_NAMES;
    const allCharts = await Promise.all(names.map(async n => {
        const res = await fetch(`/api/agent/${n}/charts`);
        return res.json();
    }));

    // Merge all regime timelines for consistent shading
    let longestTimeline = [];
    for (const c of allCharts) {
        if ((c.regimeTimeline?.length || 0) > longestTimeline.length) {
            longestTimeline = c.regimeTimeline;
        }
    }
    const regimeAnnotations = buildRegimeAnnotations(longestTimeline);

    // --- Value chart ---
    const hasValueData = allCharts.some(c => c.valueSeries?.length > 2);
    document.getElementById('value-chart-empty').style.display = hasValueData ? 'none' : '';
    document.getElementById('value-chart').style.display = hasValueData ? '' : 'none';

    if (hasValueData) {
        if (FORGE.charts.valueChart) FORGE.charts.valueChart.destroy();
        const datasets = allCharts.map((c, i) => ({
            label: names[i],
            data: (c.valueSeries || []).map(p => ({ x: p.t, y: p.v })),
            borderColor: FORGE.AGENT_COLORS[names[i]],
            backgroundColor: FORGE.AGENT_COLORS[names[i]] + '20',
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
        }));
        datasets.push({
            label: '$50K Baseline',
            data: allCharts[0]?.valueSeries?.length ? [
                { x: allCharts[0].valueSeries[0].t, y: 50000 },
                { x: allCharts[0].valueSeries[allCharts[0].valueSeries.length - 1].t, y: 50000 }
            ] : [],
            borderColor: '#4b5563',
            borderDash: [6, 3],
            borderWidth: 1,
            pointRadius: 0,
        });

        FORGE.charts.valueChart = new Chart(document.getElementById('value-chart'), {
            type: 'line',
            data: { datasets },
            options: FORGE.chartOptions('$', regimeAnnotations),
        });
    }

    // --- Win rate chart ---
    const hasWinData = allCharts.some(c => c.winRateSeries?.length > 2);
    document.getElementById('winrate-chart-empty').style.display = hasWinData ? 'none' : '';
    document.getElementById('winrate-chart').style.display = hasWinData ? '' : 'none';

    if (hasWinData) {
        if (FORGE.charts.winRateChart) FORGE.charts.winRateChart.destroy();
        const datasets = allCharts.map((c, i) => ({
            label: names[i],
            data: (c.winRateSeries || []).map(p => ({ x: p.t, y: p.v })),
            borderColor: FORGE.AGENT_COLORS[names[i]],
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
        }));
        const allWinX = allCharts.flatMap(c => (c.winRateSeries || []).map(p => p.t));
        if (allWinX.length >= 2) {
            datasets.push({
                label: '50% Line',
                data: [{ x: allWinX[0], y: 50 }, { x: allWinX[allWinX.length - 1], y: 50 }],
                borderColor: '#4b5563',
                borderDash: [6, 3],
                borderWidth: 1,
                pointRadius: 0,
            });
        }

        FORGE.charts.winRateChart = new Chart(document.getElementById('winrate-chart'), {
            type: 'line',
            data: { datasets },
            options: FORGE.chartOptions('%', regimeAnnotations),
        });
    }

    // --- F7: Adherence chart ---
    const hasAdherenceData = allCharts.some(c => c.adherenceSeries?.length > 2);
    document.getElementById('adherence-chart-empty').style.display = hasAdherenceData ? 'none' : '';
    document.getElementById('adherence-chart').style.display = hasAdherenceData ? '' : 'none';

    if (hasAdherenceData) {
        if (FORGE.charts.adherenceChart) FORGE.charts.adherenceChart.destroy();
        const datasets = allCharts.map((c, i) => ({
            label: names[i],
            data: (c.adherenceSeries || []).map(p => ({ x: p.t, y: p.v })),
            borderColor: FORGE.AGENT_COLORS[names[i]],
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
        }));
        const allAdhX = allCharts.flatMap(c => (c.adherenceSeries || []).map(p => p.t));
        if (allAdhX.length >= 2) {
            datasets.push({
                label: '100% Line',
                data: [{ x: allAdhX[0], y: 100 }, { x: allAdhX[allAdhX.length - 1], y: 100 }],
                borderColor: '#4b5563',
                borderDash: [6, 3],
                borderWidth: 1,
                pointRadius: 0,
            });
        }

        FORGE.charts.adherenceChart = new Chart(document.getElementById('adherence-chart'), {
            type: 'line',
            data: { datasets },
            options: FORGE.chartOptions('%', regimeAnnotations),
        });
    }

    // --- F8: Duration distribution chart ---
    await renderDurationChart();
};

async function renderDurationChart() {
    try {
        const res = await fetch('/api/duration-distribution');
        const data = await res.json();
        const dists = data.distributions || {};
        const agents = data.agents || FORGE.AGENT_NAMES;
        const bins = ['1d', '2-3d', '4-7d', '1-2w', '2w+'];

        const hasData = agents.some(name => bins.some(b => (dists[name]?.[b] || 0) > 0));
        document.getElementById('duration-chart-empty').style.display = hasData ? 'none' : '';
        document.getElementById('duration-chart').style.display = hasData ? '' : 'none';

        if (!hasData) return;

        if (FORGE.charts.durationChart) FORGE.charts.durationChart.destroy();

        const datasets = agents.map(name => ({
            label: name,
            data: bins.map(b => dists[name]?.[b] || 0),
            backgroundColor: FORGE.AGENT_COLORS[name] + 'CC',
            borderColor: FORGE.AGENT_COLORS[name],
            borderWidth: 1,
        }));

        FORGE.charts.durationChart = new Chart(document.getElementById('duration-chart'), {
            type: 'bar',
            data: { labels: bins, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#8b8fa3', font: { family: 'inherit', size: 11 } }
                    },
                },
                scales: {
                    x: {
                        ticks: { color: '#5a5e72', font: { size: 10 } },
                        grid: { color: '#1f2233' },
                    },
                    y: {
                        ticks: { color: '#5a5e72', font: { size: 10 }, stepSize: 1 },
                        grid: { color: '#1f2233' },
                        title: { display: true, text: 'Trades', color: '#5a5e72', font: { size: 10 } },
                    }
                }
            },
        });
    } catch (e) {
        console.error('Failed to load duration distribution:', e);
    }
}
