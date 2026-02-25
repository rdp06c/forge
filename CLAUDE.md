# FORGE
## APEX Companion Trader Research System
### Project Brief for Claude Code / Opus

---

## Overview

FORGE is a fleet of autonomous paper trading research agents that run independently of APEX, test distinct trading theses, and generate structured findings reports that can inform APEX's future logic and parameters. The agents do not interact with APEX during their run. They are researchers, not co-pilots.

**Timeframe:** Daily bars only — 40 daily bars of historical data, swing trading horizon of days to weeks. Agents evaluate setups on-demand per analysis cycle, not on an intraday schedule. This mirrors APEX exactly.

The core philosophy: APEX currently learns only from his own performance — an echo chamber. The Companion Traders break that ceiling by exploring strategies APEX would never test on himself, then feeding those findings back through a human-reviewed research cycle.

---

## Style
- Code first, brief explanation after
- Keep responses focused — no unnecessary preamble
- Prefer practical, working examples over abstract explanations

## Foundational rules

- Doing it right is better than doing it fast. You are not in a rush. NEVER skip steps or take shortcuts.
- Tedious, systematic work is often the correct solution. Don't abandon an approach because it's repetitive - abandon it only if it's technically wrong.
- Honesty is a core value. If you lie, you'll be replaced.
- You MUST think of and address your human partner as "Ryan" at all times

## Our relationship

- We're colleagues working together as "Ryan" and "Claude" - no formal hierarchy.
- Don't glaze me. The last assistant was a sycophant and it made them unbearable to work with.
- YOU MUST speak up immediately when you don't know something or we're in over our heads
- YOU MUST call out bad ideas, unreasonable expectations, and mistakes - I depend on this
- NEVER be agreeable just to be nice - I NEED your HONEST technical judgment
- NEVER write the phrase "You're absolutely right!"  You are not a sycophant. We're working together because I value your opinion.
- YOU MUST ALWAYS STOP and ask for clarification rather than making assumptions.
- If you're having trouble, YOU MUST STOP and ask for help, especially for tasks where human input would be valuable.
- When you disagree with my approach, YOU MUST push back. Cite specific technical reasons if you have them, but if it's just a gut feeling, say so.

## Proactiveness

When asked to do something, just do it - including obvious follow-up actions needed to complete the task properly.
  Only pause to ask for confirmation when:
  - Multiple valid approaches exist and the choice matters
  - The action would delete or significantly restructure existing code
  - You genuinely don't understand what's being asked
  - Your partner specifically asks "how should I approach X?" (answer the question, don't jump to
  implementation)
  
---

## APEX Framework Reference

FORGE agents are not constrained versions of APEX. They are independent researchers who share the same data environment but are free to process that data differently. The goal is to discover whether parts of APEX's decision framework are essential, optional, or potentially limiting.

### What All Agents Inherit Unconditionally

These three elements are constants across all five agents. They are never variables in the research — changing them would make cross-agent and cross-APEX comparisons meaningless.

**1. Stock Universe**
Fixed watchlist of ~490 stocks across 12 sectors. No dynamic scanning. Candidate selection uses APEX's composite scoring system (momentum, relative strength, sector rotation, structure, ML adjustments, etc.) with the top 25 by score, all current holdings, 5 sector wildcards, and up to 10 reversal candidates fed into analysis. Every agent sees the same candidate pool.

**2. Market Regime Detection**
Claude evaluates regime (bull/bear/choppy) based on VIX, sector breadth, holdings health, and news. Code validates with VIX fallback (>30 bear, >25 choppy, ≤25 bull). All agents operate in the same regime at the same time — regime is environmental, not a thesis variable.

**3. Position Sizing Framework**
Conviction level drives position size. Regime drives cash deployment. Adaptive deployment applies if win rate in current regime falls below 45% (deploy 15-20% less than guidelines). These rules apply identically across all five agents so that P&L findings are never distorted by sizing differences.

| Conviction | Position Size |
|---|---|
| 10/10 | 30-40% of portfolio |
| 9/10 | 20-30% |
| 7-8/10 | 15-20% |
| 6/10 | 10-15% or PASS |
| <6 | DO NOT TRADE |

| Regime | Cash Deployment |
|---|---|
| Bull | 90-100% |
| Bear | 50-70% |
| Choppy | 60-80% |

---

### What Is Thesis-Dependent

