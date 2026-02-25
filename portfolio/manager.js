// Trade execution and portfolio management — ported from APEX trader.js
// Pure functions operating on portfolio objects (no globals)
import { stockSectors, POSITION_SIZING, REGIME_DEPLOYMENT } from '../config/constants.js';

/**
 * Add N trading days (weekdays) to a date. Returns a new Date.
 */
function addTradingDays(startDate, days) {
    const d = new Date(startDate);
    let added = 0;
    while (added < days) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) added++;
    }
    return d;
}

/**
 * Count weekdays (trading days) between two dates, excluding the start date.
 */
function countTradingDays(startDate, endDate) {
    let count = 0;
    const d = new Date(startDate);
    d.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    while (d < end) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

/**
 * Calculate position size based on conviction and regime
 */
export function calculatePositionSize(portfolio, conviction, regime, currentPrice, marketPrices) {
    if (conviction < 6) return 0;

    const sizingTier = POSITION_SIZING[Math.min(conviction, 10)] || POSITION_SIZING[6];
    const regimeDeployment = REGIME_DEPLOYMENT[regime] || REGIME_DEPLOYMENT.choppy;

    // Total portfolio value using actual per-stock prices
    const totalValue = portfolio.cash + Object.entries(portfolio.holdings)
        .reduce((sum, [s, shares]) => sum + shares * (marketPrices?.[s]?.price || currentPrice), 0);

    // Target allocation: midpoint of conviction range × midpoint of regime deployment
    const convictionMid = (sizingTier.min + sizingTier.max) / 2;
    const maxDeployable = totalValue * ((regimeDeployment.min + regimeDeployment.max) / 2);
    const targetAllocation = Math.min(maxDeployable, totalValue * convictionMid);

    // Adaptive deployment: if win rate in current regime < 45%, reduce by 17.5%
    let adjustedAllocation = targetAllocation;
    const closedInRegime = (portfolio.closedTrades || []).filter(
        t => (t.forgeMetadata?.regimeAtEntry || t.exitMarketRegime) === regime
    );
    if (closedInRegime.length >= 5) {
        const wins = closedInRegime.filter(t => t.returnPercent > 0).length;
        const winRate = wins / closedInRegime.length;
        if (winRate < 0.45) {
            adjustedAllocation *= 0.825; // Reduce by 17.5% (midpoint of 15-20%)
        }
    }

    const shares = Math.floor(adjustedAllocation / currentPrice);
    const cost = shares * currentPrice;

    // Don't exceed available cash
    if (cost > portfolio.cash) {
        return Math.floor(portfolio.cash / currentPrice);
    }

    return shares;
}

/**
 * Execute a BUY trade
 */
export function executeBuy(portfolio, { symbol, shares, price, conviction, reasoning, marketData, vix, agentName }) {
    // Rebuy cooldown: 5-day block after selling a symbol
    const now = new Date();
    const blocked = (portfolio.blockedTrades || []).find(
        b => b.symbol === symbol && new Date(b.blockedUntil) > now
    );
    if (blocked) {
        console.log(`  [${agentName}] Rebuy cooldown: ${symbol} blocked until ${blocked.blockedUntil.split('T')[0]}`);
        return false;
    }

    const cost = price * shares;
    if (portfolio.cash < cost) {
        console.log(`  [${agentName}] Insufficient cash for ${shares} ${symbol} @ $${price} (need $${cost.toFixed(2)}, have $${portfolio.cash.toFixed(2)})`);
        return false;
    }

    portfolio.cash -= cost;
    portfolio.holdings[symbol] = (portfolio.holdings[symbol] || 0) + shares;

    const totalPortfolioValue = portfolio.cash + cost + Object.entries(portfolio.holdings)
        .filter(([s]) => s !== symbol)
        .reduce((sum, [s, sh]) => sum + (marketData[s]?.price || 0) * sh, 0);
    const positionSizePercent = totalPortfolioValue > 0 ? (cost / totalPortfolioValue) * 100 : 0;

    portfolio.transactions.push({
        type: 'BUY',
        symbol, shares, price, cost,
        timestamp: new Date().toISOString(),
        conviction,
        reasoning,
        entryTechnicals: {
            momentumScore: marketData[symbol]?.momentum?.score || null,
            todayChange: marketData[symbol]?.momentum?.todayChange ?? marketData[symbol]?.changePercent ?? null,
            totalReturn5d: marketData[symbol]?.momentum?.totalReturn5d ?? null,
            isAccelerating: marketData[symbol]?.momentum?.isAccelerating ?? null,
            upDays: marketData[symbol]?.momentum?.upDays ?? null,
            rsScore: marketData[symbol]?.relativeStrength?.rsScore || null,
            sectorRotation: marketData[symbol]?.sectorRotation?.rotationSignal || null,
            structureScore: marketData[symbol]?.marketStructure?.structureScore ?? null,
            structure: marketData[symbol]?.marketStructure?.structure || null,
            choch: marketData[symbol]?.marketStructure?.choch || null,
            chochType: marketData[symbol]?.marketStructure?.chochType || null,
            bos: marketData[symbol]?.marketStructure?.bos || null,
            bosType: marketData[symbol]?.marketStructure?.bosType || null,
            sweep: marketData[symbol]?.marketStructure?.sweep || null,
            rsi: marketData[symbol]?.rsi ?? null,
            macdCrossover: marketData[symbol]?.macd?.crossover || null,
            compositeScore: marketData[symbol]?.compositeScore ?? null,
            vixLevel: vix?.level ?? null,
        },
        entryMarketRegime: portfolio.lastMarketRegime?.regime || null,
        positionSizePercent,
    });

    // Thesis memory
    if (!portfolio.holdingTheses) portfolio.holdingTheses = {};
    if (!portfolio.holdingTheses[symbol]) {
        portfolio.holdingTheses[symbol] = {
            originalCatalyst: reasoning || '',
            entryConviction: conviction,
            entryPrice: price,
            entryDate: new Date().toISOString(),
            entryRegime: portfolio.lastMarketRegime?.regime || null,
            entryMomentum: marketData[symbol]?.momentum?.score || null,
            entryRS: marketData[symbol]?.relativeStrength?.rsScore || null,
            entrySectorFlow: marketData[symbol]?.sectorRotation?.moneyFlow || null,
            entryRSI: marketData[symbol]?.rsi ?? null,
            entryStructure: marketData[symbol]?.marketStructure?.structure || null,
            entryCompositeScore: marketData[symbol]?.compositeScore ?? null,
            entryVIX: vix?.level ?? null,
        };
    }

    console.log(`  [${agentName}] BUY ${shares} ${symbol} @ $${price.toFixed(2)} (conviction: ${conviction}/10, ${positionSizePercent.toFixed(1)}% of portfolio)`);
    return true;
}

/**
 * Get buy transactions for current open position only
 */
export function getCurrentPositionBuys(portfolio, symbol) {
    const allTx = portfolio.transactions || [];
    let lastFullSellIdx = -1;
    let runningShares = 0;

    for (let i = 0; i < allTx.length; i++) {
        const t = allTx[i];
        if (t.symbol !== symbol) continue;
        if (t.type === 'BUY') runningShares += t.shares;
        else if (t.type === 'SELL') {
            runningShares -= t.shares;
            if (runningShares <= 0) { lastFullSellIdx = i; runningShares = 0; }
        }
    }

    return allTx.filter((t, i) => i > lastFullSellIdx && t.symbol === symbol && t.type === 'BUY');
}

/**
 * Execute a SELL trade
 */
export function executeSell(portfolio, { symbol, shares, price, conviction, reasoning, exitReason, marketData, vix, agentName, forgeMetadata }) {
    const held = portfolio.holdings[symbol] || 0;
    if (held < shares) {
        console.log(`  [${agentName}] Can't sell ${shares} ${symbol} — only hold ${held}`);
        return false;
    }

    // Anti-whipsaw: block same-day sells
    const buys = getCurrentPositionBuys(portfolio, symbol);
    if (buys.length > 0) {
        const buyDate = new Date(buys[0].timestamp).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        if (buyDate === today) {
            console.log(`  [${agentName}] Anti-whipsaw: blocking same-day sell of ${symbol}`);
            return false;
        }

        // Hold discipline: < 3 trading days — only sell if stop-loss triggered (-15% or worse)
        const holdDays = countTradingDays(new Date(buys[0].timestamp), new Date());
        if (holdDays < 3) {
            const totalBuyCost = buys.reduce((s, t) => s + t.cost, 0);
            const totalBuyShares = buys.reduce((s, t) => s + t.shares, 0);
            const avgBuyPrice = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
            const returnPct = avgBuyPrice > 0 ? ((price - avgBuyPrice) / avgBuyPrice) * 100 : 0;
            if (returnPct > -15) {
                console.log(`  [${agentName}] Hold discipline: blocking sell of ${symbol} (held ${holdDays}d, return ${returnPct.toFixed(1)}%, need 3d or -15% stop)`);
                return false;
            }
        }
    }

    const revenue = price * shares;
    portfolio.cash += revenue;
    portfolio.holdings[symbol] -= shares;

    if (portfolio.holdings[symbol] === 0) {
        delete portfolio.holdings[symbol];
        if (portfolio.holdingTheses?.[symbol]) delete portfolio.holdingTheses[symbol];
    }

    // Closed trade tracking
    if (buys.length > 0) {
        const totalBuyCost = buys.reduce((sum, t) => sum + t.cost, 0);
        const totalBuyShares = buys.reduce((sum, t) => sum + t.shares, 0);
        const avgBuyPrice = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
        const profitLoss = avgBuyPrice > 0 ? (price - avgBuyPrice) * shares : 0;
        const returnPercent = avgBuyPrice > 0 ? ((price - avgBuyPrice) / avgBuyPrice) * 100 : 0;

        // Determine exit reason if not provided
        if (!exitReason) {
            if (returnPercent >= 2) exitReason = 'profit_target';
            else if (returnPercent <= -8) exitReason = 'stop_loss';
            else if (reasoning) {
                const r = reasoning.toLowerCase();
                if (r.includes('stop loss') || r.includes('stop-loss')) exitReason = 'stop_loss';
                else if (r.includes('redeploy') || r.includes('better use')) exitReason = 'opportunity_cost';
                else if (r.includes('catalyst') || r.includes('thesis')) exitReason = 'catalyst_failure';
                else exitReason = returnPercent < 0 ? 'catalyst_failure' : 'profit_target';
            } else {
                exitReason = 'manual';
            }
        }

        portfolio.closedTrades = portfolio.closedTrades || [];
        portfolio.closedTrades.push({
            symbol,
            sector: stockSectors[symbol] || 'Unknown',
            buyPrice: avgBuyPrice,
            sellPrice: price,
            shares, profitLoss, returnPercent,
            buyDate: buys[0].timestamp,
            sellDate: new Date().toISOString(),
            holdTime: Date.now() - new Date(buys[0].timestamp).getTime(),
            entryConviction: buys[0].conviction || null,
            entryTechnicals: buys[0].entryTechnicals || {},
            exitReason,
            exitReasoning: reasoning || '',
            exitConviction: conviction || null,
            exitMarketRegime: portfolio.lastMarketRegime?.regime || null,
            tracking: { priceAfter1Week: null, priceAfter1Month: null, tracked: false },
            // FORGE-specific
            agent: agentName,
            forgeMetadata: forgeMetadata || {},
        });

        const plSign = profitLoss >= 0 ? '+' : '';
        console.log(`  [${agentName}] SELL ${shares} ${symbol} @ $${price.toFixed(2)} (${plSign}$${profitLoss.toFixed(2)}, ${plSign}${returnPercent.toFixed(1)}%)`);

        // Rebuy cooldown: block re-entry for 5 trading days (weekdays)
        portfolio.blockedTrades = portfolio.blockedTrades || [];
        portfolio.blockedTrades.push({
            symbol,
            blockedUntil: addTradingDays(new Date(), 5).toISOString(),
            reason: 'rebuy_cooldown',
        });
    }

    portfolio.transactions.push({
        type: 'SELL', symbol, shares, price,
        timestamp: new Date().toISOString(),
        revenue,
    });

    return true;
}

/**
 * Calculate portfolio value using current prices
 */
export function calculatePortfolioValue(portfolio, prices) {
    let total = portfolio.cash;
    const holdings = {};
    for (const [symbol, shares] of Object.entries(portfolio.holdings)) {
        const price = prices[symbol]?.price || 0;
        const value = price * shares;
        total += value;
        holdings[symbol] = { shares, price, value };
    }
    return { total, holdings, cash: portfolio.cash };
}
