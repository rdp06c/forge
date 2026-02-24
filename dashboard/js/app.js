// FORGE Dashboard — Shared state, navigation, data fetching, helpers
// Must be loaded first — defines window.FORGE namespace

window.FORGE = {
    state: {
        agentsData: null,
        currentDetailAgent: null,
        closedTradesCache: {}, // agent -> closedTrades[] for modal
    },
    charts: {
        valueChart: null,
        winRateChart: null,
        adherenceChart: null,
        durationChart: null,
    },
    AGENT_COLORS: {
        Ember: '#f59e0b', Strike: '#ef4444', Flux: '#a855f7',
        Draft: '#3b82f6', Alloy: '#22c55e'
    },
    AGENT_NAMES: ['Ember', 'Strike', 'Flux', 'Draft', 'Alloy'],
};

// --- Navigation ---

document.querySelectorAll('.nav button').forEach(btn => {
    btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'detail' && !FORGE.state.currentDetailAgent) return;
        FORGE.showView(view);
    });
});

FORGE.showView = function(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
    document.querySelector(`.nav button[data-view="${name}"]`)?.classList.add('active');
    if (name === 'charts') FORGE.renderCharts();
    if (name === 'compare') FORGE.renderCompare();
    if (name === 'heatmap') FORGE.renderHeatmap();
    if (name === 'leaderboard') FORGE.renderLeaderboard();
};

// --- Data fetching ---

FORGE.fetchData = async function() {
    try {
        const res = await fetch('/api/agents');
        FORGE.state.agentsData = await res.json();
        FORGE.renderOverview();
        FORGE.updateHeader();
    } catch (e) {
        console.error('Failed to fetch agents:', e);
    }
};

FORGE.updateHeader = function() {
    const data = FORGE.state.agentsData;
    if (!data?.agents?.length) return;
    const first = data.agents.find(a => a.metrics);
    if (!first?.metrics) return;

    const m = first.metrics;
    document.getElementById('cycle-id').textContent = m.cycleId || 'Cycle 1';

    const regimeBadge = document.getElementById('regime-badge');
    if (m.regime) {
        regimeBadge.textContent = m.regime.toUpperCase();
        regimeBadge.className = `badge badge-${m.regime}`;
    }

    if (m.vix) {
        document.getElementById('vix-level').textContent = m.vix.level?.toFixed(2) || '--';
    }

    if (m.lastUpdated) {
        const d = new Date(m.lastUpdated);
        document.getElementById('last-updated').textContent = d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const hoursSince = (Date.now() - d.getTime()) / 3600000;
        document.getElementById('stale-warning').style.display = hoursSince > 48 ? '' : 'none';
    }
};

// --- Helpers ---

FORGE.fmt = function(n) {
    if (n == null) return '--';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

FORGE.truncate = function(s, len) {
    if (!s) return '';
    return s.length > len ? s.substring(0, len) + '...' : s;
};

FORGE.winRateBadge = function(rate) {
    if (rate === null || rate === undefined) return '<span class="badge badge-gray">--</span>';
    if (rate >= 60) return `<span class="badge badge-green">${rate}% WR</span>`;
    if (rate >= 45) return `<span class="badge badge-yellow">${rate}% WR</span>`;
    return `<span class="badge badge-red">${rate}% WR</span>`;
};

FORGE.adherenceBadge = function(pct) {
    if (pct === null || pct === undefined) return '<span class="badge badge-gray">--</span>';
    if (pct >= 100) return `<span class="badge badge-green">${pct}%</span>`;
    if (pct >= 80) return `<span class="badge badge-yellow">${pct}%</span>`;
    return `<span class="badge badge-red">${pct}%</span>`;
};

FORGE.chartOptions = function(unit, annotations) {
    const opts = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                labels: { color: '#8b8fa3', font: { family: 'inherit', size: 11 } }
            },
            tooltip: {
                callbacks: {
                    label: ctx => `${ctx.dataset.label}: ${unit === '$' ? '$' + ctx.parsed.y.toLocaleString() : ctx.parsed.y.toFixed(1) + '%'}`
                }
            }
        },
        scales: {
            x: {
                type: 'category',
                ticks: { color: '#5a5e72', font: { size: 10 }, maxTicksLimit: 15 },
                grid: { color: '#1f2233' },
            },
            y: {
                ticks: {
                    color: '#5a5e72',
                    font: { size: 10 },
                    callback: v => unit === '$' ? '$' + v.toLocaleString() : v + '%'
                },
                grid: { color: '#1f2233' },
            }
        }
    };
    // F1: Regime background annotations
    if (annotations && Object.keys(annotations).length > 0) {
        opts.plugins.annotation = { annotations };
    }
    return opts;
};

// --- Init ---
FORGE.fetchData();
setInterval(FORGE.fetchData, 60000);
