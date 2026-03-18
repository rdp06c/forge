#!/usr/bin/env node
// FORGE Signal Backtester v3.0 — CLI entry point
import 'dotenv/config';
import { runBacktest, runMatrix } from './engine/engine.js';
import { buildStrategy, generateMatrix, PRESETS, SIGNAL_CONFIGS, EXIT_CONFIGS } from './config/strategies.js';
import { printResults, printMatrixSummary, saveResults, saveMatrixResults, computeMatrixSummary } from './engine/results.js';

const args = process.argv.slice(2);

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
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
}

const startDate = getArg('--start') || defaultStartDate();
const endDate = getArg('--end') || defaultEndDate();
const signalCode = getArg('--signal')?.toUpperCase();
const exitCode = getArg('--exit');
const weightsName = getArg('--weights') || 'calibrated';
const presetName = getArg('--preset');
const isMatrix = args.includes('--matrix');
const isUnconstrained = args.includes('--unconstrained');
const initialBalance = parseInt(getArg('--balance') || '50000', 10);

console.log('══════════════════════════════════════════════════');
console.log('FORGE Signal Backtester v3.0');
console.log('══════════════════════════════════════════════════');

if (!process.env.POLYGON_API_KEY) {
    console.error('Error: POLYGON_API_KEY not set in .env');
    process.exit(1);
}

function printUsage() {
    console.log(`
Usage:
  node backtest.js --signal=REV --exit=trail8                    # Single combo
  node backtest.js --signal=REV --exit=trail8 --weights=default  # Raw weights
  node backtest.js --preset=rev-baseline                         # Named preset
  node backtest.js --signal=REV --matrix                         # One signal, all exits
  node backtest.js --exit=trail8 --matrix                        # All signals, one exit
  node backtest.js --matrix                                      # Full matrix
  node backtest.js --matrix --start=2025-06-01                   # Custom date range
  node backtest.js --signal=REV --matrix --unconstrained         # Pure signal accuracy ($5K/trade, no caps)

Signals: ${Object.keys(SIGNAL_CONFIGS).join(', ')}
Exits:   ${Object.keys(EXIT_CONFIGS).join(', ')}
Presets: ${Object.keys(PRESETS).join(', ')}
Weights: calibrated, default
Flags:   --unconstrained (fixed $5K positions, no portfolio limits)
`);
}

try {
    if (isMatrix) {
        // Matrix mode
        const matrixOpts = {};
        if (signalCode) matrixOpts.signals = [signalCode];
        if (exitCode) matrixOpts.exits = [exitCode];
        matrixOpts.weights = [weightsName];
        if (isUnconstrained) matrixOpts.unconstrained = true;

        // If neither signal nor exit specified, run both weight sets
        if (!signalCode && !exitCode) {
            matrixOpts.weights = ['calibrated', 'default'];
        }

        const strategies = generateMatrix(matrixOpts);
        console.log(`Matrix: ${strategies.length} combinations`);

        const results = await runMatrix({ startDate, endDate, strategies, initialBalance });

        // Print individual results for small matrices
        if (results.length <= 10) {
            for (const r of results) printResults(r);
        }

        // Compute and print matrix summary
        const summary = computeMatrixSummary(results, startDate, endDate);
        printMatrixSummary(summary);
        saveMatrixResults(summary);

        // Save individual results
        for (const r of results) {
            saveResults(r, r.strategy, startDate, endDate);
        }

    } else if (presetName) {
        // Named preset
        const preset = PRESETS[presetName];
        if (!preset) {
            console.error(`Unknown preset: ${presetName}`);
            console.error(`Available: ${Object.keys(PRESETS).join(', ')}`);
            process.exit(1);
        }
        const strategy = buildStrategy(preset.signal, preset.exit, preset.weights, isUnconstrained);
        const result = await runBacktest({ startDate, endDate, strategy, initialBalance });
        printResults(result);
        saveResults(result, strategy.name, startDate, endDate);

    } else if (signalCode && exitCode) {
        // Single signal + exit combo
        if (!SIGNAL_CONFIGS[signalCode]) {
            console.error(`Unknown signal: ${signalCode}. Available: ${Object.keys(SIGNAL_CONFIGS).join(', ')}`);
            process.exit(1);
        }
        if (!EXIT_CONFIGS[exitCode]) {
            console.error(`Unknown exit: ${exitCode}. Available: ${Object.keys(EXIT_CONFIGS).join(', ')}`);
            process.exit(1);
        }
        const strategy = buildStrategy(signalCode, exitCode, weightsName, isUnconstrained);
        const result = await runBacktest({ startDate, endDate, strategy, initialBalance });
        printResults(result);
        saveResults(result, strategy.name, startDate, endDate);

    } else {
        printUsage();
        process.exit(0);
    }
} catch (err) {
    console.error('Backtest failed:', err);
    process.exit(1);
}
