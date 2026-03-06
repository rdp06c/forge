import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
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
