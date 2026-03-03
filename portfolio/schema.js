// Portfolio JSON creation/validation
import { STARTING_BALANCE } from '../config/constants.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PORTFOLIOS_DIR = join(import.meta.dirname, '..', 'portfolios');

export function createBacktestPortfolio(initialBalance, strategyName) {
    return {
        cash: initialBalance || STARTING_BALANCE,
        initialBalance: initialBalance || STARTING_BALANCE,
        holdings: {},
        transactions: [],
        performanceHistory: [],
        closedTrades: [],
        holdingTheses: {},
        lastMarketRegime: null,
        blockedTrades: [],
        regimeHistory: [],
        lastVIX: null,
        spyBaseline: null,
        spyCurrent: null,
        strategy: strategyName || 'baseline',
    };
}

export function portfolioPath(name) {
    return join(PORTFOLIOS_DIR, `${name}_Portfolio.json`);
}

export function loadPortfolio(name) {
    const filePath = portfolioPath(name);
    if (!existsSync(filePath)) {
        const portfolio = createBacktestPortfolio(STARTING_BALANCE, name);
        savePortfolio(name, portfolio);
        return portfolio;
    }
    const portfolio = JSON.parse(readFileSync(filePath, 'utf8'));

    // Clean expired blockedTrades
    if (portfolio.blockedTrades?.length > 0) {
        const now = new Date();
        portfolio.blockedTrades = portfolio.blockedTrades.filter(b => new Date(b.blockedUntil) > now);
    }

    return portfolio;
}

export function savePortfolio(name, portfolio) {
    writeFileSync(portfolioPath(name), JSON.stringify(portfolio, null, 2));
}
