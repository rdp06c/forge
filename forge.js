#!/usr/bin/env node
// FORGE — Main orchestrator + cron scheduler
// Runs 5 research agents sequentially after market close

import 'dotenv/config';
import cron from 'node-cron';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getFullUniverse } from './config/constants.js';
import { AGENTS, AGENT_NAMES } from './config/agents.js';
import { fetchAllMarketData } from './data/polygon.js';
import { enrichMarketData, detectSectorRotation } from './data/technicals.js';
import { fetchNewsForStocks } from './data/polygon.js';
import { loadPortfolio } from './portfolio/schema.js';
import { uploadPortfolio, uploadCycleLog } from './drive/google-drive.js';

import { EmberAgent } from './agents/ember.js';
import { StrikeAgent } from './agents/strike.js';
import { FluxAgent } from './agents/flux.js';
import { DraftAgent } from './agents/draft.js';
import { AlloyAgent } from './agents/alloy.js';

// Agent class map
const AGENT_CLASSES = {
    Ember: EmberAgent,
    Strike: StrikeAgent,
    Flux: FluxAgent,
    Draft: DraftAgent,
    Alloy: AlloyAgent,
};

// Ensure runtime directories exist
for (const dir of ['portfolios', 'cache', 'logs']) {
    const fullPath = join(import.meta.dirname, dir);
    if (!existsSync(fullPath)) mkdirSync(fullPath, { recursive: true });
}

/**
 * Check if today is a US trading day (weekday, not a known market holiday)
 */
function isTradingDay() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay();
    return day >= 1 && day <= 5;
}

/**
 * Main FORGE cycle — fetch data once, run all 5 agents
 */
async function runForgeCycle() {
    const cycleStart = Date.now();
    console.log('══════════════════════════════════════════════════');
    console.log(`FORGE Cycle — ${new Date().toISOString()}`);
    console.log('══════════════════════════════════════════════════');

    // Verify API keys
    if (!process.env.POLYGON_API_KEY) {
        console.error('POLYGON_API_KEY not set in .env');
        return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY not set in .env');
        return;
    }

    // 1. Fetch shared market data (one set of API calls for all agents)
    const symbols = getFullUniverse();
    console.log(`\nFetching data for ${symbols.length} symbols...`);

    let sharedData;
    try {
        const rawData = await fetchAllMarketData(symbols);
        const { marketData, multiDayCache, tickerDetails, shortInterest, vix } = rawData;

        // Calculate sector rotation
        const sectorRotation = detectSectorRotation(marketData, multiDayCache);

        // Enrich with technicals + scoring
        const { enhanced, scored } = enrichMarketData(
            marketData, multiDayCache, tickerDetails, shortInterest, sectorRotation, {}
        );

        sharedData = { marketData, multiDayCache, enhanced, scored, sectorRotation, tickerDetails, shortInterest, vix };
        console.log(`\nData ready: ${Object.keys(enhanced).length} stocks enriched, top score: ${scored[0]?.compositeScore.toFixed(1)} (${scored[0]?.symbol})`);
    } catch (err) {
        console.error('Data fetch failed:', err.message);
        return;
    }

    // 2. Run each agent sequentially (rate limit respect)
    const results = [];
    for (const name of AGENT_NAMES) {
        try {
            const AgentClass = AGENT_CLASSES[name];
            const agent = new AgentClass(AGENTS[name]);
            const result = await agent.runCycle(sharedData);
            results.push(result);
        } catch (err) {
            console.error(`[${name}] Agent error:`, err.message);
            results.push({ agentName: name, error: err.message });
        }

        // 2-second pause between agents for rate limits
        if (name !== AGENT_NAMES[AGENT_NAMES.length - 1]) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // 3. Upload to Google Drive
    console.log('\nUploading to Google Drive...');
    for (const name of AGENT_NAMES) {
        try {
            const portfolio = loadPortfolio(name);
            await uploadPortfolio(name, portfolio);
        } catch (err) {
            console.warn(`  Drive upload failed for ${name}:`, err.message);
        }
    }

    // Cycle summary log
    const cycleLog = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - cycleStart,
        agents: results,
    };

    try {
        await uploadCycleLog('Summary', cycleLog);
    } catch { /* non-fatal */ }

    // Print summary
    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log('\n══════════════════════════════════════════════════');
    console.log(`FORGE Cycle Complete — ${elapsed}s`);
    console.log('══════════════════════════════════════════════════');
    for (const r of results) {
        if (r.error) {
            console.log(`  ${r.agentName}: ERROR — ${r.error}`);
        } else {
            const cash = r.cash != null ? ` | Cash: $${r.cash.toFixed(2)}` : '';
            console.log(`  ${r.agentName}: $${r.portfolioValue?.toFixed(2) || '?'}${cash}`);
        }
    }
}

// ═══════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════

const args = process.argv.slice(2);

if (args.includes('--now')) {
    // Manual trigger for testing
    console.log('FORGE — Manual trigger (--now)');
    runForgeCycle().catch(err => {
        console.error('Cycle failed:', err);
        process.exit(1);
    });
} else if (args.includes('--init')) {
    // Initialize portfolios without running a cycle
    console.log('FORGE — Initializing portfolios...');
    for (const name of AGENT_NAMES) {
        const p = loadPortfolio(name);
        console.log(`  ${name}: $${p.cash.toFixed(2)} cash`);
    }
    console.log('Done. Portfolios created in ./portfolios/');
} else {
    // Cron mode: 5:00 PM ET weekdays
    console.log('FORGE — Starting cron scheduler');
    console.log('  Schedule: 5:00 PM ET, weekdays (Mon-Fri)');
    console.log('  Use --now for manual trigger, --init to create portfolios\n');

    cron.schedule('0 17 * * 1-5', async () => {
        if (!isTradingDay()) {
            console.log(`Skipping — not a trading day (${new Date().toDateString()})`);
            return;
        }
        console.log(`Cron triggered at ${new Date().toISOString()}`);
        try {
            await runForgeCycle();
        } catch (err) {
            console.error('Scheduled cycle failed:', err);
        }
    }, { timezone: 'America/New_York' });

    console.log('Waiting for next scheduled run...');
}