Everything beyond the three constants above is fair game for each agent to handle differently. This is where the real research lives. APEX's 5-step catalyst-first framework, his sell triggers, his entry quality tiers — these are APEX's current answers to hard questions. FORGE exists to test whether those answers are optimal.

**APEX's current decision framework (for reference — agents may adopt, modify, or replace):**

*5-Step Catalyst-First Chain:*
1. Catalyst Evaluation — Score 1-10, gate at 8+ (or 6+ with perfect confirmation)
2. Market Reaction Check — did the stock respond to the catalyst?
3. Fundamental Quality — revenue growth, earnings, margins, moat
4. Technical Timing — momentum, RS, RSI, MACD, structure; entry tier classification
5. Sector Context — inflow/outflow as confidence modifier

*Entry Quality Tiers:*

| Tier | Criteria | APEX Action |
|---|---|---|
| Extended | RS >85 + momentum 8+ | Avoid or 50% size |
| Good Entry | RS 60-80 + momentum 5-8 | Full size |
| Pullback | Down 2-8% over 5d, bullish structure intact | Preferred |
| Red Flag | RS <30 + momentum <3 + breaking support | Skip |

*Sell Triggers:*
- Negative catalyst / thesis broken
- Flexible profit-taking — 3-factor check at 20% / 30% / 50%+ gain
- Tiered stop-loss: -5% / -10% / -15% / -20%
- Catalyst failure timeframes
- Opportunity cost

*Hold Discipline:*
- Positions <3 days old: do not sell unless thesis clearly broken
- Positions 3-5 days old: sell only with conviction 8+ and structural breakdown
- Positions 5+ days: normal evaluation
- Same-day sells: blocked
- 5-day rebuy cooldown after selling a symbol

*Setup Type Library (ICT/SMC from detectStructure()):*

| Pattern | Score Impact |
|---|---|
| Bullish BOS — breaks above swing high in bullish trend | +3 |
| Bullish CHoCH — was bearish, now makes HH (reversal) | +2 |
| Low-swept — wick below swing low, closes above | +1 |
| Bullish structure — HH + HL pattern | +1 |
| Bullish FVG — gap up, unfilled support zone | +0.5 |

Agents reference this framework as APEX's current best answer. Their thesis determines how much of it they adopt, modify, or deliberately ignore. Findings from agents who deviate will tell us whether APEX's framework is essential or merely habitual.

---

### Portfolio JSON Schema

Each FORGE agent gets its own portfolio file following APEX's existing structure: `FORGE_[AgentName]_Portfolio.json`

Top-level fields mirror `Apex_Portfolio.json`: cash, initialBalance, holdings, transactions, performanceHistory, closedTrades, holdingTheses, lastMarketRegime, lastCandidateScores, lastSectorRotation, blockedTrades, tradingRules, holdSnapshots, regimeHistory, lastVIX, spyBaseline, spyCurrent, portfolioHealth.

closedTrades entries extend APEX's schema with FORGE-specific fields:
```json
{
  "symbol": "AAPL",
  "buyPrice": 150.00,
  "sellPrice": 158.00,
  "shares": 10,
  "profitLoss": 80.00,
  "returnPercent": 5.33,
  "buyDate": "ISO 8601",
  "sellDate": "ISO 8601",
  "holdTime": 432000000,
  "tracking": {
    "priceAfter1Week": null,
    "priceAfter1Month": null,
    "tracked": false
  },
  "exitReason": "profit_target|stop_loss|catalyst_failure|opportunity_cost",
  "agent": "Ember|Strike|Flux|Alloy|Draft",
  "forgeMetadata": {
    "cycleId": "FORGE_Cycle_1",
    "thesisQualified": true,
    "thesisAdherenceNotes": "Reasoning for why this met or deviated from thesis rules",
    "decisionFrameworkUsed": "Description of which parts of APEX framework were used vs modified",
    "catalystScore": 9,
    "entryTier": "Pullback",
    "regimeAtEntry": "choppy",
    "volumeConfirmed": true
  }
}
```

---

## Architecture Principles

- **Full separation of concerns** — Agents never write to or communicate with APEX during a research cycle
- **Paper trading only** — real market data from Polygon API drives every decision. The only thing not real is order execution. No actual capital is deployed, no brokerage integration needed
- **Human review in the middle** — Agents surface findings, Ryan evaluates, Ryan promotes logic into APEX deliberately
- **Google Drive logging** — Each agent gets its own structured log file following APEX's existing Drive conventions
- **Thesis discipline over P&L** — An agent is evaluated on whether it stayed true to its thesis AND its returns, not returns alone
- **Periodic review, not daily interference** — Weekly/bi-weekly summaries are the primary review cadence. Daily views are for curiosity only, not decision-making

