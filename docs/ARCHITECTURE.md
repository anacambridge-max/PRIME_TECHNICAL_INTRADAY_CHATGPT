# Architecture

```text
Market Data / Broker API
        |
        v
  Data Normalizer
        |
        +--> F&O Universe
        +--> 5m OHLCV
        +--> Daily Context
        +--> Index/Sector Data
        |
        v
 Feature Engine
        |
        v
 Prime Technical Scoring Engine
        |
        +--> Long Score
        +--> Short Score
        +--> Quality Filters
        +--> Risk/Reward
        |
        v
  09:20 Ranking
        |
        +--> Top 1
        +--> Top 5
        +--> Avoid List
        |
        v
 Next.js Dashboard
```

## Design principles

### No look-ahead
At the 09:20 run, the engine may only use data available at or before 09:20 IST.

### Separation of concerns
Data ingestion, feature calculation, scoring, validation, and presentation remain separate modules.

### Explainable ranking
Every score must be decomposable into named components so the user can understand why a symbol ranked highly.

### Configurable model
Weights, thresholds, universe rules and risk parameters belong in configuration rather than being scattered through the UI.

### Reliability
The scheduled scan should be idempotent, log its source timestamp, store the generated ranking, and expose data freshness/errors in the dashboard.
