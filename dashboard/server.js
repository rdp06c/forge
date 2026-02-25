import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORTFOLIOS_DIR = join(__dirname, '..', 'portfolios');
const PORT = 3000;

// Stock sectors — loaded for sector heatmap and compare features
let stockSectors = {};
try {
    const constantsPath = join(__dirname, '..', 'config', 'constants.js');
    const mod = await import('file://' + constantsPath.replace(/\\/g, '/'));
    stockSectors = mod.stockSectors || {};
} catch { /* falls back to closedTrades.sector field */ }

// Agent metadata (inline to avoid importing ESM config with side-effect risk)
const AGENT_META = {
    Ember:  { fullName: 'Ember — The Patience Agent', color: '#f59e0b', thesis: 'Does extreme selectivity with a simplified decision model outperform APEX\'s complex multi-factor approach?', description: 'Stripped-down 3-factor model: catalyst strength, technical structure, sector context. Only trades at 10/10 conviction.', framework: '3-factor-only', entryFramework: 'custom', exitFramework: 'apex' },
    Strike: { fullName: 'Strike — The Early Exit Agent', color: '#ef4444', thesis: 'Is APEX\'s profit-taking framework leaving money on the table?', description: 'Full APEX entry, mechanical exit at 55% of expected move.', framework: 'apex-entry-mechanical-exit', entryFramework: 'apex', exitFramework: 'mechanical' },
    Flux:   { fullName: 'Flux — The Dip Buyer', color: '#a855f7', thesis: 'Is APEX\'s momentum bias causing him to miss recoverable pullbacks?', description: 'Buys stocks down 8-25% over 5 days showing stabilization signs. Tests whether APEX\'s decline penalties filter out valid recoveries.', framework: 'pullback-first', entryFramework: 'custom', exitFramework: 'apex' },
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

function loadAllPortfolios() {
    const portfolios = {};
    for (const name of AGENT_NAMES) {
        portfolios[name] = loadPortfolio(name);
    }
    return portfolios;
}

// --- Computed metrics ---

function computeMetrics(portfolio) {
    if (!portfolio) return null;

    const perf = portfolio.performanceHistory || [];
    const closed = portfolio.closedTrades || [];
    const txns = portfolio.transactions || [];
    const holdings = portfolio.holdings || {};
    const theses = portfolio.holdingTheses || {};

    const lastSnap = perf.length > 0 ? perf[perf.length - 1] : null;
    const value = lastSnap ? lastSnap.value : portfolio.initialBalance;
    const cash = portfolio.cash;
    const deployedPct = lastSnap && lastSnap.value > 0
        ? ((1 - cash / lastSnap.value) * 100)
        : (value > 0 ? ((1 - cash / value) * 100) : 0);

    const wins = closed.filter(t => t.profitLoss > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length * 100) : null;

    const qualified = closed.filter(t => t.forgeMetadata?.thesisQualified === true).length;
    const adherence = closed.length > 0 ? (qualified / closed.length * 100) : null;

    const totalPL = closed.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const totalReturnPct = portfolio.initialBalance > 0
        ? ((value - portfolio.initialBalance) / portfolio.initialBalance * 100)
        : 0;

    let todayTrades = [];
    if (txns.length > 0) {
        const lastDate = txns[txns.length - 1].timestamp?.substring(0, 10);
        todayTrades = txns.filter(t => t.timestamp?.substring(0, 10) === lastDate);
    }

    const positions = Object.entries(holdings).map(([symbol, shares]) => {
        const thesis = theses[symbol] || {};
        const entryDate = thesis.entryDate || null;
        const daysHeld = entryDate
            ? Math.floor((Date.now() - new Date(entryDate).getTime()) / 86400000)
            : null;
        return {
            symbol, shares,
            entryPrice: thesis.entryPrice || null,
            conviction: thesis.entryConviction || null,
            entryDate, daysHeld,
            entryRS: thesis.entryRS || null,
            entryRSI: thesis.entryRSI || null,
            entryStructure: thesis.entryStructure || null,
        };
    });

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
        regime, vix,
        cycleId: portfolio.cycleId,
        lastUpdated: lastSnap?.timestamp || null,
    };
}

