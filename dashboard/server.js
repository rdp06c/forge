import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORTFOLIOS_DIR = join(__dirname, '..', 'portfolios');
const PORT = 3000;

// Agent metadata (inline to avoid importing ESM config with side-effect risk)
const AGENT_META = {
    Ember:  { fullName: 'Ember — The Patience Agent', color: '#f59e0b', thesis: 'Does extreme selectivity with a simplified decision model outperform APEX\'s complex multi-factor approach?', description: 'Stripped-down 3-factor model: catalyst strength, technical structure, sector context. Only trades at 10/10 conviction.', framework: '3-factor-only', entryFramework: 'custom', exitFramework: 'apex' },
    Strike: { fullName: 'Strike — The Early Exit Agent', color: '#ef4444', thesis: 'Is APEX\'s profit-taking framework leaving money on the table?', description: 'Full APEX entry, mechanical exit at 55% of expected move.', framework: 'apex-entry-mechanical-exit', entryFramework: 'apex', exitFramework: 'mechanical' },
    Flux:   { fullName: 'Flux — The Contrarian', color: '#a855f7', thesis: 'Is there genuine edge in fading overextended moves?', description: 'Inverts APEX entry logic. Enters fades when RS >85, momentum 8+, and reversal signs present.', framework: 'overextension-first', entryFramework: 'custom', exitFramework: 'tight-stop' },
    Draft:  { fullName: 'Draft — The Volume Agent', color: '#3b82f6', thesis: 'Should volume confirmation be a hard gate rather than a minor weighted factor?', description: 'Full APEX framework + hard volume gate. 1.5x ADV on breakouts, <0.7x on pullbacks.', framework: 'apex-plus-volume-gate', entryFramework: 'apex', exitFramework: 'apex' },
    Alloy:  { fullName: 'Alloy — The Setup Purist', color: '#22c55e', thesis: 'Does deep specialization in Bullish BOS produce a sharper edge than APEX\'s multi-setup approach?', description: 'Full APEX framework applied exclusively to Bullish BOS setups.', framework: 'apex-bos-only', entryFramework: 'apex', exitFramework: 'apex' },
};
const AGENT_NAMES = Object.keys(AGENT_META);

// --- Portfolio loading ---

