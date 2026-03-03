// Polygon API data fetching — ported from APEX trader.js for headless Node.js
// All functions take explicit parameters (no globals), use file cache, no DOM references
import { cache } from './cache.js';

export const POLYGON_BASE = 'https://api.polygon.io';
export const API_KEY = () => process.env.POLYGON_API_KEY;

// Cache TTLs
const MULTIDAY_CACHE_TTL = 4 * 60 * 60 * 1000;   // 4 hours
const TICKER_DETAILS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const SHORT_INTEREST_TTL = 24 * 60 * 60 * 1000;     // 24 hours
const NEWS_CACHE_TTL     = 60 * 60 * 1000;           // 1 hour
const VIX_CACHE_TTL      = 4 * 60 * 60 * 1000;      // 4 hours

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════
// Grouped Daily Bars — 40 trading days of OHLCV
// ═══════════════════════════════════════════════════
export async function fetchGroupedDailyBars(symbolSet) {
    // Check file cache
    const cached = cache.get('multiDayCache', MULTIDAY_CACHE_TTL);
    if (cached) {
        const hitCount = [...symbolSet].filter(s => cached[s]).length;
        const sampleSyms = [...symbolSet].filter(s => cached[s]).slice(0, 5);
        const avgBars = sampleSyms.length > 0
            ? sampleSyms.reduce((sum, s) => sum + (cached[s]?.length || 0), 0) / sampleSyms.length : 0;
        if (hitCount >= symbolSet.size * 0.8 && avgBars >= 35) {
            console.log(`  Cache hit: ${hitCount}/${symbolSet.size} stocks, avg ${Math.round(avgBars)} bars`);
            return cached;
        }
    }

    const multiDayCache = {};

    // Compute 40 most recent weekdays
    const tradingDates = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (tradingDates.length < 40) {
        d.setDate(d.getDate() - 1);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            tradingDates.push(`${yyyy}-${mm}-${dd}`);
        }
    }
    tradingDates.reverse();

    console.log(`  Fetching grouped daily bars for ${tradingDates.length} trading days...`);

    const BATCH = 20;
    let fetchedDates = 0, skippedDates = 0;

    for (let i = 0; i < tradingDates.length; i += BATCH) {
        const batch = tradingDates.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(async (dateStr) => {
            try {
                const response = await fetch(
                    `${POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${API_KEY()}`
                );
                if (!response.ok) return { dateStr, bars: [] };
                const data = await response.json();
                if (data.resultsCount === 0 || !data.results) return { dateStr, bars: [] };
                return { dateStr, bars: data.results };
            } catch (err) {
                console.warn(`  Grouped daily fetch failed for ${dateStr}:`, err.message);
                return { dateStr, bars: [] };
            }
        }));

        for (const { dateStr, bars } of batchResults) {
            if (bars.length === 0) { skippedDates++; continue; }
            fetchedDates++;
            for (const bar of bars) {
                if (!symbolSet.has(bar.T)) continue;
                if (!multiDayCache[bar.T]) multiDayCache[bar.T] = [];
                multiDayCache[bar.T].push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, t: bar.t });
            }
        }
    }

    // Sort bars by timestamp ascending
    for (const sym of Object.keys(multiDayCache)) {
        multiDayCache[sym].sort((a, b) => a.t - b.t);
    }

    console.log(`  Grouped daily bars: ${Object.keys(multiDayCache).length} stocks, ${fetchedDates} dates, ${skippedDates} holidays`);
    cache.set('multiDayCache', multiDayCache);
    return multiDayCache;
}

// ═══════════════════════════════════════════════════
// Bulk Snapshot — current prices for all tickers
// ═══════════════════════════════════════════════════
export async function fetchBulkSnapshot(symbols) {
    if (!API_KEY()) throw new Error('POLYGON_API_KEY not set');

    const tickerParam = symbols.join(',');
    const response = await fetch(
        `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerParam}&apiKey=${API_KEY()}`
    );
    const data = await response.json();

    if (!data || data.status !== 'OK' || !data.tickers || data.tickers.length === 0) {
        throw new Error('Bulk snapshot failed: ' + (data?.status || 'no data'));
    }

    const result = {};
    const rawSnapshot = {};

    for (const ticker of data.tickers) {
        const symbol = ticker.ticker;
        const day = ticker.day;
        const prevDay = ticker.prevDay;
        if (!day || !prevDay) continue;

        // FORGE always runs after market close — prefer regular session close
        const currentPrice = day.c || (ticker.lastTrade?.p) || day.l;
        const prevClose = prevDay.c;
        if (!currentPrice || currentPrice === 0 || !prevClose) continue;

        const change = currentPrice - prevClose;
        const changePercent = (change / prevClose) * 100;

        result[symbol] = {
            price: parseFloat(currentPrice),
            change: parseFloat(change),
            changePercent: parseFloat(changePercent),
            timestamp: new Date().toISOString(),
            volume: day.v || 0,
        };

        rawSnapshot[symbol] = ticker;
    }

    console.log(`  Bulk snapshot: ${Object.keys(result).length}/${symbols.length} tickers`);
    return { prices: result, rawSnapshot };
}