---

## The Five Research Agents

Each agent has a codename, a core research question, and behavioral rules that define their thesis discipline.

---

### Agent 1: Ember — The Patience Agent
**Thesis:** Does extreme selectivity with a simplified decision model outperform APEX's complex multi-factor approach?

**Decision Framework:** Ember deliberately uses a stripped-down 3-factor model — catalyst strength, technical structure, and sector context only. He ignores fundamentals as a primary signal, testing whether APEX's fundamental quality step adds value or just adds noise at the highest conviction tier. If a setup scores 10/10 across his three factors, he trades. Everything else he ignores.

**Behavioral Rules:**
- Only trades when all three factors (catalyst, structure, sector) align perfectly
- Fundamentals are noted but do not gate the trade — this is the explicit test
- Will not touch anything that requires weighing or balancing factors
- Sits flat rather than forcing a trade
- No exceptions — if it's not a clear 10 across his three factors, he passes

**What success looks like:** Ember's simpler model matches or beats APEX's full framework at the highest conviction tier — suggesting APEX's complexity is noise, not signal, for perfect setups
**What failure looks like:** Dropping fundamentals produces more losers — APEX's 5-step chain validated as essential even at maximum conviction

---

### Agent 2: Strike — The Early Exit Agent
**Thesis:** Is APEX's profit-taking framework leaving money on the table, or is his reluctance to exit early actually optimal?

**Decision Framework:** Strike inherits APEX's full entry framework — catalyst gate, 5-step chain, entry tiers. His deviation is entirely on the exit side. He tests whether banking gains early and consistently outperforms APEX's flexible profit-taking approach which tries to optimize each exit individually.

**Behavioral Rules:**
- Entry decisions follow APEX's full 5-step framework (7/10 minimum conviction)
- Exits are mechanical — target 50-60% of the expected move, then exit regardless of momentum
- Does not apply APEX's 3-factor profit-taking check — the mechanical exit overrides it
- Stop-loss and catalyst failure sell triggers are inherited unchanged
- Observes hold discipline minimums (no sells before day 3 unless thesis clearly broken)

**What success looks like:** Mechanical early exits produce higher win rate and comparable or better net P&L — APEX is over-optimizing exits and giving back gains
**What failure looks like:** Early exits cap winners too aggressively — APEX's flexible approach captures more of the move and produces better overall returns

---

### Agent 3: Flux — The Dip Buyer
**Thesis:** Is APEX's momentum bias causing him to miss high-quality entries in temporarily depressed stocks that are showing stabilization?

**Decision Framework:** Flux buys meaningful pullbacks — stocks down 8-25% over 5 trading days — that show signs of stabilization. He tests whether APEX's composite scoring penalizes recent declines too aggressively (decline penalty of -1 to -3, low momentum scores), filtering out valid mean-reversion entries that would have produced profitable recoveries.

**Behavioral Rules:**
- Only considers stocks down 8-25% over 5 days — meaningful pullback territory, not noise
- Requires at least one stabilization signal: volume drying (<0.7x), bullish CHoCH, low-swept pattern, or RSI oversold (<30)
- Rejects stocks with bearish BOS (confirmed structural breakdown) — no catching falling knives
- Minimum conviction 7/10
- Exit framework follows APEX's standard sell triggers

**What success looks like:** Dip-buying produces consistent winners — APEX's decline penalties are too aggressive and filtering out recoverable pullbacks
**What failure looks like:** Dip buys produce losses as stocks continue declining — APEX's momentum bias is correctly calibrated and the penalties protect him from value traps

*Note: Flux was redesigned from a contrarian fade agent on Feb 24, 2026. The original design (fading overextended moves) tracked P&L as long positions, inverting results — losses meant the thesis worked. Portfolio reset to $50K at redesign.*

---

### Agent 4: Draft — The Volume Agent
**Thesis:** Should volume confirmation be a hard non-negotiable gate rather than the minor weighted factor (+/-0.5) it currently is in APEX's composite scoring?

**Decision Framework:** Draft uses a modified version of APEX's framework where volume confirmation is elevated from a marginal scoring input to a primary gate. He tests whether the narrow weight APEX gives volume (-0.5 to +0.5) is systematically undervaluing what is actually the most reliable confirmation signal available.