function loadPortfolio(name) {
    const filePath = join(PORTFOLIOS_DIR, `FORGE_${name}_Portfolio.json`);
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

// --- Computed metrics ---

function computeMetrics(portfolio) {
    if (!portfolio) return null;

    const perf = portfolio.performanceHistory || [];
    const closed = portfolio.closedTrades || [];
    const txns = portfolio.transactions || [];
    const holdings = portfolio.holdings || {};
    const theses = portfolio.holdingTheses || {};

    // Portfolio value from last performance snapshot
    const lastSnap = perf.length > 0 ? perf[perf.length - 1] : null;
    const value = lastSnap ? lastSnap.value : portfolio.initialBalance;
    const cash = portfolio.cash;
    const deployedPct = lastSnap && lastSnap.value > 0
        ? ((1 - cash / lastSnap.value) * 100)
        : (value > 0 ? ((1 - cash / value) * 100) : 0);

    // Win rate
    const wins = closed.filter(t => t.profitLoss > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length * 100) : null;

    // Thesis adherence
    const qualified = closed.filter(t => t.forgeMetadata?.thesisQualified === true).length;
    const adherence = closed.length > 0 ? (qualified / closed.length * 100) : null;

    // Total P&L
    const totalPL = closed.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const totalReturnPct = portfolio.initialBalance > 0
        ? ((value - portfolio.initialBalance) / portfolio.initialBalance * 100)
        : 0;

    // Today's activity — match most recent transaction date
    let todayTrades = [];
    if (txns.length > 0) {
        const lastDate = txns[txns.length - 1].timestamp?.substring(0, 10);
        todayTrades = txns.filter(t => t.timestamp?.substring(0, 10) === lastDate);
    }

    // Open positions
    const positions = Object.entries(holdings).map(([symbol, shares]) => {
        const thesis = theses[symbol] || {};
        const entryDate = thesis.entryDate || null;
        const daysHeld = entryDate
            ? Math.floor((Date.now() - new Date(entryDate).getTime()) / 86400000)
            : null;
        return {
            symbol,
            shares,
            entryPrice: thesis.entryPrice || null,
            conviction: thesis.entryConviction || null,
            entryDate,
            daysHeld,
            entryRS: thesis.entryRS || null,
            entryRSI: thesis.entryRSI || null,
            entryStructure: thesis.entryStructure || null,
        };
    });

    // Regime and VIX
    const regime = portfolio.lastMarketRegime?.regime || null;
    const vix = portfolio.lastVIX || null;

    return {
        value: Math.round(value * 100) / 100,
        cash: Math.round(cash * 100) / 100,
        deployedPct: Math.round(deployedPct * 10) / 10,
        totalPL: Math.round(totalPL * 100) / 100,
        totalReturnPct: Math.round(totalReturnPct * 100) / 100,
        winRate: winRate !== null ? Math.round(winRate * 10) / 10 : null,
        adherence: adherence !== null ? Math.round(adherence * 10) / 10 : null,
        closedTradeCount: closed.length,
        openPositionCount: positions.length,
        positions,
        todayTrades,
        regime,
        vix,
        cycleId: portfolio.cycleId,
        lastUpdated: lastSnap?.timestamp || null,
    };
}

function buildChartData(portfolio) {
    if (!portfolio) return null;

    const perf = portfolio.performanceHistory || [];
    const closed = portfolio.closedTrades || [];
    const regimeHist = portfolio.regimeHistory || [];

    // Performance history time series
    const valueSeries = perf.map(p => ({ t: p.timestamp, v: p.value, regime: p.regime }));

    // Running win rate over closed trades
    let wins = 0;
    const winRateSeries = closed.map((trade, i) => {
        if (trade.profitLoss > 0) wins++;
        return {
            t: trade.sellDate || trade.buyDate,
            v: Math.round((wins / (i + 1)) * 1000) / 10,
        };
    });

    // Regime timeline
    const regimeTimeline = regimeHist.length > 0
        ? regimeHist.map(r => ({ t: r.timestamp, regime: r.regime }))
        : perf.map(p => ({ t: p.timestamp, regime: p.regime }));

    return { valueSeries, winRateSeries, regimeTimeline };
}

// --- API handlers ---

function handleAgents(res) {
    const agents = AGENT_NAMES.map(name => {
        const portfolio = loadPortfolio(name);
        const metrics = computeMetrics(portfolio);
        return {
            name,
            ...AGENT_META[name],
            metrics,
            error: portfolio === null ? 'Portfolio not found or malformed' : null,
        };
    });
    sendJSON(res, { agents, timestamp: new Date().toISOString() });
}

function handleAgentDetail(res, name) {
    const meta = AGENT_META[name];
    if (!meta) return sendJSON(res, { error: `Unknown agent: ${name}` }, 404);

    const portfolio = loadPortfolio(name);
    if (!portfolio) return sendJSON(res, { error: `Portfolio not found for ${name}` }, 404);

    const metrics = computeMetrics(portfolio);
    sendJSON(res, {
        name,
        ...meta,
        metrics,
        closedTrades: portfolio.closedTrades || [],
        holdingTheses: portfolio.holdingTheses || {},
        transactions: portfolio.transactions || [],
        regimeHistory: portfolio.regimeHistory || [],
        sectorRotation: portfolio.lastSectorRotation || null,
    });
}

function handleAgentCharts(res, name) {
    const meta = AGENT_META[name];
    if (!meta) return sendJSON(res, { error: `Unknown agent: ${name}` }, 404);

    const portfolio = loadPortfolio(name);
    if (!portfolio) return sendJSON(res, { error: `Portfolio not found for ${name}` }, 404);

    const charts = buildChartData(portfolio);
    sendJSON(res, { name, ...charts });
}

// --- Static file serving ---

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
};

function serveStatic(res, filename) {
    const filePath = join(__dirname, filename);
    if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const ext = extname(filename);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
}

// --- Helpers ---

function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// --- Router ---

const server = createServer((req, res) => {
    const url = req.url.split('?')[0];

    // API routes
    if (url === '/api/agents') return handleAgents(res);

    const agentDetailMatch = url.match(/^\/api\/agent\/(\w+)$/);
    if (agentDetailMatch) return handleAgentDetail(res, agentDetailMatch[1]);

    const agentChartsMatch = url.match(/^\/api\/agent\/(\w+)\/charts$/);
    if (agentChartsMatch) return handleAgentCharts(res, agentChartsMatch[1]);

    // Static files
    if (url === '/' || url === '/index.html') return serveStatic(res, 'index.html');
    if (url === '/style.css') return serveStatic(res, 'style.css');

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`FORGE Dashboard running at http://0.0.0.0:${PORT}`);
});
