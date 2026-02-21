// Portfolio JSON creation/validation — FORGE-extended schema
import { STARTING_BALANCE } from '../config/constants.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PORTFOLIOS_DIR = join(import.meta.dirname, '..', 'portfolios');

export function createNewPortfolio(agentName) {
    return {
        cash: STARTING_BALANCE,
        initialBalance: STARTING_BALANCE,
        holdings: {},
        transactions: [],
        performanceHistory: [],
        closedTrades: [],
        holdingTheses: {},
        lastMarketRegime: null,
        lastCandidateScores: null,
        lastSectorRotation: null,
        blockedTrades: [],
        tradingRules: {},
        holdSnapshots: [],
        regimeHistory: [],
        lastVIX: null,
        spyBaseline: null,
        spyCurrent: null,
        portfolioHealth: null,
        // FORGE-specific
        agent: agentName,
        cycleId: 'FORGE_Cycle_1',
        cycleStartDate: '2026-02-23',
        forgeVersion: '1.0.0',
    };
}

export function portfolioPath(agentName) {
    return join(PORTFOLIOS_DIR, `FORGE_${agentName}_Portfolio.json`);
}

export function loadPortfolio(agentName) {
    const filePath = portfolioPath(agentName);
    if (!existsSync(filePath)) {
        const portfolio = createNewPortfolio(agentName);
        savePortfolio(agentName, portfolio);
        return portfolio;
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function savePortfolio(agentName, portfolio) {
    writeFileSync(portfolioPath(agentName), JSON.stringify(portfolio, null, 2));
}