**Behavioral Rules:**
- Runs APEX's normal candidate evaluation and 5-step reasoning chain
- Adds a hard volume gate as a final pre-entry check — if volume doesn't confirm, the trade is vetoed regardless of everything else
- Volume confirmation defined as: 1.5x average daily volume on breakouts; drying to <0.5x average on pullbacks
- If the setup scores 9/10 conviction but volume is absent, Draft sits flat — this is the whole experiment
- Volume gate applies on entry only — exits follow APEX's standard sell framework

**What success looks like:** Hard volume gating produces meaningfully cleaner entries — APEX's current +/-0.5 weighting is systematically undervaluing the most reliable confirmation signal
**What failure looks like:** Too many valid setups get filtered out by the volume gate — APEX's light weighting of volume is actually appropriately calibrated

---

### Agent 5: Alloy — The Setup Purist
**Thesis:** Does deep specialization in a single setup type produce a sharper edge than APEX's adaptive multi-setup approach?

**Decision Framework:** Alloy uses APEX's full 5-step framework but applies it exclusively to one setup type — Bullish BOS (Break of Structure), the highest-scoring pattern (+3) in APEX's detectStructure() library. He tests whether pattern repetition and specialization builds a compounding edge that generalism cannot replicate. Everything else is ignored regardless of quality.

**Behavioral Rules:**
- Trades Bullish BOS setups only — no CHoCH, no FVG, no Low-swept, no exceptions
- Full APEX 5-step framework and conviction thresholds apply within that single setup type
- If the best candidate of the day is a CHoCH setup scoring 9/10, Alloy passes and waits for a BOS
- Setup type is locked for the entire research cycle — no mid-cycle changes
- Exit framework follows APEX's standard sell triggers unchanged

**What success looks like:** Specialization produces win rate and R:R that outpaces APEX's generalist approach — depth beats breadth
**What failure looks like:** Setup dependency creates too many flat days; APEX's flexibility across setup types is validated as essential for consistent opportunity flow

---

## Data & Logging

Each agent logs the following for every trade decision (entry, exit, and pass):

- Timestamp
- Ticker and timeframe
- Setup type identified
- Thesis qualification check (did this meet the agent's rules?)
- Real-time entry price — actual market price at moment of entry decision via Polygon API
- Real calculated target and stop levels — based on live price action, market structure, and ATR
- Real-time exit price — actual market price at moment of exit decision via Polygon API
- Real P&L tracking — what the trade would have returned had it been executed live
- Market conditions at time of decision (trending / choppy / volatile)
- Outcome (win / loss / breakeven / pass)
- Agent's internal reasoning summary (one paragraph)

**Storage:** Google Drive, one file per agent, following APEX's existing Drive file conventions. File naming: `FORGE_[Ember|Strike|Flux|Alloy|Draft]_Research_Log_[CycleStartDate].json`

---

## Monitoring Design

### Daily Dashboard (Primary Monitoring Tool)
- One unified view showing all five agents side by side
- Trades taken today, current open paper positions, running P&L
- Thesis adherence indicator per agent — are they staying in their lane?
- One-line reasoning visible per trade
- **No cross-agent P&L comparison on the daily view** — prevents premature conclusions
- Purpose: satisfy curiosity, not make decisions

### End-of-Cycle Debrief (Primary Research Artifact)
- Full structured findings report per agent generated by Sonnet
- Cross-agent pattern analysis — what did multiple agents independently agree on?
- Recommended logic candidates for APEX review
- Ryan reviews and decides what gets promoted into APEX

---

## Starting Balance & Position Sizing

**Starting balance per agent:** $50,000

Note: APEX's current portfolio started at $1,000. FORGE uses $50,000 to give APEX's conviction-based allocation framework enough room to breathe across all conviction levels and regime states — a $1,000 base would compress position sizing in ways that distort the research data.

Each agent inherits APEX's conviction-based allocation and market regime adjustment logic as their position sizing framework. Position sizing is a constant across all five agents — it is never a variable in the research. The agents are differentiated by their thesis discipline, not how they size positions.

- **Conviction level** drives position size per trade — exactly as APEX operates
- **Market regime** determines overall cash deployment at any given time (bull: 90–100%, bear: 50–70%, choppy: 60–80%)
- **Adaptive deployment** — if historical win rate in current regime falls below 45%, deploy 15-20% less than guidelines suggest (inherited from APEX)
- **Each agent's thesis** operates within that framework rather than replacing it

This ensures FORGE findings translate directly and cleanly to APEX without position sizing becoming a confounding variable in the debrief analysis.

Note: Ember will naturally concentrate larger positions per trade since every trade he takes is maximum conviction (10/10 = 30-40% of portfolio). This is intentional and is itself a research data point.

---

## Research Cycle

**Recommended duration:** Minimum one full market cycle — ideally 3 months covering both trending and choppy periods

**Cycle naming:** FORGE Cycle 1, FORGE Cycle 2, etc. — keeps Drive structure cleanly namespaced from APEX

**Cycle start:** Define the exact date each agent begins. All five should start simultaneously for clean comparison.

**Cycle end:** Agents stop trading. Findings reports are generated. Ryan reviews. Promotion decisions made.

**No mid-cycle changes** — agent rules are locked at cycle start. Changing rules mid-cycle invalidates the research.

---

## What Gets Passed to APEX (Post-Cycle)

The handoff is always human-mediated. Ryan reviews debrief findings and decides what gets promoted. The agents produce candidates, not mandates.

Because agents are not fully conforming to APEX's framework, findings may be more structurally significant than simple parameter tweaks. Potential artifacts that could be promoted:

- **Framework challenges** — evidence that a step in APEX's 5-step chain is unnecessary, counterproductive, or miscalibrated (e.g. Ember finding that fundamentals don't improve outcomes at max conviction; Flux finding that the catalyst gate is filtering valid fade opportunities)
- **Weighting adjustments** — evidence that a factor APEX currently underweights (e.g. volume) should carry more or less influence
- **Exit rule changes** — Strike's findings may indicate APEX's profit-taking approach should be more mechanical or more flexible
- **Setup-specific rules** — Alloy's findings may indicate APEX should apply different logic within specific setup types rather than uniform logic across all
- **Parameter adjustments** — conviction thresholds, stop multiples, position sizing ratios

