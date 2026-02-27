// Per-agent prompt templates for FORGE
// Shared skeleton from APEX Phase 1 & Phase 2, with agent-specific modifications

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ═══════════════════════════════════════════════════════════
// PHASE 1: Holdings Review (SELL/HOLD decisions)
// ═══════════════════════════════════════════════════════════

function formatHoldings(portfolio, enhancedData) {
    const holdingsObj = {};
    for (const [sym, shares] of Object.entries(portfolio.holdings)) {
        const data = enhancedData[sym];
        if (!data) continue;

        // Get buy info for current position
        const allTx = portfolio.transactions || [];
        let lastFullSellIdx = -1, runningShares = 0;
        for (let i = 0; i < allTx.length; i++) {
            const t = allTx[i];
            if (t.symbol !== sym) continue;
            if (t.type === 'BUY') runningShares += t.shares;
            else if (t.type === 'SELL') { runningShares -= t.shares; if (runningShares <= 0) { lastFullSellIdx = i; runningShares = 0; } }
        }
        const buys = allTx.filter((t, i) => i > lastFullSellIdx && t.symbol === sym && t.type === 'BUY');
        let tsB = 0, tc = 0;
        buys.forEach(t => { tsB += t.shares; tc += t.price * t.shares; });
        const avgCost = tsB > 0 ? tc / tsB : 0;
        const price = data.price || 0;
        const pl = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : 0;
        const holdDays = buys[0] ? Math.floor((Date.now() - new Date(buys[0].timestamp).getTime()) / 86400000) : 0;

        const thesis = (portfolio.holdingTheses || {})[sym];

        holdingsObj[sym] = {
            shares, avgCost: '$' + avgCost.toFixed(2), price: '$' + price.toFixed(2), PL: pl.toFixed(1) + '%', held: holdDays + 'd',
            ORIGINAL_THESIS: thesis ? {
                catalyst: thesis.originalCatalyst,
                entryConviction: thesis.entryConviction,
                entryPrice: '$' + thesis.entryPrice.toFixed(2),
                entryDate: thesis.entryDate?.split('T')[0],
            } : 'No thesis recorded',
            CURRENT_INDICATORS: {
                sector: data.sector || 'Unknown',
                momentum: data.momentum?.score ?? null,
                relativeStrength: data.relativeStrength?.rsScore ?? null,
                sectorFlow: data.sectorRotation?.moneyFlow ?? null,
                structure: data.marketStructure?.structure ?? null,
                structureSignals: {
                    choch: data.marketStructure?.choch ?? null,
                    chochType: data.marketStructure?.chochType ?? 'none',
                    bos: data.marketStructure?.bos ?? null,
                    bosType: data.marketStructure?.bosType ?? 'none',
                    sweep: data.marketStructure?.sweep ?? 'none',
                },
                rsi: data.rsi ?? null,
                macdSignal: data.macd?.crossover ?? 'none',
                recentNews: (data.recentNews || []).slice(0, 2).map(n => ({ title: n.title, sentiment: n.sentiment }))
            }
        };
    }
    return JSON.stringify(holdingsObj);
}

