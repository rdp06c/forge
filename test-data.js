#!/usr/bin/env node
// Quick integration test — fetches real data and runs technicals
import 'dotenv/config';
import { fetchAllMarketData } from './data/polygon.js';
import { enrichMarketData, detectSectorRotation } from './data/technicals.js';

const TEST_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'JPM', 'AMZN', 'XOM', 'LLY', 'META', 'PLTR', 'SPY'];

async function main() {
    if (!process.env.POLYGON_API_KEY) {
        console.error('Set POLYGON_API_KEY in .env first');
        process.exit(1);
    }

    console.log(`Testing data pipeline with ${TEST_SYMBOLS.length} symbols...\n`);

    // Fetch
    const { marketData, multiDayCache, tickerDetails, shortInterest, vix } = await fetchAllMarketData(TEST_SYMBOLS);

    console.log(`\nPrices fetched: ${Object.keys(marketData).length}`);
    console.log(`Bars fetched: ${Object.keys(multiDayCache).length}`);
    console.log(`VIX: ${vix ? vix.level.toFixed(1) + ' (' + vix.interpretation + ')' : 'N/A'}`);

    // Sector rotation
    const sectorRotation = detectSectorRotation(marketData, multiDayCache);

    // Enrich
    const { enhanced, scored } = enrichMarketData(marketData, multiDayCache, tickerDetails, shortInterest, sectorRotation, {});

    console.log(`\nEnriched: ${Object.keys(enhanced).length} stocks`);
    console.log(`\nTop 5 by composite score:`);
    for (const s of scored.slice(0, 5)) {
        const d = s.data;
        console.log(`  ${s.symbol.padEnd(6)} score:${s.compositeScore.toFixed(1).padStart(6)}  momentum:${(d.momentum?.score || 0).toFixed(1)}  RS:${d.relativeStrength?.rsScore || '?'}  structure:${d.marketStructure?.structureSignal || '?'}  RSI:${d.rsi || '?'}  MACD:${d.macd?.crossover || '?'}`);
    }

    // Spot check one stock
    const nvda = enhanced['NVDA'];
    if (nvda) {
        console.log(`\nNVDA detail:`);
        console.log(`  Price: $${nvda.price}`);
        console.log(`  Bars: ${multiDayCache['NVDA']?.length || 0}`);
        console.log(`  Momentum: ${JSON.stringify(nvda.momentum)}`);
        console.log(`  RS: ${JSON.stringify(nvda.relativeStrength)}`);
        console.log(`  Structure: ${JSON.stringify(nvda.marketStructure)}`);
        console.log(`  RSI: ${nvda.rsi}`);
        console.log(`  MACD: ${JSON.stringify(nvda.macd)}`);
    }

    console.log('\nData pipeline test PASSED');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
