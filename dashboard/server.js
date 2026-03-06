import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const APEX_PORTFOLIO_PATH = join('/home/rdp06c/Apex/server/data/portfolio.json');
const PORT = 3000;

// --- Result loading ---

function listResults() {
    if (!existsSync(RESULTS_DIR)) return [];
    return readdirSync(RESULTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const data = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'));
                const m = data.metrics || {};
                return {
                    filename: f,
                    strategy: data.strategy || f.replace('.json', ''),
                    totalReturn: m.totalReturn,
                    sharpe: m.sharpe,
                    winRate: m.winRate,
                    totalTrades: m.totalTrades,
                    maxDrawdown: m.maxDrawdown,
                    profitFactor: m.profitFactor,
                    spyReturn: m.spyReturn,
                    startDate: m.equityCurve?.[0]?.date || null,
                    endDate: m.equityCurve?.[m.equityCurve.length - 1]?.date || null,
                };
            } catch {
                return { filename: f, error: true };
            }
        })
        .sort((a, b) => (a.filename > b.filename ? 1 : -1));
}

function loadResult(filename) {
    const filePath = join(RESULTS_DIR, filename);
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

// --- API handlers ---

function handleResults(res) {
    sendJSON(res, { results: listResults() });
}

function handleResult(res, filename) {
    const data = loadResult(filename);
    if (!data) return sendJSON(res, { error: 'Result not found' }, 404);
    sendJSON(res, data);
}

function handleComparison(res) {
    const all = listResults().filter(r => !r.error);
    // Keep only the latest run per strategy (last alphabetically = most recent dates)
    const latestByStrategy = new Map();
    for (const r of all) {
        latestByStrategy.set(r.strategy, r);
    }
    const results = [...latestByStrategy.values()];
    const details = results.map(r => {
        const data = loadResult(r.filename);
        return data ? { ...r, equityCurve: data.metrics?.equityCurve || [] } : r;
    });
    sendJSON(res, { results: details });
}

function handleMyTrades(res) {
    if (!existsSync(APEX_PORTFOLIO_PATH)) {
        return sendJSON(res, { error: 'APEX portfolio not found', path: APEX_PORTFOLIO_PATH }, 404);
    }
    try {
        const raw = JSON.parse(readFileSync(APEX_PORTFOLIO_PATH, 'utf8'));
        const transactions = raw.transactions || [];
        const closedTrades = raw.closedTrades || [];
        const holdings = raw.holdings || {};
        const initialBalance = raw.initialBalance || 1000;

        // Reconstruct equity curve from transactions
        // Group transactions by date, compute cumulative cash + holdings value
        const txByDate = {};
        for (const tx of transactions) {
            const date = tx.timestamp.split('T')[0];
            if (!txByDate[date]) txByDate[date] = [];
            txByDate[date].push(tx);
        }

        // Compute summary metrics from closed trades
        const wins = closedTrades.filter(t => t.profitLoss > 0);
        const losses = closedTrades.filter(t => t.profitLoss <= 0);
        const totalPL = closedTrades.reduce((s, t) => s + (t.profitLoss || 0), 0);
        const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length * 100) : 0;
        const avgWinner = wins.length > 0 ? wins.reduce((s, t) => s + t.returnPercent, 0) / wins.length : 0;
        const avgLoser = losses.length > 0 ? losses.reduce((s, t) => s + t.returnPercent, 0) / losses.length : 0;
        const grossWins = wins.reduce((s, t) => s + t.profitLoss, 0);
        const grossLosses = Math.abs(losses.reduce((s, t) => s + t.profitLoss, 0));
        const profitFactor = grossLosses > 0 ? Math.round(grossWins / grossLosses * 100) / 100 : null;
        const avgHoldMs = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + (t.holdTime || 0), 0) / closedTrades.length : 0;
        const avgHoldDays = Math.round(avgHoldMs / 86400000 * 10) / 10;

        // First and last trade dates
        const firstDate = transactions.length > 0 ? transactions[0].timestamp.split('T')[0] : null;
        const lastDate = transactions.length > 0 ? transactions[transactions.length - 1].timestamp.split('T')[0] : null;

        sendJSON(res, {
            initialBalance,
            cash: raw.cash,
            holdings,
            closedTrades,
            transactions,
            firstDate,
            lastDate,
            metrics: {
                totalTrades: closedTrades.length,
                openPositions: Object.keys(holdings).length,
                totalPL: Math.round(totalPL * 100) / 100,
                winRate: Math.round(winRate * 100) / 100,
                avgWinner: Math.round(avgWinner * 100) / 100,
                avgLoser: Math.round(avgLoser * 100) / 100,
                profitFactor,
                avgHoldDays,
            },
        });
    } catch (err) {
        sendJSON(res, { error: 'Failed to parse APEX portfolio: ' + err.message }, 500);
    }
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

function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

// --- Router ---

const server = createServer((req, res) => {
    const [urlPath] = req.url.split('?');

    // API routes
    if (urlPath === '/api/results') return handleResults(res);
    if (urlPath === '/api/comparison') return handleComparison(res);
    if (urlPath === '/api/my-trades') return handleMyTrades(res);

    const resultMatch = urlPath.match(/^\/api\/result\/(.+\.json)$/);
    if (resultMatch) return handleResult(res, decodeURIComponent(resultMatch[1]));

    // Static files
    if (urlPath === '/' || urlPath === '/index.html') return serveStatic(res, 'index.html');
    if (urlPath === '/style.css') return serveStatic(res, 'style.css');
    if (urlPath === '/js/app.js') return serveStatic(res, 'js/app.js');

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`FORGE Backtester Dashboard at http://localhost:${PORT}`);
});