// ═══════════════════════════════════════════════════
// VIX
// ═══════════════════════════════════════════════════
export async function fetchVIX() {
    const cached = cache.get('vixCache', VIX_CACHE_TTL);
    if (cached) {
        console.log(`  VIX from cache: ${cached.level}`);
        return cached;
    }

    // Strategy: Try Polygon direct → Yahoo Finance ^VIX (free, no auth)

    // Attempt 1: Polygon direct VIX index (requires Indices add-on)
    try {
        const response = await fetch(
            `${POLYGON_BASE}/v3/snapshot/indices?ticker.any_of=I:VIX&apiKey=${API_KEY()}`
        );
        if (response.ok) {
            const data = await response.json();
            if (data.results?.length > 0) {
                const snap = data.results[0];
                const session = snap.session || {};
                const vixData = buildVixResult(snap.value, session.previous_close || snap.value);
                vixData.source = 'polygon';
                cache.set('vixCache', vixData);
                console.log(`  VIX: ${vixData.level.toFixed(1)} (${vixData.interpretation}, ${vixData.trend}) [polygon]`);
                return vixData;
            }
        }
    } catch { /* fall through */ }

    // Attempt 2: Yahoo Finance ^VIX chart endpoint (free, real spot VIX)
    try {
        const response = await fetch(
            'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d',
            { headers: { 'User-Agent': 'FORGE/1.0' } }
        );
        if (response.ok) {
            const data = await response.json();
            const meta = data.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
                const level = meta.regularMarketPrice;
                const prevClose = meta.chartPreviousClose || meta.previousClose || level;
                const vixData = buildVixResult(level, prevClose);
                vixData.source = 'yahoo';
                cache.set('vixCache', vixData);
                console.log(`  VIX: ${vixData.level.toFixed(1)} (${vixData.interpretation}, ${vixData.trend}) [yahoo]`);
                return vixData;
            }
        }
    } catch { /* fall through */ }

    console.warn('  VIX fetch: no results from any source');
    return null;
}

function buildVixResult(level, prevClose) {
    prevClose = prevClose || level;
    const change = level - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const trend = changePercent > 5 ? 'rising' : changePercent < -5 ? 'falling' : 'stable';
    let interpretation;
    if (level < 15) interpretation = 'complacent';
    else if (level <= 20) interpretation = 'normal';
    else if (level <= 30) interpretation = 'elevated';
    else interpretation = 'panic';
    return { level, prevClose, change, changePercent, trend, interpretation };
}

// ═══════════════════════════════════════════════════
// News
// ═══════════════════════════════════════════════════
export async function fetchNewsForStocks(symbols) {
    const newsCache = cache.get('newsCache', NEWS_CACHE_TTL) || {};
    const uncached = symbols.filter(s => !newsCache[s]);

    if (uncached.length === 0) {
        console.log(`  News: all ${symbols.length} from cache`);
        return newsCache;
    }

    // Filter out after-hours news — only include articles published before 4 PM ET.
    // FORGE runs at 5 PM ET, so without this filter, post-close news (earnings, etc.)
    // would cause buys at the close price when the stock has already moved in AH.
    const now = new Date();
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const utcNow = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const etOffsetMs = utcNow.getTime() - etNow.getTime(); // ET-to-UTC offset (4h EDT, 5h EST)
    const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
    // 4 PM ET in UTC = 16:00 UTC + ET offset (so 20:00 or 21:00 UTC)
    const marketCloseUtc = new Date(todayET + 'T16:00:00Z');
    marketCloseUtc.setTime(marketCloseUtc.getTime() + etOffsetMs);

    console.log(`  Fetching news for ${uncached.length} stocks (cutoff: ${marketCloseUtc.toISOString()})...`);
    const BATCH = 25;
    for (let i = 0; i < uncached.length; i += BATCH) {
        const batch = uncached.slice(i, i + BATCH);
        await Promise.all(batch.map(async (symbol) => {
            try {
                const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
                const response = await fetch(
                    `${POLYGON_BASE}/v2/reference/news?ticker=${symbol}&limit=5&order=desc&sort=published_utc&published_utc.gte=${sevenDaysAgo}&apiKey=${API_KEY()}`
                );
                if (!response.ok) return;
                const data = await response.json();
                if (data.results?.length > 0) {
                    // Only keep articles published before today's market close (4 PM ET)
                    const filtered = data.results.filter(a => new Date(a.published_utc) <= marketCloseUtc);
                    newsCache[symbol] = filtered.slice(0, 3).map(article => {
                        const insight = (article.insights || []).find(ins => ins.ticker === symbol);
                        return {
                            title: article.title,
                            publishedUtc: article.published_utc,
                            sentiment: insight?.sentiment || null,
                            sentimentReasoning: insight?.sentiment_reasoning || null
                        };
                    });
                } else {
                    newsCache[symbol] = [];
                }
            } catch (err) {
                console.warn(`  News fetch failed for ${symbol}:`, err.message);
            }
        }));
        if (i + BATCH < uncached.length) await sleep(50);
    }

    cache.set('newsCache', newsCache);
    return newsCache;
}

