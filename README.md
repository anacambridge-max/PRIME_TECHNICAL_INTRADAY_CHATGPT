# PRIME TECHNICAL INTRADAY — 09:20 F&O SCANNER

A probability-ranked intraday scanner for NSE F&O stocks designed to evaluate the first completed 5-minute candle (09:15–09:20 IST) and identify the strongest intraday candidates.

## Objective

At approximately 09:20 IST, scan the eligible F&O universe and rank symbols using opening structure, momentum, volume, VWAP, previous-day context, relative strength, breakout quality, and risk filters.

The system is a **decision-support scanner**, not a guarantee of future performance. The top-ranked symbol is the highest-scoring candidate under the model at that moment.

## Core modules

- F&O universe management
- 5-minute opening candle analytics
- Previous-day and multi-day context
- VWAP / opening-range analysis
- Volume and relative-volume analysis
- NIFTY and sector relative strength
- Breakout / breakdown quality filters
- Composite Prime Score (0–100)
- Entry trigger, invalidation and risk framework
- Historical backtesting and walk-forward validation
- 09:20 IST scheduled scan
- Dashboard for ranked candidates and explanations

## Planned stack

- Next.js / TypeScript
- Vercel
- Market-data provider / broker API
- Server-side scoring engine
- PostgreSQL/Supabase or equivalent persistence layer when required

## Safety

The application should clearly distinguish signal ranking from certainty. Results require independent risk management and should not be treated as financial advice.