export function buildPhase1Prompt(agentConfig, portfolio, enhancedData, vix, topBuyOpportunities, regime) {
    const agentName = agentConfig.name;
    const holdingsStr = formatHoldings(portfolio, enhancedData);
    const recentTx = (portfolio.transactions || []).slice(-10).reverse()
        .map(t => `${t.type} ${t.shares} ${t.symbol} @ $${t.price.toFixed(2)} ${new Date(t.timestamp).toLocaleDateString()}`)
        .join('; ') || 'None';

    // Agent-specific sell framework modifications
    let sellFrameworkNote = '';
    if (agentName === 'Strike') {
        sellFrameworkNote = `
STRIKE-SPECIFIC EXIT RULE: You use MECHANICAL EXITS. For each holding, calculate 55% of the expected move (entry price to original price target). If the current price has reached or exceeded that 55% level, SELL regardless of momentum or other signals. This overrides APEX's flexible profit-taking framework. Stop-loss and catalyst failure triggers still apply normally.`;
    } else if (agentName === 'Flux') {
        sellFrameworkNote = `
FLUX-SPECIFIC EXIT RULE: You bought this stock as a dip/pullback recovery play. Your thesis is that the stock was temporarily oversold and would recover. If the stock continues to decline and breaks to new lows with bearish BOS (structural breakdown confirmed), the recovery thesis is broken — exit. If the stock is stabilizing or recovering, HOLD.`;
    }

    return `You are ${agentConfig.fullName}, a FORGE research agent. PHASE 1: HOLDINGS REVIEW ONLY.
Today: ${TODAY()}.

AGENT THESIS: ${agentConfig.thesis}
AGENT RULES: ${agentConfig.description}
${sellFrameworkNote}

TASK: Review each holding → decide SELL or HOLD. NO BUY decisions.

For each holding, compare ORIGINAL_THESIS vs CURRENT_INDICATORS:
1. Has catalyst played out, strengthened, or broken?
2. Entry momentum → current momentum (improving or fading?)
3. Entry RS → current RS (outperforming or lagging sector?)
4. Current structure signals (CHoCH = reversal warning, BOS = trend continues)
5. Time elapsed vs expected catalyst timeframe
6. Would you buy TODAY at current price with current indicators?

HOLD DURATION DISCIPLINE — Swing trading horizon (days to weeks).
- Positions < 3 days old: Do NOT sell unless thesis is CLEARLY BROKEN
- Positions 3-5 days old: Sell only with conviction 8+ and structural breakdown
- Positions 5+ days: Normal evaluation
- Same-day sells: BLOCKED

STOP-LOSS: -5% note, -10% re-evaluate, -15% deep review, -20% hard stop

Portfolio Cash: $${portfolio.cash.toFixed(2)}
${vix ? `VIX: ${vix.level.toFixed(1)} (${vix.interpretation}${vix.trend !== 'stable' ? ', ' + vix.trend : ''})` : ''}
Market Regime: ${regime || 'choppy'} (determined centrally — do not override)
Holdings: ${holdingsStr}
Recent Transactions: ${recentTx}

JSON ONLY response:
{ "decisions": [{ "action": "SELL" or "HOLD", "symbol": "X", "shares": N, "conviction": 1-10, "reasoning": "..." }], "holdings_summary": "..." }
Include a decision for EVERY holding.`;
}

// ═══════════════════════════════════════════════════════════
// PHASE 2: Buy decisions
// ═══════════════════════════════════════════════════════════