What does NOT get auto-promoted: anything Ryan hasn't reviewed. Agents surface findings, Ryan evaluates credibility, Ryan implements deliberately.

---

## Model Strategy

Decision quality is the foundation of FORGE. Poor reasoning on individual trade decisions produces corrupt research data and meaningless debrief findings. As such:

- **Claude Sonnet — all agent decision-making** — every trade decision, entry/exit reasoning, and thesis qualification check across all five agents
- **Claude Sonnet — end-of-cycle debrief reports only** — one comprehensive findings report per agent at cycle end, where the expense is fully justified
- **No weekly narrative reports** — the dashboard replaces periodic summaries. Weekly reports are cost without proportional value given dashboard visibility

---

## Cost Estimate

| Component | Estimated Monthly Cost |
|---|---|
| Polygon API (already paying) | $0 incremental |
| Claude Sonnet (all agent decisions + end-of-cycle debriefs) | ~$30–60 |
| VPS / hosting (if needed beyond local) | $0–20 |
| **Total estimated** | **~$30–80/month** |

Full 3-month research cycle: approximately **$90–240 total**

*Note: Higher per-decision cost vs Haiku is the correct tradeoff — decision quality directly determines the value of the research data and the credibility of the final debrief findings.*

---

## Technical Notes for Implementation

- Agents share APEX's data environment but implement their own thesis-specific decision logic
- Leverage APEX's existing market analysis, technical indicator, and detectStructure() code directly
- No brokerage API integration needed — paper decisions are logged, not executed
- Each agent should have a personality config file defining its behavioral rules (makes thesis enforcement clean and auditable)
- Claude Sonnet handles all per-decision reasoning and end-of-cycle debrief generation

---

## Resolved Design Decisions

1. **Strike's early exit target** — 55% of the expected move, hard stop defined as entry price to the original price target level — clean, consistent, auditable.
2. **Draft's volume confirmation threshold** — 1.5x ADV on breakouts, <0.7x ADV on pullbacks.
3. **Logging format** — Extend APEX's existing JSON schema without question.
4. **Dashboard integration** — Standalone FORGE dashboard — separate from APEX Analytics Dashboard but following the same design conventions.
5. **Cycle start date** — February 23, 2026.
6. **Run frequency** — Once per day, after market close (5:00 PM ET weekdays). We discussed twice-daily to match APEX's cadence but decided against it — FORGE tests thesis frameworks, not timing. Daily bars don't change intraday, so a second run would have identical technicals with only slightly different snapshot prices. Not worth the added cost/complexity. If cycle 1 debrief reveals timing as a confounding variable, we can add a second run for cycle 2.
7. **VIX data source** — Yahoo Finance `^VIX` chart endpoint (free, real spot VIX). Polygon's Indices endpoint requires a plan add-on Ryan doesn't have. We tried VIXY ETF as a proxy but rejected it — VIXY tracks VIX futures (not spot), drifts structurally due to contango, and would need periodic threshold recalibration. Yahoo gives us the actual CBOE VIX number with standard thresholds (< 15 complacent, ≤ 20 normal, ≤ 30 elevated, > 30 panic). Polygon direct is still attempted first as a fallback in case the plan changes.

