# FORGE Signal Backtester
## Signal x Exit Strategy Matrix for APEX
### Project Brief for Claude Code / Opus

---

## Overview

FORGE is a deterministic signal backtester that tests APEX's entry signals against different exit strategies across multiple time periods. It answers two questions:

1. **Do APEX's entry signals predict winners?** Tested against a NOSIGNAL baseline (composite-score-only entries) to measure alpha.
2. **Which exit strategy works best per signal?** A matrix of 18 exit strategies tested across 6mo, 1yr, 3yr, 5yr, and 8yr windows to find durable edges.

APEX is a **scorecard guidance system** — it scores and ranks candidates using calibrated formulas, but Ryan makes all buy/sell decisions. FORGE provides mechanical benchmarks so Ryan can see which rules add value versus which are better left to judgment.

**Key finding (March 2026):** The REV (Reversal) signal is genuinely predictive — profitable with every exit strategy over 8 years. The most durable exit strategies across all time periods are `target20_trail10` (+20% target or 10% trailing stop) and `target20` (+20% fixed target).

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

### Data Flow (Per Sim Day)

```
DataManager.getMarketState(simDate)  [anti-look-ahead windowing]
  → technicals.js: raw indicators (RSI, MACD, SMA, structure, momentum, RS, ATR, etc.)
  → scoring.js: composite score (synced from APEX) + enrichment orchestration
  → signals.js: evaluate 6 entry signal patterns per stock
  → Engine loop (compute enrichment ONCE, then for each signal x exit combo):
      candidate-pool.js → entry-rules.js → exit-rules.js → snapshot
```

### Entry Signals (data/signals.js — ported from APEX)

| Signal | Criteria | Min Match | Calibration Edge |
|---|---|---|---|
| REV | MACD bull, RSI<40, Bull structure, Pullback -2% to -8% | 2 of 4 | **+19pp** (positive) |
| MOM | Momentum 5-8, RSI<50, Bull structure, RS>50 | 3 of 4 | Negative |
| QMO | Vol<0.5x, Momentum≥7, Bull structure, RSI<70 | 3 of 4 | Flat/negative |
| SQZ | DTC>5, Bull structure, Sector inflow | 2 of 3 | Cold |
| LDR | RS>60, Sector inflow, Bull structure | 2 of 3 | Mixed |
| AVOID | RSI>70, Runner +5%, Momentum≥9, Vol declining | 2 of 4 | Anti-pattern (blocks entries) |

Each evaluator returns `{ quality: 'full'|'strong'|'partial'|null }`. Signal quality maps to conviction: full=9, strong=8, partial=7.

### Exit Strategies (config/strategies.js)

18 exit configs — every strategy must have a defined exit for both winners AND losers:
- **Fixed targets**: +10%, +15%, +20%, +30% (with -10% stop)
- **Time-based**: 5, 8, 10, 15, 20 trading days (with -10% stop)
- **Score degradation**: 50%, 35% drop thresholds
- **Trailing stops**: 5%, 8%, 10%, 2xATR
- **Combinations**: target+trailing, time+trailing

Exit evaluation order (first match wins): hard stop → profit target → trailing stop → time-based → score degradation.

### Scoring Sync with APEX

`data/scoring.js` contains `calculateCompositeScore()` synced from APEX Mar 3, 2026:
- Decline penalty = 0 (calibration proved anti-predictive)
- Momentum and RS scaled 0.6x (was overweighted)
- Structure weight 1.25x (was underweighted)
- SMA proximity/crossover bonuses
- Entry quality multiplier (0.3x extreme → 1.3x pullback)
- Returns `{ total, breakdown }`

### Two Execution Modes

- **Realistic**: Capital-constrained ($30K default), conviction-based position sizing, regime deployment caps. Answers "what would my actual portfolio return?"
- **Unconstrained** (`--unconstrained`): Infinite cash, fixed $5K positions, no caps. Answers "does this signal actually predict winners?" Pure signal accuracy.

### Matrix Mode (engine/engine.js)

