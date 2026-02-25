// Base agent class — shared portfolio/decision flow for all FORGE agents
import { loadPortfolio, savePortfolio } from '../portfolio/schema.js';
import { executeBuy, executeSell, calculatePositionSize, calculatePortfolioValue, getCurrentPositionBuys } from '../portfolio/manager.js';
import { callClaude } from '../ai/claude.js';
import { parseDecisionResponse } from '../ai/parser.js';
import { buildPhase1Prompt, buildPhase2Prompt } from '../ai/prompts.js';
import { stockSectors, TOP_CANDIDATES, SECTOR_WILDCARDS, REVERSAL_CANDIDATES, REGIME_DEPLOYMENT, POSITION_SIZING } from '../config/constants.js';
import { fetchNewsForStocks } from '../data/polygon.js';

export class BaseAgent {
    constructor(agentConfig) {
        this.config = agentConfig;
        this.name = agentConfig.name;
    }

    /**
     * Main cycle entry point
     * @param {object} sharedData - { marketData, multiDayCache, enhanced, scored, sectorRotation, tickerDetails, shortInterest, vix }
     */
    async runCycle(sharedData) {
        console.log(`\n[${ this.name }] Starting cycle...`);
        const portfolio = loadPortfolio(this.name);
        const { enhanced, scored, sectorRotation, vix, marketData, regime: centralRegime } = sharedData;

        // Build candidate pool
        const candidates = this.buildCandidatePool(scored, portfolio, enhanced);
        console.log(`  [${this.name}] ${candidates.size} candidates selected`);

        // Fetch news for candidates
        const newsSymbols = [...candidates];
        const newsCache = await fetchNewsForStocks(newsSymbols);
        // Inject news into enhanced data
        for (const sym of newsSymbols) {
            if (enhanced[sym]) enhanced[sym].recentNews = newsCache[sym] || null;
        }

        // Phase 1: Holdings review (if has holdings)
        let phase1Results = null;
        const holdingSymbols = Object.keys(portfolio.holdings);
        if (holdingSymbols.length > 0) {
            phase1Results = await this.runPhase1(portfolio, enhanced, vix, scored, centralRegime);
        }

        // Enforce agent-specific exit rules (e.g., Strike's mechanical exits)
        const forcedSells = this.enforceExitRules(portfolio, enhanced, vix);
        for (const fs of forcedSells) {
            const success = executeSell(portfolio, {
                symbol: fs.symbol, shares: fs.shares, price: fs.price,
                reasoning: fs.reasoning, exitReason: fs.exitReason,
                marketData: enhanced, vix, agentName: this.name,
                forgeMetadata: {
                    cycleId: portfolio.cycleId,
                    thesisQualified: true,
                    thesisAdherenceNotes: fs.reasoning,
                    decisionFrameworkUsed: this.config.exitFramework || 'mechanical_exit',
                    regimeAtEntry: portfolio.holdingTheses?.[fs.symbol]?.entryRegime || portfolio.lastMarketRegime?.regime || centralRegime,
                },
            });
            if (success) {
                if (!phase1Results) phase1Results = { sells: [], regime: centralRegime, summary: '' };
                phase1Results.sells.push({ symbol: fs.symbol, shares: fs.shares, reasoning: fs.reasoning });
            }
        }

        // Use centralized regime — determined once in forge.js for all agents
        const regime = centralRegime || this.inferRegime(vix);
        portfolio.lastMarketRegime = { regime, timestamp: new Date().toISOString() };
        if (!portfolio.regimeHistory) portfolio.regimeHistory = [];
        portfolio.regimeHistory.push({
            regime,
            timestamp: new Date().toISOString(),
            vix: vix?.level ?? null,
            signals: sharedData.regimeDetail?.signals || [],
        });
        portfolio.lastSectorRotation = { timestamp: new Date().toISOString(), sectors: sectorRotation };
        if (vix) portfolio.lastVIX = { ...vix, fetchedAt: new Date().toISOString() };

        // Phase 2: Buy decisions
        // Filter out symbols just sold
        const soldSymbols = new Set((phase1Results?.sells || []).map(d => d.symbol));
        const filteredCandidates = {};
        for (const sym of candidates) {
            if (!soldSymbols.has(sym) && !portfolio.holdings[sym] && enhanced[sym]) {
                filteredCandidates[sym] = this.compactCandidateData(enhanced[sym]);
            }
        }

        // Agent-specific candidate filtering
        const thesisFiltered = this.filterCandidates(filteredCandidates, enhanced, sharedData);

        if (Object.keys(thesisFiltered).length > 0) {
            await this.runPhase2(portfolio, thesisFiltered, sectorRotation, vix, phase1Results, enhanced, regime);
        } else {
            console.log(`  [${this.name}] No candidates pass thesis filter — sitting flat`);
        }

        // Record performance snapshot
        const { total } = calculatePortfolioValue(portfolio, marketData);
        portfolio.performanceHistory.push({
            timestamp: new Date().toISOString(),
            value: total,
            cash: portfolio.cash,
            holdingsCount: Object.keys(portfolio.holdings).length,
            regime,
        });

        savePortfolio(this.name, portfolio);
        const deployed = total - portfolio.cash;
        const deployedPct = total > 0 ? (deployed / total * 100).toFixed(0) : 0;
        console.log(`  [${this.name}] Cycle complete. Value: $${total.toFixed(2)} | Cash: $${portfolio.cash.toFixed(2)} | Deployed: ${deployedPct}% (${Object.keys(portfolio.holdings).length} positions)`);

        return { agentName: this.name, portfolioValue: total, cash: portfolio.cash, trades: phase1Results?.sells?.length || 0 };
    }

