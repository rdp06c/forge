#!/usr/bin/env node
// FORGE Portfolio Backtester — CLI entry point
import 'dotenv/config';
import { runBacktest } from './engine/engine.js';
import { STRATEGIES, STRATEGY_NAMES } from './config/strategies.js';
import { printResults, printComparison, saveResults } from './engine/results.js';

const args = process.argv.slice(2);

// Parse CLI args
function getArg(flag) {
    const arg = args.find(a => a.startsWith(flag + '='));
    return arg ? arg.split('=')[1] : null;
}

function defaultStartDate() {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().split('T')[0];
}

function defaultEndDate() {
    // Yesterday — today's market data may not be available until after close
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
}

const startDate = getArg('--start') || defaultStartDate();
const endDate = getArg('--end') || defaultEndDate();
const strategyName = getArg('--strategy') || 'baseline';
const runAll = args.includes('--all');
const initialBalance = parseInt(getArg('--balance') || '50000', 10);

console.log('══════════════════════════════════════════════════');
console.log('FORGE Portfolio Backtester v2.0');
console.log('══════════════════════════════════════════════════');

if (!process.env.POLYGON_API_KEY) {
    console.error('Error: POLYGON_API_KEY not set in .env');
    process.exit(1);
}

try {
    if (runAll) {
        // Run all strategies and produce comparison
        const allResults = [];
        for (const name of STRATEGY_NAMES) {
            const result = await runBacktest({
                startDate, endDate,
                strategy: STRATEGIES[name],
                initialBalance,
            });
            printResults(result);
            saveResults(result, name, startDate, endDate);
            allResults.push(result);
        }
        printComparison(allResults);
    } else {
        const strategy = STRATEGIES[strategyName];
        if (!strategy) {
            console.error(`Unknown strategy: ${strategyName}`);
            console.error(`Available: ${STRATEGY_NAMES.join(', ')}`);
            process.exit(1);
        }
        const result = await runBacktest({ startDate, endDate, strategy, initialBalance });
        printResults(result);
        saveResults(result, strategyName, startDate, endDate);
    }
} catch (err) {
    console.error('Backtest failed:', err);
    process.exit(1);
}
