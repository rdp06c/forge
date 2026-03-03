# FORGE Backtester
## Deterministic Portfolio Simulation for APEX
### Project Brief for Claude Code / Opus

---

## Overview

FORGE is a deterministic portfolio backtester that simulates APEX's trading logic over historical market data. It replaces the original FORGE agent system (5 AI paper-trading agents) which was retired after APEX's calibration engine (17K+ historical observations) empirically answered most of the agents' thesis questions.

FORGE tests things calibration CAN'T answer: full portfolio simulation with position sizing, deployment caps, hold discipline, exit strategies, and regime-aware behavior over extended historical periods.

**No AI calls** — all decisions are deterministic. Cost = Polygon API only.

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
- NEVER write the phrase "You're absolutely right!" You are not a sycophant. We're working together because I value your opinion.
- YOU MUST ALWAYS STOP and ask for clarification rather than making assumptions.
- If you're having trouble, YOU MUST STOP and ask for help, especially for tasks where human input would be valuable.
- When you disagree with my approach, YOU MUST push back. Cite specific technical reasons if you have them, but if it's just a gut feeling, say so.

## Proactiveness

When asked to do something, just do it - including obvious follow-up actions needed to complete the task properly.
  Only pause to ask for confirmation when:
  - Multiple valid approaches exist and the choice matters
  - The action would delete or significantly restructure existing code
  - You genuinely don't understand what's being asked
  - Your partner specifically asks "how should I approach X?" (answer the question, don't jump to implementation)

---

## Architecture

### Anti-Look-Ahead Bias

`DataManager.getMarketState(simDate)` is the single enforcement point. All downstream code only sees windowed data (bars with timestamp <= simDate, last 80 bars). This is the critical design constraint.

### Scoring Sync with APEX

`data/technicals.js` must match APEX's current `calculateCompositeScore()`. Synced from APEX Mar 3, 2026. Key scoring details:
- Decline penalty = 0 (calibration proved anti-predictive, r=-0.08 to -0.11)
- Momentum and RS scaled 0.6x (was overweighted)
- Structure weight 1.25x (was underweighted)
- SMA proximity bonus (+2.0 near SMA20, -1.5 extended above)
- SMA crossover bonus (golden/death cross detection)
- Entry quality multiplier (0.3x extreme → 1.3x pullback)
- Returns `{ total, breakdown }` (not plain number)

### Simulation Loop (engine/engine.js)

For each trading day:
1. `dataManager.getMarketState(simDate)` → windowed bars
2. `enrichMarketData()` → technicals + composite scores
3. `determineRegime(vix, sectorRotation)` → regime
4. `processExits()` → sell signals evaluated, executed
5. `processEntries()` → candidate pool built, entries executed
6. Record daily snapshot
7. After final day: force-close all positions, compute metrics

### Strategies (config/strategies.js)

Each strategy is a plain config object defining:
- **convictionMap** — score thresholds → conviction levels
- **entry rules** — maxHoldings, sectorConcentration, redFlagGate, volumeGate
- **exit rules** — stopLoss tiers, scoreDegradation, mechanicalTarget, holdDiscipline
- **pool config** — topN, wildcards, reversals

| Strategy | What It Tests |
|---|---|
| `baseline` | APEX's current logic as deterministic rules |
| `earlyExit` | Strike's thesis: mechanical 55% target exit |
| `volumeGated` | Draft's thesis: hard 1.5x ADV volume gate |
| `aggressive` | Lower thresholds, wider stops, more holdings |

---

## File Structure

```
backtest.js                  # CLI entry point
test-backtest.js             # 96 tests across all modules
config/constants.js          # ~490 stocks, sectors, position sizing tables
config/strategies.js         # Strategy definitions (baseline, earlyExit, volumeGated, aggressive)
data/cache.js                # File-based JSON cache with TTL
data/polygon.js              # Polygon API functions
data/technicals.js           # Technical indicators + composite scoring (synced from APEX)
engine/data-manager.js       # Historical data fetcher + anti-look-ahead windowing
engine/regime.js             # VIX-based regime determination
engine/candidate-pool.js     # APEX candidate pool builder
engine/entry-rules.js        # Deterministic entry logic + score→conviction mapping
engine/exit-rules.js         # Deterministic exit logic (stops, targets, degradation)
engine/engine.js             # Main simulation loop
engine/results.js            # Metrics computation + output formatting
portfolio/schema.js          # Portfolio creation
portfolio/manager.js         # executeBuy(), executeSell(), position sizing
dashboard/server.js          # Results dashboard (port 3000)
dashboard/index.html         # Dashboard HTML
dashboard/style.css          # Dashboard styles
dashboard/js/app.js          # Dashboard client JS
results/                     # Backtest output JSONs
```

---

## Commands

```bash
node backtest.js --strategy=baseline                     # Run single strategy
node backtest.js --strategy=baseline --start=2025-06-01  # Custom date range
node backtest.js --all                                   # Run all strategies + comparison
node backtest.js --balance=100000                        # Custom starting balance
npm test                                                 # Run 96 unit tests
npm run dashboard                                        # Start results dashboard
```

---

## Constants (shared with APEX)

| Setting | Value |
|---|---|
| Stock Universe | ~490 stocks across 12 sectors |
| Position Sizing | Conviction 6: 10-15%, 7-8: 15-20%, 9: 20-30%, 10: 30-40% |
| Regime Deployment | Bull: 90-100%, Bear: 50-70%, Choppy: 60-80% |
| Hold Discipline | Min 3 trading days (unless -15% stop hit) |
| Rebuy Cooldown | 5 trading days after selling a symbol |
| Adaptive Deployment | Win rate < 45% in regime → reduce 17.5% |

---

## Data Sources

- **Polygon API** — grouped daily bars (all stocks per date). Cached 30 days.
- **Yahoo Finance** — historical VIX (^VIX chart endpoint). Cached 7 days.
- **Env var required:** `POLYGON_API_KEY` in `.env`

---

## Key Design Notes

- **~190 trading days** for a 9-month backtest = ~270 Polygon API calls (with lookback). Cached after first run.
- **SPY benchmark** — tracked automatically since SPY is in the universe
- **Short interest + news** — excluded (not available historically). Scoring handles nulls gracefully.
- **Date handling** — uses UTC (`getUTCDay()`, `setUTCDate()`) to avoid timezone issues on different machines.

---

*FORGE Backtester v2.0 — Built March 2026*