    /**
     * Build candidate pool: top N + holdings + sector wildcards + reversals
     */
    buildCandidatePool(scored, portfolio, enhanced) {
        const pool = new Set(scored.slice(0, TOP_CANDIDATES).map(s => s.symbol));

        // Always include holdings
        for (const sym of Object.keys(portfolio.holdings)) {
            if (enhanced[sym]) pool.add(sym);
        }

        // Sector wildcards
        const sectorCounts = {};
        pool.forEach(sym => {
            const sector = enhanced[sym]?.sector || 'Unknown';
            sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
        });
        const allSectors = [...new Set(Object.values(enhanced).map(d => d.sector))];
        let wildcards = 0;
        for (const sector of allSectors) {
            if (wildcards >= SECTOR_WILDCARDS) break;
            if (!sectorCounts[sector]) {
                const top = scored.find(s => s.data.sector === sector && !pool.has(s.symbol));
                if (top) { pool.add(top.symbol); wildcards++; }
            }
        }

        // Reversal candidates
        let reversals = 0;
        for (const s of scored) {
            if (reversals >= REVERSAL_CANDIDATES) break;
            if (pool.has(s.symbol)) continue;
            const struct = s.data.marketStructure;
            if (!struct) continue;
            if ((struct.choch && struct.chochType === 'bullish') ||
                struct.sweep === 'low-swept' ||
                (struct.bos && struct.bosType === 'bullish' && s.data.momentum?.score >= 5)) {
                pool.add(s.symbol);
                reversals++;
            }
        }

        return pool;
    }

    /**
     * Phase 1: Holdings review
     */
    async runPhase1(portfolio, enhanced, vix, scored, centralRegime) {
        console.log(`  [${this.name}] Phase 1: Reviewing ${Object.keys(portfolio.holdings).length} holdings...`);

        // Top buy opportunities for context
        const topBuyOps = scored
            .filter(s => !portfolio.holdings[s.symbol])
            .slice(0, 5)
            .map(s => `${s.symbol} (score:${s.compositeScore.toFixed(1)})`);

        const prompt = buildPhase1Prompt(this.config, portfolio, enhanced, vix, topBuyOps, centralRegime);
        const rawResponse = await callClaude(prompt);
        const parsed = parseDecisionResponse(rawResponse);

        const sells = [];
        const regime = centralRegime;

        if (parsed.decisions) {
            for (const d of parsed.decisions) {
                if (!d.action) continue;
                d.action = d.action.toUpperCase();

                if (d.action === 'SELL' && d.shares > 0 && portfolio.holdings[d.symbol]) {
                    const price = enhanced[d.symbol]?.price || 0;
                    if (price > 0) {
                        const success = executeSell(portfolio, {
                            symbol: d.symbol, shares: d.shares, price, conviction: d.conviction,
                            reasoning: d.reasoning, marketData: enhanced, vix, agentName: this.name,
                            forgeMetadata: {
                                cycleId: portfolio.cycleId,
                                thesisQualified: true,
                                thesisAdherenceNotes: `Phase 1 sell decision by ${this.name}`,
                                decisionFrameworkUsed: this.config.exitFramework,
                                regimeAtEntry: portfolio.holdingTheses?.[d.symbol]?.entryRegime || portfolio.lastMarketRegime?.regime || regime,
                            }
                        });
                        if (success) sells.push(d);
                    }
                }
            }
        }

        console.log(`  [${this.name}] Phase 1: ${sells.length} sells executed`);
        return { sells, regime, summary: parsed.holdings_summary || '' };
    }