function getAgentBuyFramework(agentConfig) {
    const name = agentConfig.name;

    if (name === 'Ember') {
        return `
═══════════════════════════════════════════════════════════
EMBER'S 3-FACTOR DECISION MODEL (NOT APEX's 5-step chain)
═══════════════════════════════════════════════════════════

You use a deliberately SIMPLIFIED model. Only 3 factors matter:

FACTOR 1: CATALYST STRENGTH (must be 10/10)
- Must be a perfect, unambiguous catalyst
- Earnings blow-out + massive guidance raise, or major contract win, or paradigm shift

FACTOR 2: TECHNICAL STRUCTURE (must be perfect alignment)
- Bullish BOS or strong bullish structure
- RSI not overbought (< 75)
- MACD bullish or about to cross
- Momentum building, not fading

FACTOR 3: SECTOR CONTEXT (must be favorable)
- Sector must be in INFLOW — neutral is not sufficient for perfect alignment
- No sector headwinds

ALL THREE must align perfectly = conviction 10/10. You trade.
ANYTHING less than perfect alignment across all three = PASS. You sit flat.

FUNDAMENTALS: Note them but they do NOT gate the trade. This is the explicit test.

You will have MANY days with zero trades. That is correct behavior.`;
    }

    if (name === 'Strike') {
        return `
═══════════════════════════════════════════════════════════
STRIKE'S BUY FRAMEWORK (FULL APEX 5-STEP CHAIN)
═══════════════════════════════════════════════════════════

Use APEX's complete catalyst-first framework:
Step 1: Catalyst Evaluation (gate at 8+, or 6+ with perfect confirmation)
Step 2: Market Reaction Check
Step 3: Fundamental Quality Check
Step 4: Technical Timing (entry tiers, extension check)
Step 5: Sector Context

Minimum conviction: 7/10

STRIKE-SPECIFIC: On every BUY, you MUST specify:
- "expectedTarget": the price target based on your analysis
- "mechanicalExit": 55% of the move from entry to target
Example: Entry $100, Target $120 → mechanicalExit = $100 + ($20 × 0.55) = $111

This mechanical exit will override APEX's flexible profit-taking on the sell side.`;
    }

    if (name === 'Flux') {
        return `
═══════════════════════════════════════════════════════════
FLUX'S DIP-BUYING FRAMEWORK
═══════════════════════════════════════════════════════════

You buy stocks that have pulled back HARD but are showing signs of STABILIZATION.
APEX's composite scoring penalizes recent declines aggressively. You test whether those penalties
filter out legitimate recovery entries.

ENTRY CRITERIA (ALL required):
1. MEANINGFUL PULLBACK: Stock is down 8-25% over the last 5 trading days
   - Less than 8% is not a real dip — APEX handles these fine
   - More than 25% is likely a fundamental blow-up, not a dip — avoid catching falling knives

2. STABILIZATION SIGNS: At least one of:
   - Volume drying (volumeTrend < 0.7) — sellers exhausting
   - Bullish CHoCH — was bearish, now making higher highs (reversal forming)
   - Low-swept — wick below swing low, closed above (liquidity taken, buyers stepped in)
   - RSI oversold (< 30) — statistical mean reversion territory

3. NO STRUCTURAL BREAKDOWN: If the stock shows bearish BOS (break of structure confirmed
   to the downside), the decline is structural, not a dip — PASS

4. CONVICTION: 7/10 minimum

WHAT YOU ARE TESTING: Whether APEX's decline penalties (-1 to -3 for today's drop, low
momentum scores for 5-day losers) are correctly calibrated or overly aggressive. If your
dip-buying produces consistent winners, APEX is missing recoveries. If you consistently
lose, APEX's momentum bias is justified.

You will have flat days when no stocks meet your criteria. That is correct behavior.
Patience is essential — bad dip buys (catching knives) will corrupt the research data.`;
    }

    if (name === 'Draft') {
        return `
═══════════════════════════════════════════════════════════
DRAFT'S BUY FRAMEWORK (APEX 5-STEP + HARD VOLUME GATE)
═══════════════════════════════════════════════════════════

Use APEX's complete catalyst-first framework:
Step 1: Catalyst Evaluation (gate at 8+, or 6+ with perfect confirmation)
Step 2: Market Reaction Check
Step 3: Fundamental Quality Check
Step 4: Technical Timing
Step 5: Sector Context

THEN: HARD VOLUME GATE (Step 6 — non-negotiable)

Before ANY buy, check volume:
- BREAKOUT setup: Requires 1.5x average daily volume. If volume < 1.5x ADV, VETO the trade.
- PULLBACK setup: Requires volume drying to < 0.7x average daily volume. If volume > 0.7x ADV on a pullback, VETO.

If the setup scores 9/10 conviction but volume is absent, you SIT FLAT.
This is the entire experiment — volume as a hard gate, not a +/-0.5 scoring factor.

Volume data is in each candidate's data. Use the volumeTrend field (recent 2-day avg / early 2-day avg).
Also check the raw volume vs the short interest avgDailyVolume for ADV comparison.`;
    }

    if (name === 'Alloy') {
        return `
═══════════════════════════════════════════════════════════
ALLOY'S BUY FRAMEWORK (APEX 5-STEP, BULLISH BOS ONLY)
═══════════════════════════════════════════════════════════

Use APEX's complete catalyst-first framework:
Step 1: Catalyst Evaluation (gate at 8+, or 6+ with perfect confirmation)
Step 2: Market Reaction Check
Step 3: Fundamental Quality Check
Step 4: Technical Timing
Step 5: Sector Context

PRE-FILTER: Only consider candidates where marketStructure shows:
- bos: true AND bosType: "bullish"
- This is the Break of Structure pattern (+3 score in APEX's library)

If the best candidate has a Bullish CHoCH, FVG, Low-swept, or ANY other pattern — PASS.
Even a CHoCH scoring 9/10 gets passed. You ONLY trade Bullish BOS.

This is locked for the entire research cycle. No exceptions, no mid-cycle changes.
You will have flat days. That is correct behavior — depth over breadth.`;
    }

    // Shouldn't reach here
    return '';
}