function buildChartData(portfolio) {
    if (!portfolio) return null;

    const perf = portfolio.performanceHistory || [];
    const closed = portfolio.closedTrades || [];
    const regimeHist = portfolio.regimeHistory || [];

    const valueSeries = perf.map(p => ({ t: p.timestamp, v: p.value, regime: p.regime }));

    let wins = 0;
    const winRateSeries = closed.map((trade, i) => {
        if (trade.profitLoss > 0) wins++;
        return {
            t: trade.sellDate || trade.buyDate,
            v: Math.round((wins / (i + 1)) * 1000) / 10,
        };
    });

    // F7: Adherence timeline — running thesis adherence over closed trades
    let qualifiedCount = 0;
    const adherenceSeries = closed.map((trade, i) => {
        if (trade.forgeMetadata?.thesisQualified === true) qualifiedCount++;
        return {
            t: trade.sellDate || trade.buyDate,
            v: Math.round((qualifiedCount / (i + 1)) * 1000) / 10,
        };
    });

    const regimeTimeline = regimeHist.length > 0
        ? regimeHist.map(r => ({ t: r.timestamp, regime: r.regime }))
        : perf.map(p => ({ t: p.timestamp, regime: p.regime }));

    return { valueSeries, winRateSeries, adherenceSeries, regimeTimeline };
}

// --- New computation functions ---

// F5: Group closed trades by setup type
function computeSetupEffectiveness(closedTrades) {
    const groups = {};
    for (const t of closedTrades) {
        const et = t.entryTechnicals || {};
        let setupType = et.structure || 'Unknown';
        if (et.bos && et.bosType) setupType += ` + ${et.bosType} BOS`;
        else if (et.choch && et.chochType) setupType += ` + ${et.chochType} CHoCH`;

        if (!groups[setupType]) groups[setupType] = { trades: 0, wins: 0, totalReturn: 0 };
        groups[setupType].trades++;
        if (t.profitLoss > 0) groups[setupType].wins++;
        groups[setupType].totalReturn += t.returnPercent || 0;
    }

    return Object.entries(groups)
        .map(([setup, g]) => ({
            setup,
            trades: g.trades,
            wins: g.wins,
            winRate: g.trades > 0 ? Math.round(g.wins / g.trades * 1000) / 10 : 0,
            avgReturn: g.trades > 0 ? Math.round(g.totalReturn / g.trades * 100) / 100 : 0,
        }))
        .sort((a, b) => b.trades - a.trades);
}