    /**
     * Phase 2: Buy decisions
     */
    async runPhase2(portfolio, filteredCandidates, sectorRotation, vix, phase1Results, enhanced, regime) {
        console.log(`  [${this.name}] Phase 2: Evaluating ${Object.keys(filteredCandidates).length} candidates...`);

        // Build sector summary
        const sectorSummary = {};
        for (const [sector, data] of Object.entries(sectorRotation)) {
            sectorSummary[sector] = { moneyFlow: data.moneyFlow, rotationSignal: data.rotationSignal, avgReturn5d: data.avgReturn5d };
        }

        const prompt = buildPhase2Prompt(this.config, portfolio, filteredCandidates, sectorSummary, vix, phase1Results, regime);
        const rawResponse = await callClaude(prompt);
        const parsed = parseDecisionResponse(rawResponse);

        if (parsed.decisions) {
            const boughtThisCycle = new Set(Object.keys(portfolio.holdings));
            const regimeLimits = REGIME_DEPLOYMENT[regime] || REGIME_DEPLOYMENT.choppy;
            const maxDeployment = regimeLimits.max;

            for (const d of parsed.decisions) {
                if (!d.action) continue;
                d.action = d.action.toUpperCase();

                if (d.action === 'BUY' && d.symbol && d.conviction >= 1) {
                    // Skip duplicate symbols within same cycle
                    if (boughtThisCycle.has(d.symbol)) {
                        console.log(`  [${this.name}] Skipping duplicate buy: ${d.symbol}`);
                        continue;
                    }

                    // Validate against thesis rules
                    if (!this.validateDecision(d, enhanced[d.symbol], enhanced)) {
                        console.log(`  [${this.name}] Thesis rejection: ${d.symbol} (conviction ${d.conviction})`);
                        continue;
                    }

                    const price = enhanced[d.symbol]?.price || 0;
                    if (price <= 0) continue;

                    // Calculate portfolio value and deployment
                    const totalValue = portfolio.cash + Object.entries(portfolio.holdings)
                        .reduce((sum, [s, sh]) => sum + (enhanced[s]?.price || 0) * sh, 0);
                    const deployed = totalValue - portfolio.cash;

                    // Check regime deployment cap (hard skip if already at max)
                    if (totalValue > 0 && deployed / totalValue >= maxDeployment) {
                        console.log(`  [${this.name}] Regime cap hit (${(deployed / totalValue * 100).toFixed(0)}% deployed, ${regime} max ${(maxDeployment * 100).toFixed(0)}%) — skipping ${d.symbol}`);
                        continue;
                    }

                    // Calculate shares if not provided
                    let shares = d.shares;
                    if (!shares || shares <= 0) {
                        shares = calculatePositionSize(portfolio, d.conviction, regime, price, enhanced);
                    }
                    if (shares <= 0) continue;

                    // Position sizing clamp — enforce conviction tier range
                    const sizingTier = POSITION_SIZING[Math.min(d.conviction, 10)] || POSITION_SIZING[6];
                    const maxPositionShares = Math.floor(totalValue * sizingTier.max / price);
                    const minPositionShares = Math.floor(totalValue * sizingTier.min / price);

                    if (shares > maxPositionShares) {
                        console.log(`  [${this.name}] Sizing clamp ↓: ${d.symbol} ${shares}→${maxPositionShares} shares (conv ${d.conviction}, max ${(sizingTier.max * 100)}%)`);
                        shares = maxPositionShares;
                    }
                    if (shares < minPositionShares) {
                        // Only enforce minimum if it fits within cash and deployment cap
                        const minCost = minPositionShares * price;
                        const deployedAfter = (deployed + minCost) / totalValue;
                        if (minCost <= portfolio.cash && deployedAfter <= maxDeployment) {
                            console.log(`  [${this.name}] Sizing clamp ↑: ${d.symbol} ${shares}→${minPositionShares} shares (conv ${d.conviction}, min ${(sizingTier.min * 100)}%)`);
                            shares = minPositionShares;
                        }
                    }
                    if (shares <= 0) continue;

                    // Deployment cap trim — reduce shares if this buy would push over the limit
                    const buyCost = shares * price;
                    const deployedAfterBuy = deployed + buyCost;
                    if (totalValue > 0 && deployedAfterBuy / totalValue > maxDeployment) {
                        const maxBuyCost = (maxDeployment * totalValue) - deployed;
                        if (maxBuyCost <= 0) continue;
                        shares = Math.floor(maxBuyCost / price);
                        if (shares <= 0) continue;
                        console.log(`  [${this.name}] Deployment cap trim: ${d.symbol} → ${shares} shares to stay under ${(maxDeployment * 100)}%`);
                    }

                    const success = executeBuy(portfolio, {
                        symbol: d.symbol, shares, price, conviction: d.conviction,
                        reasoning: d.reasoning, marketData: enhanced, vix, agentName: this.name,
                    });
                    if (success) {
                        boughtThisCycle.add(d.symbol);
                        // Store Strike's mechanical exit targets in holdingTheses
                        const thesis = portfolio.holdingTheses?.[d.symbol];
                        if (thesis) {
                            const target = this.extractTargetPrice(d, price);
                            if (target) {
                                thesis.expectedTarget = target;
                                // Compute mechanicalExit in code — never trust Claude for math
                                thesis.mechanicalExit = Math.round((price + (target - price) * 0.55) * 100) / 100;
                                console.log(`  [${this.name}] Exit targets: ${d.symbol} entry $${price.toFixed(2)} → target $${target.toFixed(2)} → mechanical exit $${thesis.mechanicalExit.toFixed(2)}`);
                            } else if (this.name === 'Strike') {
                                console.warn(`  [${this.name}] WARNING: No target price found for ${d.symbol} — mechanical exit will not function`);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Compact candidate data for prompt (reduce token usage)
     */
    compactCandidateData(data) {
        return {
            price: data.price, changePercent: data.changePercent?.toFixed(2),
            sector: data.sector, compositeScore: data.compositeScore?.toFixed(1),
            momentum: { score: data.momentum?.score, trend: data.momentum?.trend, totalReturn5d: data.momentum?.totalReturn5d, isAccelerating: data.momentum?.isAccelerating, volumeTrend: data.momentum?.volumeTrend },
            relativeStrength: { rsScore: data.relativeStrength?.rsScore, strength: data.relativeStrength?.strength },
            marketStructure: { structure: data.marketStructure?.structure, structureSignal: data.marketStructure?.structureSignal, structureScore: data.marketStructure?.structureScore, choch: data.marketStructure?.choch, chochType: data.marketStructure?.chochType, bos: data.marketStructure?.bos, bosType: data.marketStructure?.bosType, sweep: data.marketStructure?.sweep, fvg: data.marketStructure?.fvg },
            rsi: data.rsi, macd: data.macd ? { crossover: data.macd.crossover, histogram: data.macd.histogram } : null,
            sectorRotation: data.sectorRotation ? { moneyFlow: data.sectorRotation.moneyFlow, rotationSignal: data.sectorRotation.rotationSignal } : null,
            shortInterest: data.shortInterest ? { daysToCover: data.shortInterest.daysToCover } : null,
            marketCap: data.marketCap, companyName: data.companyName,
            recentNews: (data.recentNews || []).slice(0, 2).map(n => ({ title: n.title, sentiment: n.sentiment })),
            volume: data.volume,
        };
    }

    /**
     * Infer regime from VIX when Phase 1 doesn't provide one
     */
    inferRegime(vix) {
        if (!vix) return 'choppy';
        if (vix.level > 30) return 'bear';
        if (vix.level > 25) return 'choppy';
        return 'bull';
    }

    /**
     * Extract target price from a buy decision.
     * Tries JSON field first, then parses from reasoning text.
     * Returns the target price or null if not found.
     */
    extractTargetPrice(decision, entryPrice) {
        // 1. JSON field (if Claude actually returned it)
        if (decision.expectedTarget && decision.expectedTarget > entryPrice) {
            return decision.expectedTarget;
        }

        if (!decision.reasoning) return null;

        // 2. "targeting $XXX" or "target $XXX" (direct dollar amount after target keyword)
        const m1 = decision.reasoning.match(/[Tt]arget(?:ing)?[:\s]+\$?([\d.]+)/);
        if (m1) {
            const v = parseFloat(m1[1]);
            if (v > entryPrice) return v;
        }

        // 3. "target ... $XXX" (dollar amount later in the same sentence, e.g. "Target: ~10% move to ~$266")
        const m2 = decision.reasoning.match(/[Tt]arget(?:ing)?[^.]*?\$([\d.]+)/);
        if (m2) {
            const v = parseFloat(m2[1]);
            if (v > entryPrice) return v;
        }

        return null;
    }

    // ─── Override points for subclasses ───

    /**
     * Filter candidates per thesis rules (override in subclass)
     */
    filterCandidates(candidates, enhanced, sharedData) {
        return candidates;
    }

    /**
     * Validate a single buy decision against thesis rules (override in subclass)
     */
    validateDecision(decision, candidateData, enhanced) {
        return true;
    }

    /**
     * Enforce agent-specific exit rules before Phase 2 (override in subclass)
     * Returns array of { symbol, shares, price, reasoning, exitReason }
     */
    enforceExitRules(portfolio, enhanced, vix) {
        return [];
    }
}