`runMatrix()` computes enrichment once per sim day, then runs N strategy passes against the same data. This makes testing 18 exit strategies nearly as fast as testing 1, since data fetching/enrichment is ~95% of runtime.

---

## File Structure

```
backtest.js                  # CLI entry point
test-backtest.js             # 183 tests across 29 sections
config/calibration.js        # Default + calibrated weights, signal edges
config/constants.js          # ~490 stocks, sectors, position sizing tables
config/strategies.js         # Signal configs (7), exit configs (18), presets, matrix generator
data/cache.js                # File-based JSON cache with TTL
data/polygon.js              # Polygon API functions
data/technicals.js           # Raw technical indicators (RSI, SMA, MACD, structure, momentum, RS, ATR)
data/signals.js              # 6 APEX entry signal evaluators (REV, MOM, QMO, SQZ, LDR, AVOID)
data/scoring.js              # Composite scoring + enrichMarketData orchestration
engine/data-manager.js       # Historical data fetcher + anti-look-ahead windowing
engine/regime.js             # VIX-based regime determination
engine/candidate-pool.js     # Signal-filtered candidate pool
engine/entry-rules.js        # Signal quality → conviction → entry
engine/exit-rules.js         # Configurable multi-strategy exits
engine/engine.js             # Simulation loop + matrix mode
engine/results.js            # Metrics + signal accuracy + matrix summary
portfolio/schema.js          # Portfolio creation (supports unconstrained mode)
portfolio/manager.js         # executeBuy(), executeSell(), position sizing
dashboard/server.js          # Dashboard server (port 3000) — consistency, matrix, signal APIs
dashboard/index.html         # Dashboard HTML
dashboard/style.css          # Dashboard styles
dashboard/js/app.js          # Dashboard client JS
results/                     # Backtest output JSONs
```

---

## Commands

```bash
# Single signal + exit combo
node backtest.js --signal=REV --exit=trail8

# With weight selection
node backtest.js --signal=REV --exit=trail8 --weights=default

# Named preset
node backtest.js --preset=rev-baseline

# One signal, all exits (matrix)
node backtest.js --signal=REV --matrix

# Full matrix (all signals x all exits)
node backtest.js --matrix

# Custom date range and balance
node backtest.js --signal=REV --matrix --start=2018-03-17 --balance=30000

# Pure signal accuracy (unconstrained, $5K/trade, no caps)
node backtest.js --signal=REV --matrix --unconstrained

# Tests and dashboard
npm test                                    # 183 unit tests
npm run dashboard                           # Start dashboard on port 3000
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

---

## Data Sources

- **Polygon API** — grouped daily bars (all stocks per date). Stocks-Advanced plan, no historical limit. Cached 30 days.
- **Yahoo Finance** — historical VIX (^VIX chart endpoint). Cached 7 days.
- **Env var required:** `POLYGON_API_KEY` in `.env`

---

## Dashboard (http://192.168.0.248:3000)

Hosted on Pi via PM2 (`forge-dashboard`).

| Tab | Purpose |
|---|---|
| **Consistency** (primary) | Cross-timeframe table: each exit strategy's return/WR across 6mo, 1yr, 3yr, 5yr, 8yr. Green "ALL PROFIT" badge for durable strategies. |
| **Matrix** | Heatmap for a single run (signal × exit), metric selector dropdown |
| **Signal Accuracy** | Per-signal stats aggregated across runs, quality breakdown |
| **All Results** | Every result file, clickable to detail view with equity curve and trade log |
| **My Trades** | Live APEX trades from Pi portfolio.json |

---

## Key Design Notes

- **Date handling** — uses UTC (`getUTCDay()`, `setUTCDate()`) to avoid timezone issues.
- **SPY benchmark** — tracked automatically since SPY is in the universe.
- **Earnings gate for REV** — skipped in backtester (historical earnings dates not in Polygon grouped daily bars).
- **DTC for SQZ** — unreliable historically (short interest not available). SQZ results have limited data.
- **Matrix runtime** — ~18 strategies × 5 periods at $30K ≈ 15-20 min total (data cached after first run).

---

*FORGE Signal Backtester v3.0 — Built March 2026*
