// Historical data fetcher — loads Polygon grouped daily bars for backtesting
// Anti-look-ahead-bias: getMarketState(simDate) only returns bars <= simDate
import { POLYGON_BASE, API_KEY, sleep } from '../data/polygon.js';
import { cache } from '../data/cache.js';
import { getFullUniverse } from '../config/constants.js';

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — historical data doesn't change

export class DataManager {
    constructor() {
        this.masterBars = {};      // symbol → [{o,h,l,c,v,t}, ...] sorted by t
        this.vixByDate = {};       // 'YYYY-MM-DD' → VIX close
        this.tradingDays = [];     // sorted array of 'YYYY-MM-DD' where we have data
    }

    /**
     * Fetch all historical data needed for the backtest.
     * Uses Polygon grouped daily bars (one API call per date, returns all tickers).
     */
    async loadDateRange(startDate, endDate, lookbackDays = 80) {
        const universeSet = new Set(getFullUniverse());

        // Calculate all dates to fetch: lookback before start + start to end
        const lookbackDates = getWeekdaysBefore(startDate, lookbackDays);
        const rangeDates = generateWeekdays(startDate, endDate);
        const allDates = [...new Set([...lookbackDates, ...rangeDates])].sort();

        console.log(`Loading ${allDates.length} dates of historical data (${allDates[0]} → ${allDates[allDates.length - 1]})...`);

        const BATCH = 10;
        let fetchedCount = 0, cachedCount = 0;

        for (let i = 0; i < allDates.length; i += BATCH) {
            const batch = allDates.slice(i, i + BATCH);
            await Promise.all(batch.map(async (dateStr) => {
                const cacheKey = `grouped_${dateStr}`;
                const cached = cache.get(cacheKey, CACHE_TTL);
                if (cached) {
                    for (const bar of cached) {
                        if (!universeSet.has(bar.T)) continue;
                        if (!this.masterBars[bar.T]) this.masterBars[bar.T] = [];
                        this.masterBars[bar.T].push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, t: bar.t });
                    }
                    cachedCount++;
                    return;
                }
                try {
                    const response = await fetch(
                        `${POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${API_KEY()}`
                    );
                    if (!response.ok) return;
                    const data = await response.json();
                    if (!data.results || data.resultsCount === 0) return;

                    cache.set(cacheKey, data.results);

                    for (const bar of data.results) {
                        if (!universeSet.has(bar.T)) continue;
                        if (!this.masterBars[bar.T]) this.masterBars[bar.T] = [];
                        this.masterBars[bar.T].push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, t: bar.t });
                    }
                    fetchedCount++;
                } catch (err) {
                    console.warn(`  Grouped daily fetch failed for ${dateStr}:`, err.message);
                }
            }));
            if (i + BATCH < allDates.length) await sleep(200);

            // Progress
            const done = Math.min(i + BATCH, allDates.length);
            if (done % 50 === 0 || done === allDates.length) {
                console.log(`  Progress: ${done}/${allDates.length} dates (${fetchedCount} fetched, ${cachedCount} cached)`);
            }
        }

        // Sort all bars by timestamp
        for (const sym of Object.keys(this.masterBars)) {
            this.masterBars[sym].sort((a, b) => a.t - b.t);
        }

        // Identify actual trading days (dates where grouped data existed)
        const dateSet = new Set();
        for (const bars of Object.values(this.masterBars)) {
            for (const bar of bars) {
                const d = new Date(bar.t);
                const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                dateSet.add(key);
            }
        }
        this.tradingDays = [...dateSet].sort();

        // Fetch VIX history
        await this.loadVIXHistory(allDates[0], allDates[allDates.length - 1]);

        console.log(`Data loaded: ${Object.keys(this.masterBars).length} symbols, ${this.tradingDays.length} trading days, ${Object.keys(this.vixByDate).length} VIX days`);
    }

    /**
     * Get market state visible on a given simulation date.
     * Returns only bars with timestamps <= simDate, last 80.
     * THIS IS THE ANTI-LOOK-AHEAD-BIAS CHOKEPOINT.
     */
    getMarketState(simDate) {
        const simTimestamp = new Date(simDate + 'T23:59:59Z').getTime();
        const multiDayCache = {};
        const marketData = {};

        for (const [sym, allBars] of Object.entries(this.masterBars)) {
            const windowBars = allBars.filter(b => b.t <= simTimestamp);
            if (windowBars.length < 5) continue;
            const sliced = windowBars.slice(-80);
            multiDayCache[sym] = sliced;

            const last = sliced[sliced.length - 1];
            const prev = sliced.length >= 2 ? sliced[sliced.length - 2] : last;
            marketData[sym] = {
                price: last.c,
                change: last.c - prev.c,
                changePercent: prev.c !== 0 ? ((last.c - prev.c) / prev.c) * 100 : 0,
                volume: last.v,
            };
        }

        return { marketData, multiDayCache };
    }

    /**
     * Get VIX level for a given date. Falls back to nearest previous date.
     */
    getVIX(simDate) {
        if (this.vixByDate[simDate]) return this.vixByDate[simDate];

        // Fallback: find nearest previous date
        const dates = Object.keys(this.vixByDate).sort();
        for (let i = dates.length - 1; i >= 0; i--) {
            if (dates[i] <= simDate) return this.vixByDate[dates[i]];
        }
        return null;
    }

    /**
     * Fetch historical VIX from Yahoo Finance chart API.
     */
    async loadVIXHistory(startDate, endDate) {
        const cacheKey = `vixHistory_${startDate}_${endDate}`;
        const cached = cache.get(cacheKey, 7 * 24 * 60 * 60 * 1000);
        if (cached && Object.keys(cached).length > 0) {
            Object.assign(this.vixByDate, cached);
            console.log(`  VIX history from cache: ${Object.keys(cached).length} dates`);
            return;
        }

        try {
            const start = Math.floor(new Date(startDate).getTime() / 1000);
            const end = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
            const response = await fetch(
                `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?period1=${start}&period2=${end}&interval=1d`,
                { headers: { 'User-Agent': 'FORGE-Backtest/2.0' } }
            );
            if (response.ok) {
                const data = await response.json();
                const timestamps = data.chart?.result?.[0]?.timestamp || [];
                const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
                for (let i = 0; i < timestamps.length; i++) {
                    if (closes[i] != null) {
                        const d = new Date(timestamps[i] * 1000);
                        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                        this.vixByDate[key] = closes[i];
                    }
                }
                cache.set(cacheKey, this.vixByDate);
                console.log(`  VIX history: ${Object.keys(this.vixByDate).length} dates`);
            }
        } catch (err) {
            console.warn('  VIX history fetch failed:', err.message);
        }
    }

    /**
     * Get list of trading days within a date range.
     */
    getTradingDays(startDate, endDate) {
        return this.tradingDays.filter(d => d >= startDate && d <= endDate);
    }
}

// ═══════════════════════════════════════════════════
// Date utility functions
// ═══════════════════════════════════════════════════

/** Generate all weekdays between startDate and endDate (inclusive). */
export function generateWeekdays(startDate, endDate) {
    const days = [];
    const d = new Date(startDate);
    const end = new Date(endDate);
    while (d <= end) {
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) {
            days.push(d.toISOString().split('T')[0]);
        }
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return days;
}

/** Get N weekdays before a given date (returns sorted ascending). */
export function getWeekdaysBefore(date, count) {
    const days = [];
    const d = new Date(date);
    while (days.length < count) {
        d.setUTCDate(d.getUTCDate() - 1);
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) {
            days.push(d.toISOString().split('T')[0]);
        }
    }
    return days.reverse();
}