export function buildPhase2Prompt(agentConfig, portfolio, filteredData, sectorSummary, vix, phase1Results, regime) {
    const agentName = agentConfig.name;
    const buyFramework = getAgentBuyFramework(agentConfig);

    // Phase 1 context
    let phase1Context = '';
    if (phase1Results) {
        if (phase1Results.sells?.length > 0) {
            phase1Context = `\n══ PHASE 1 RESULTS (Sells already decided) ══\nSells: ${phase1Results.sells.map(d => `SELL ${d.shares} ${d.symbol}: ${d.reasoning}`).join('\n')}\nMarket Regime: ${phase1Results.regime}\n══════════════════════════════════════\n`;
        } else {
            phase1Context = `\n══ PHASE 1 RESULTS: All holdings reviewed, no sells needed. ══\nMarket Regime: ${phase1Results.regime}\n`;
        }
    }

    // Position sizing reference
    const sizingRef = `
POSITION SIZING (by conviction):
10/10: 30-40% of portfolio | 9/10: 20-30% | 7-8/10: 15-20% | 6/10: 10-15% or PASS | <6: DO NOT TRADE

REGIME DEPLOYMENT:
Bull: 90-100% | Bear: 50-70% | Choppy: 60-80%`;

    return `You are ${agentConfig.fullName}, a FORGE research agent. PHASE 2: BUY DECISIONS.
Today: ${TODAY()}.

AGENT THESIS: ${agentConfig.thesis}
${phase1Context}
${vix ? `VIX: ${vix.level.toFixed(1)} (${vix.interpretation}${vix.trend !== 'stable' ? ', ' + vix.trend : ''})` : ''}
Market Regime: ${regime || 'choppy'} (determined centrally — use this for deployment limits)

${buyFramework}
${sizingRef}

Portfolio Cash: $${portfolio.cash.toFixed(2)}
Current Holdings: ${JSON.stringify(Object.keys(portfolio.holdings))}

SECTOR ROTATION (full market context):
${JSON.stringify(sectorSummary, null, 1)}

CANDIDATES (pre-screened, ranked by composite score):
${JSON.stringify(filteredData, null, 1)}

THESIS DISCIPLINE: Every decision must be justifiable under your thesis rules. If no candidates meet your criteria, respond with an empty decisions array. Sitting flat is correct behavior for ${agentName}.
IMPORTANT: Each symbol may appear AT MOST ONCE in your decisions. Do not recommend the same stock twice.
PRIORITY: Order BUY decisions by conviction (highest first). Top pick first.

JSON ONLY response:
{ "decisions": [{ "action": "BUY", "symbol": "X", "shares": N, "conviction": 1-10, "reasoning": "...", "expectedTarget": N${agentName === 'Strike' ? ', "mechanicalExit": N' : ''} }], "thesis_adherence": "summary of how decisions align with ${agentName}'s thesis" }`;
}
