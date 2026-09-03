# Scanner Specification

## 1. Signal time

Primary signal is generated immediately after the NSE 09:15–09:20 IST 5-minute candle is complete.

## 2. Universe

Only currently eligible NSE F&O equities should enter the primary ranking. The universe must be refreshed rather than hard-coded permanently.

## 3. Opening candle features

For each symbol:
- open, high, low, close
- candle body and body/range ratio
- upper and lower wick ratios
- opening gap versus previous close
- first-candle return
- first-candle range versus recent 5-minute ranges
- close location within candle

## 4. Context features

- previous-day OHLC and range
- previous-day high/low proximity
- recent 3/5/10/20-session price structure
- consolidation/compression
- breakout and breakdown proximity
- daily trend regime

## 5. Intraday confirmation

- VWAP position
- distance from VWAP
- relative volume
- volume expansion
- price-volume confirmation
- opening-range quality
- immediate resistance/support overhead
- NIFTY relative strength
- sector relative strength

## 6. Prime score

The initial score is normalized to 0–100. It should be treated as a model score, not a probability, until calibrated by historical research.

Suggested initial components:
- Opening structure: 20
- Momentum: 20
- Volume: 15
- Market context: 15
- VWAP: 10
- Relative strength: 10
- Breakout quality: 10

Weights must remain configurable so that backtesting can optimize them without changing the UI.

## 7. Anti-fake-move filters

Penalize or reject setups with:
- weak candle close
- excessive upper wick on long candidates
- excessive lower wick on short candidates
- very low relative volume
- immediate major resistance/support
- extreme gap extension without continuation
- strong conflict with index direction
- strong conflict with sector direction

## 8. Output

The UI should show:

1. Top-ranked candidate
2. Top 5 candidates
3. Long/short bias
4. Prime score
5. Trigger price
6. Invalidaton/stop framework
7. Target framework
8. Risk/reward estimate
9. Main reasons for the rank
10. Reasons to reject/avoid the setup

## 9. Validation

Backtest the exact 09:20 information set without look-ahead bias. Evaluate:
- top-1 future return rank
- top-5 hit rate
- benchmark-relative return
- win rate by score bucket
- drawdown
- payoff ratio
- performance by market regime
- performance by sector

Historical validation must use only information available at 09:20 for each trading day.