// F9: Risk metrics from perf history and closed trades
function computeRiskMetrics(portfolio) {
    const perf = portfolio?.performanceHistory || [];
    const closed = portfolio?.closedTrades || [];

    // Max drawdown from perfHistory
    let maxDrawdown = 0;
    let peak = 0;
    for (const p of perf) {
        if (p.value > peak) peak = p.value;
        const dd = peak > 0 ? (peak - p.value) / peak * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe ratio from daily returns (annualized)
    let sharpe = null;
    if (perf.length > 2) {
        const returns = [];
        for (let i = 1; i < perf.length; i++) {
            if (perf[i - 1].value > 0) {
                returns.push((perf[i].value - perf[i - 1].value) / perf[i - 1].value);
            }
        }
        if (returns.length > 1) {
            const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
            const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
            const stdDev = Math.sqrt(variance);
            sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
        }
    }

    // Win/loss metrics
    const winners = closed.filter(t => t.profitLoss > 0);
    const losers = closed.filter(t => t.profitLoss < 0);

    const avgWinner = winners.length > 0
        ? winners.reduce((s, t) => s + t.returnPercent, 0) / winners.length : null;
    const avgLoser = losers.length > 0
        ? losers.reduce((s, t) => s + t.returnPercent, 0) / losers.length : null;
    const winLossRatio = losers.length > 0 && winners.length > 0
        ? Math.abs(avgWinner / avgLoser) : null;

    const grossProfit = winners.reduce((s, t) => s + t.profitLoss, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.profitLoss, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

    return {
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        sharpe: sharpe !== null ? Math.round(sharpe * 100) / 100 : null,
        winLossRatio: winLossRatio !== null ? Math.round(winLossRatio * 100) / 100 : null,
        avgWinner: avgWinner !== null ? Math.round(avgWinner * 100) / 100 : null,
        avgLoser: avgLoser !== null ? Math.round(avgLoser * 100) / 100 : null,
        profitFactor: profitFactor !== null ? Math.round(profitFactor * 100) / 100 : null,
    };
}

// F8: Bin hold times into 5 buckets
function computeDurationDistribution(closedTrades) {
    const bins = { '1d': 0, '2-3d': 0, '4-7d': 0, '1-2w': 0, '2w+': 0 };
    for (const t of closedTrades) {
        const days = t.holdTime ? Math.round(t.holdTime / 86400000) : 0;
        if (days <= 1) bins['1d']++;
        else if (days <= 3) bins['2-3d']++;
        else if (days <= 7) bins['4-7d']++;
        else if (days <= 14) bins['1-2w']++;
        else bins['2w+']++;
    }
    return bins;
}

// F4: Aggregate summary across all agents
function computeSummary(portfolios) {
    let aggregatePL = 0;
    let totalInitialBalance = 0;
    let totalDeployed = 0;
    let totalPositions = 0;
    let bestTrade = null;
    let worstTrade = null;
    const today = new Date().toISOString().substring(0, 10);

    for (const name of AGENT_NAMES) {
        const p = portfolios[name];
        if (!p) continue;
        const perf = p.performanceHistory || [];
        const lastSnap = perf.length > 0 ? perf[perf.length - 1] : null;
        const value = lastSnap ? lastSnap.value : p.initialBalance;
        const initial = p.initialBalance || 50000;

        aggregatePL += (value - initial);
        totalInitialBalance += initial;
        totalDeployed += (value - p.cash);
        totalPositions += Object.keys(p.holdings || {}).length;

        // Best/worst trade today (by sellDate)
        for (const t of (p.closedTrades || [])) {
            const sellDay = t.sellDate?.substring(0, 10);
            if (sellDay !== today) continue;
            if (!bestTrade || t.profitLoss > bestTrade.profitLoss) {
                bestTrade = { symbol: t.symbol, profitLoss: t.profitLoss, returnPercent: t.returnPercent, agent: name };
            }
            if (!worstTrade || t.profitLoss < worstTrade.profitLoss) {
                worstTrade = { symbol: t.symbol, profitLoss: t.profitLoss, returnPercent: t.returnPercent, agent: name };
            }
        }
    }

    const aggregateReturnPct = totalInitialBalance > 0
        ? Math.round(aggregatePL / totalInitialBalance * 10000) / 100
        : 0;

    // SPY baseline from any portfolio (all share the same baseline)
    let spyReturn = null;
    for (const name of AGENT_NAMES) {
        const p = portfolios[name];
        if (p?.spyBaseline?.price && p?.spyCurrent?.price) {
            spyReturn = {
                baseline: p.spyBaseline.price,
                current: p.spyCurrent.price,
                returnPct: Math.round((p.spyCurrent.price - p.spyBaseline.price) / p.spyBaseline.price * 10000) / 100,
                baselineDate: p.spyBaseline.date,
            };
            break;
        }
    }

    return {
        aggregatePL: Math.round(aggregatePL * 100) / 100,
        aggregateReturnPct,
        totalDeployed: Math.round(totalDeployed * 100) / 100,
        totalPositions,
        bestTrade,
        worstTrade,
        spyReturn,
    };
}

// --- API handlers ---

function handleAgents(res) {
    const portfolios = loadAllPortfolios();
    const agents = AGENT_NAMES.map(name => {
        const portfolio = portfolios[name];
        const metrics = computeMetrics(portfolio);
        return {
            name,
            ...AGENT_META[name],
            metrics,
            error: portfolio === null ? 'Portfolio not found or malformed' : null,
        };
    });
    const summary = computeSummary(portfolios);
    sendJSON(res, { agents, summary, timestamp: new Date().toISOString() });
}

function handleAgentDetail(res, name) {
    const meta = AGENT_META[name];
    if (!meta) return sendJSON(res, { error: `Unknown agent: ${name}` }, 404);

    const portfolio = loadPortfolio(name);
    if (!portfolio) return sendJSON(res, { error: `Portfolio not found for ${name}` }, 404);

    const metrics = computeMetrics(portfolio);
    const closedTrades = portfolio.closedTrades || [];

    sendJSON(res, {
        name,
        ...meta,
        metrics,
        closedTrades,
        holdingTheses: portfolio.holdingTheses || {},
        transactions: portfolio.transactions || [],
        regimeHistory: portfolio.regimeHistory || [],
        sectorRotation: portfolio.lastSectorRotation || null,
        setupEffectiveness: computeSetupEffectiveness(closedTrades),
        riskMetrics: computeRiskMetrics(portfolio),
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

// F2: Cross-agent comparison
function handleCompare(res, params) {
    const nameA = params.get('a');
    const nameB = params.get('b');

    if (!nameA || !nameB) return sendJSON(res, { error: 'Provide ?a=Name&b=Name' }, 400);
    if (!AGENT_META[nameA]) return sendJSON(res, { error: `Unknown agent: ${nameA}` }, 404);
    if (!AGENT_META[nameB]) return sendJSON(res, { error: `Unknown agent: ${nameB}` }, 404);

    function agentStats(name) {
        const portfolio = loadPortfolio(name);
        if (!portfolio) return null;
        const metrics = computeMetrics(portfolio);
        const closed = portfolio.closedTrades || [];

        // Avg hold duration
        let avgHoldDays = null;
        if (closed.length > 0) {
            const totalDays = closed.reduce((s, t) => s + (t.holdTime ? t.holdTime / 86400000 : 0), 0);
            avgHoldDays = Math.round(totalDays / closed.length * 10) / 10;
        }

        // Sector exposure (from closed trades + current holdings)
        const sectorCounts = {};
        for (const t of closed) {
            const sec = t.sector || 'Unknown';
            sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
        }
        for (const sym of Object.keys(portfolio.holdings || {})) {
            const sec = stockSectors[sym] || 'Unknown';
            sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
        }

        // Setup distribution
        const setupCounts = {};
        for (const t of closed) {
            const et = t.entryTechnicals || {};
            let setup = et.structure || 'Unknown';
            if (et.bos && et.bosType) setup += ` + ${et.bosType} BOS`;
            else if (et.choch && et.chochType) setup += ` + ${et.chochType} CHoCH`;
            setupCounts[setup] = (setupCounts[setup] || 0) + 1;
        }

        return {
            name,
            color: AGENT_META[name].color,
            returnPct: metrics?.totalReturnPct ?? 0,
            winRate: metrics?.winRate,
            avgHoldDays,
            closedTrades: closed.length,
            adherence: metrics?.adherence,
            deployedPct: metrics?.deployedPct ?? 0,
            sectorExposure: sectorCounts,
            setupDistribution: setupCounts,
        };
    }

    const a = agentStats(nameA);
    const b = agentStats(nameB);
    if (!a || !b) return sendJSON(res, { error: 'Could not load one or both portfolios' }, 404);

    sendJSON(res, { a, b });
}

// F6: Sector × agent P&L grid
function handleSectorHeatmap(res) {
    const portfolios = loadAllPortfolios();
    const grid = {}; // sector -> { agent -> totalPL }

    for (const name of AGENT_NAMES) {
        const p = portfolios[name];
        if (!p) continue;
        for (const t of (p.closedTrades || [])) {
            const sector = t.sector || 'Unknown';
            if (!grid[sector]) grid[sector] = {};
            grid[sector][name] = (grid[sector][name] || 0) + (t.profitLoss || 0);
        }
        // Include current holdings sectors (with 0 P&L for exposure visibility)
        for (const sym of Object.keys(p.holdings || {})) {
            const sector = stockSectors[sym] || 'Unknown';
            if (!grid[sector]) grid[sector] = {};
            if (grid[sector][name] === undefined) grid[sector][name] = 0;
        }
    }

    // Round values
    for (const sector of Object.keys(grid)) {
        for (const name of Object.keys(grid[sector])) {
            grid[sector][name] = Math.round(grid[sector][name] * 100) / 100;
        }
    }

    sendJSON(res, { grid, agents: AGENT_NAMES });
}

// F8: Duration distribution per agent
function handleDurationDistribution(res) {
    const portfolios = loadAllPortfolios();
    const result = {};
    for (const name of AGENT_NAMES) {
        const p = portfolios[name];
        result[name] = computeDurationDistribution(p?.closedTrades || []);
    }
    sendJSON(res, { distributions: result, agents: AGENT_NAMES });
}

// F10: All agents ranked
function handleLeaderboard(res) {
    const portfolios = loadAllPortfolios();
    const entries = AGENT_NAMES.map(name => {
        const p = portfolios[name];
        if (!p) return { name, color: AGENT_META[name].color, error: true };

        const metrics = computeMetrics(p);
        const risk = computeRiskMetrics(p);
        const perf = p.performanceHistory || [];

        // Sparkline data: last 10 performance values
        const sparkline = perf.slice(-10).map(s => s.value);

        return {
            name,
            color: AGENT_META[name].color,
            returnPct: metrics?.totalReturnPct ?? 0,
            winRate: metrics?.winRate,
            sharpe: risk.sharpe,
            adherence: metrics?.adherence,
            maxDrawdown: risk.maxDrawdown,
            closedTrades: metrics?.closedTradeCount ?? 0,
            sparkline,
        };
    });

    // Add SPY baseline for comparison
    let spyReturn = null;
    for (const name of AGENT_NAMES) {
        const p = portfolios[name];
        if (p?.spyBaseline?.price && p?.spyCurrent?.price) {
            spyReturn = Math.round((p.spyCurrent.price - p.spyBaseline.price) / p.spyBaseline.price * 10000) / 100;
            break;
        }
    }

    sendJSON(res, { entries, spyReturn });
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
    const [urlPath, queryString] = req.url.split('?');
    const params = new URLSearchParams(queryString || '');

    // API routes
    if (urlPath === '/api/agents') return handleAgents(res);
    if (urlPath === '/api/compare') return handleCompare(res, params);
    if (urlPath === '/api/sector-heatmap') return handleSectorHeatmap(res);
    if (urlPath === '/api/duration-distribution') return handleDurationDistribution(res);
    if (urlPath === '/api/leaderboard') return handleLeaderboard(res);

    const agentDetailMatch = urlPath.match(/^\/api\/agent\/(\w+)$/);
    if (agentDetailMatch) return handleAgentDetail(res, agentDetailMatch[1]);

    const agentChartsMatch = urlPath.match(/^\/api\/agent\/(\w+)\/charts$/);
    if (agentChartsMatch) return handleAgentCharts(res, agentChartsMatch[1]);

    // Static files
    if (urlPath === '/' || urlPath === '/index.html') return serveStatic(res, 'index.html');
    if (urlPath === '/style.css') return serveStatic(res, 'style.css');
    if (urlPath.startsWith('/js/') && urlPath.endsWith('.js')) return serveStatic(res, urlPath.substring(1));

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`FORGE Dashboard running at http://0.0.0.0:${PORT}`);
});
