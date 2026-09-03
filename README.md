# PRIME TECHNICAL INTRADAY — LIVE 09:20 F&O SCANNER

Live Next.js dashboard for ranking NSE F&O equity underlyings immediately after the 09:15–09:20 IST opening candle.

## Live data
The backend uses the Upstox V3 intraday candle and market-quote APIs. Upstox documents 5-minute intraday candles and daily OHLC/previous OHLC fields for market analysis. The app keeps the access token server-side. citeturn0search1turn0search0

## Required Vercel environment variables
- `UPSTOX_ACCESS_TOKEN`
- `FNO_UNIVERSE_JSON` — JSON array of current NSE F&O equity underlyings with `symbol` and `instrumentKey` (and optional `sector`).

Example:
`[{"symbol":"RELIANCE","instrumentKey":"NSE_EQ|INE002A01018","sector":"Energy"}]`

Do not commit credentials. Upstox uses OAuth 2.0 and access tokens have a defined expiry; use the supported authentication flow to obtain a valid token. citeturn1search0turn1search3

## Scanner model
The first version scores opening structure, momentum, range quality, opening volume availability and directional candle quality. The next research layer will add benchmark/sector relative strength, VWAP, multi-session context, and walk-forward calibration.

The score is a ranking model, not a probability or guarantee. Historical validation must use only information available at 09:20.

## Run locally
`npm install`
`npm run dev`