// ═══════════════════════════════════════════════════
// Ticker Details (market cap, name, SIC)
// ═══════════════════════════════════════════════════
export async function fetchTickerDetails(symbols) {
    const detailsCache = cache.get('tickerDetailsCache', TICKER_DETAILS_TTL) || {};
    const uncached = symbols.filter(s => !detailsCache[s]);

    if (uncached.length === 0) {
        console.log(`  Ticker details: all ${symbols.length} from cache`);
        return detailsCache;
    }

    console.log(`  Fetching ticker details for ${uncached.length} stocks...`);
    const BATCH = 50;
    for (let i = 0; i < uncached.length; i += BATCH) {
        const batch = uncached.slice(i, i + BATCH);
        await Promise.all(batch.map(async (symbol) => {
            try {
                const response = await fetch(
                    `${POLYGON_BASE}/v3/reference/tickers/${symbol}?apiKey=${API_KEY()}`
                );
                if (!response.ok) return;
                const data = await response.json();
                if (data.results) {
                    detailsCache[symbol] = {
                        marketCap: data.results.market_cap || null,
                        sicDescription: data.results.sic_description || null,
                        name: data.results.name || null,
                        sharesOutstanding: data.results.share_class_shares_outstanding || null
                    };
                }
            } catch (err) {
                console.warn(`  Ticker details failed for ${symbol}:`, err.message);
            }
        }));
        if (i + BATCH < uncached.length) await sleep(50);
    }

    cache.set('tickerDetailsCache', detailsCache);
    return detailsCache;
}

// ═══════════════════════════════════════════════════
// Short Interest
// ═══════════════════════════════════════════════════
export async function fetchShortInterest(symbols) {
    const siCache = cache.get('shortInterestCache', SHORT_INTEREST_TTL) || {};
    const uncached = symbols.filter(s => !siCache[s]);

    if (uncached.length === 0) {
        console.log(`  Short interest: all ${symbols.length} from cache`);
        return siCache;
    }

    console.log(`  Fetching short interest data...`);
    const BATCH = 250;
    for (let i = 0; i < uncached.length; i += BATCH) {
        const batch = uncached.slice(i, i + BATCH);
        try {
            const tickerParam = batch.join(',');
            const response = await fetch(
                `${POLYGON_BASE}/stocks/v1/short-interest?ticker.any_of=${tickerParam}&order=desc&limit=1000&sort=settlement_date&apiKey=${API_KEY()}`
            );
            if (!response.ok) continue;
            const data = await response.json();
            if (data.results) {
                for (const entry of data.results) {
                    const sym = entry.ticker;
                    if (!siCache[sym]) {
                        siCache[sym] = {
                            shortInterest: entry.short_volume || entry.current_short_position || 0,
                            daysToCover: entry.days_to_cover || 0,
                            avgDailyVolume: entry.avg_daily_volume || 0,
                            settlementDate: entry.settlement_date || null
                        };
                    }
                }
            }
        } catch (err) {
            console.warn('  Short interest fetch error:', err.message);
        }
    }

    cache.set('shortInterestCache', siCache);
    return siCache;
}

// ═══════════════════════════════════════════════════
// Unified: Fetch all market data for a cycle
// ═══════════════════════════════════════════════════
export async function fetchAllMarketData(symbols) {
    console.log(`Fetching market data for ${symbols.length} symbols...`);

    // Bulk snapshot first (prices)
    const { prices: marketData, rawSnapshot } = await fetchBulkSnapshot(symbols);

    // Append synthetic today bar to grouped daily later
    const symbolSet = new Set(Object.keys(marketData));

    // Parallel: grouped daily, ticker details, short interest, VIX
    const [multiDayCache, tickerDetails, shortInterest, vix] = await Promise.all([
        fetchGroupedDailyBars(symbolSet),
        fetchTickerDetails(Object.keys(marketData)),
        fetchShortInterest(Object.keys(marketData)),
        fetchVIX()
    ]);

    // Append synthetic today bar from snapshot
    for (const sym of symbolSet) {
        const raw = rawSnapshot[sym];
        if (raw?.day?.o) {
            if (!multiDayCache[sym]) multiDayCache[sym] = [];
            const todayBar = { o: raw.day.o, h: raw.day.h, l: raw.day.l, c: raw.day.c, v: raw.day.v, t: Date.now() };
            const lastBar = multiDayCache[sym][multiDayCache[sym].length - 1];
            if (!lastBar || new Date(lastBar.t).toDateString() !== new Date().toDateString()) {
                multiDayCache[sym].push(todayBar);
            }
        }
    }

    // Fetch news for top candidates later (after scoring)

    return { marketData, multiDayCache, tickerDetails, shortInterest, vix };
}