---

## Implementation Status

**Completed — Phases 1-3 + end-to-end testing + Google Drive (Feb 20, 2026)**

All core code is built, tested end-to-end against live market data, and uploading to Google Drive.

### File Structure
```
forge.js                    # Main orchestrator + cron (5 PM ET weekdays)
config/constants.js         # ~490 stocks, sectors, position sizing tables
config/agents.js            # 5 agent personality configs
data/cache.js               # File-based JSON cache with TTL
data/polygon.js             # 6 Polygon API functions + fetchAllMarketData()
data/technicals.js          # 9 pure technical functions + enrichMarketData()
portfolio/schema.js          # Portfolio creation/load/save
portfolio/manager.js         # executeBuy(), executeSell(), position sizing
ai/claude.js                # Anthropic SDK wrapper (claude-sonnet-4-6)
ai/parser.js                # 3-tier JSON parser
ai/prompts.js               # Per-agent Phase 1 + Phase 2 prompt templates
agents/base-agent.js        # Core runCycle() flow + candidate pool building
agents/ember.js             # 3-factor, conviction 10 only
agents/strike.js            # Full APEX entry, mechanical 55% exit
agents/flux.js              # Fades overextended moves
agents/draft.js             # Full APEX + hard volume gate
agents/alloy.js             # Full APEX, Bullish BOS only
drive/google-drive.js       # OAuth2 refresh token upload
drive/get-refresh-token.js  # One-time OAuth2 auth flow
test-data.js                # Data pipeline integration test
```

### Verified Working
- `npm run test-data` — Polygon data fetch + all technicals pass (10 symbols tested)
- `node forge.js --init` — All 5 portfolios created at $50K
- VIX via Yahoo Finance: real spot VIX (19.09 at time of test)
- All source files pass `node --check` syntax validation
- `npm run now` — Full end-to-end cycle completed (~3.5 min, all 5 agents, ~490 stocks)
- Google Drive uploads working — 5 portfolio files + cycle summary log per run

### Bugs Fixed (Feb 20, 2026)
1. **Duplicate symbol buys** — Sonnet sometimes returned the same symbol twice in Phase 2 decisions. Added code-level dedup guard in `base-agent.js` (tracks bought symbols per cycle) and prompt-level instruction in `prompts.js` to prevent duplicates at the source.
2. **Regime deployment cap not enforced** — Individual position sizing was capped, but nothing prevented total deployment across all positions from exceeding the regime's max (bull: 100%, bear: 70%, choppy: 80%). Added total deployment check before each buy in `base-agent.js`.
3. **Misleading portfolio log output** — Cycle complete line showed total portfolio value only ($50,000 on day one regardless of deployment). Changed to show `Value | Cash | Deployed %` per agent, and cash in the final summary block in `forge.js`.

### Google Drive Setup
- **Auth method:** OAuth2 with refresh token (service accounts lack storage quota on personal Google accounts)
- **Env vars required:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`
- **One-time setup:** `node drive/get-refresh-token.js` opens browser auth flow, prints refresh token
- **Uploads per cycle:** 5 portfolio JSONs + 1 cycle summary log to the shared FORGE folder

### Next Steps
1. **Phase 4: Raspberry Pi deployment** — pm2 setup, cron verification
2. **Phase 5: Dashboard** — Read-only HTML monitoring page (post-launch)

### Commands
- `npm run now` — Manual full cycle (all 5 agents)
- `npm run start` — Start cron scheduler (5 PM ET weekdays)
- `npm run test-data` — Test data pipeline only (no AI calls)
- `node forge.js --init` — Create/reset portfolio files
- `node drive/get-refresh-token.js` — One-time OAuth2 setup for Google Drive

---

*FORGE — Document version: Implementation v1.1 — End-to-end tested, Drive integrated*
