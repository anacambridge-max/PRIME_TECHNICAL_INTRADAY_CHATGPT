import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Instrument = { symbol: string; instrumentKey: string; sector?: string };
type Candle = [string, number, number, number, number, number, number?];

type Row = {
  symbol: string; score: number; bias: 'LONG' | 'SHORT'; setup: string;
  entry: number; stop: number; target1: number; rr: number; reasons: string[];
  firstReturn: number; rangePct: number; volume: number;
};

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function scoreCandle(c: Candle, prevClose: number): Row {
  const [, open, high, low, close, volume] = c;
  const range = Math.max(high - low, 0.0001);
  const body = Math.abs(close - open);
  const bodyPct = body / range;
  const closeLocation = (close - low) / range;
  const ret = prevClose ? ((close / prevClose) - 1) * 100 : ((close / open) - 1) * 100;
  const rangePct = (range / Math.max(open, 0.0001)) * 100;
  const bullish = close >= open;
  const wickAgainst = bullish ? high - close : close - low;
  const wickPenalty = clamp((wickAgainst / range) * 20, 0, 20);
  const structure = clamp(bodyPct * 20 + Math.abs(closeLocation - 0.5) * 40 - wickPenalty);
  const momentum = clamp(Math.abs(ret) * 18);
  const volumeScore = volume > 0 ? 10 : 0;
  const breakout = bullish ? (close > open ? 8 : 0) : (close < open ? 8 : 0);
  const total = Math.round(clamp(structure + momentum + volumeScore + breakout + 15));
  const risk = range * 0.55;
  const entry = close;
  const stop = bullish ? low - range * 0.08 : high + range * 0.08;
  const target1 = bullish ? entry + Math.max(risk * 2, range) : entry - Math.max(risk * 2, range);
  const rr = Math.abs(target1 - entry) / Math.max(Math.abs(entry - stop), 0.0001);
  const reasons = [
    `${bodyPct >= 0.6 ? 'Strong' : 'Moderate'} opening body`,
    `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% first-candle return`,
    `${rangePct.toFixed(2)}% opening range`,
    volume > 0 ? 'Opening volume confirmed' : 'Volume unavailable'
  ];
  return { symbol: '', score: total, bias: bullish ? 'LONG' : 'SHORT', setup: bullish ? 'Opening Momentum' : 'Opening Breakdown', entry, stop, target1, rr, reasons, firstReturn: ret, rangePct, volume };
}

async function upstox(path: string, token: string) {
  const r = await fetch(`https://api.upstox.com${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`Upstox ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function GET() {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: 'UPSTOX_ACCESS_TOKEN is not configured' }, { status: 503 });
  let universe: Instrument[] = [];
  try { universe = JSON.parse(process.env.FNO_UNIVERSE_JSON || '[]'); } catch { return NextResponse.json({ ok:false, error:'FNO_UNIVERSE_JSON is invalid JSON' }, { status:500 }); }
  if (!universe.length) return NextResponse.json({ ok:false, error:'FNO_UNIVERSE_JSON is empty' }, { status:503 });

  const results: Row[] = [];
  const batchSize = 20;
  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    await Promise.all(batch.map(async (inst) => {
      try {
        const encoded = encodeURIComponent(inst.instrumentKey);
        const [intraday, daily] = await Promise.all([
          upstox(`/v3/historical-candle/intraday/${encoded}/minutes/5`, token),
          upstox(`/v3/market-quote/ohlc?instrument_key=${encoded}&interval=1d`, token)
        ]);
        const candles: Candle[] = intraday?.data?.candles || [];
        const first = candles.find(x => typeof x?.[0] === 'string' && x[0].includes('09:15')) || candles[0];
        if (!first) return;
        const key = Object.keys(daily?.data || {})[0];
        const d = key ? daily.data[key] : undefined;
        const prevClose = num(d?.prev_ohlc?.close) || num(d?.live_ohlc?.open) || num(first[1]);
        const row = scoreCandle(first, prevClose);
        row.symbol = inst.symbol;
        row.score = clamp(row.score);
        results.push(row);
      } catch { /* skip unavailable instruments; keep scanner resilient */ }
    }));
  }
  results.sort((a,b) => b.score - a.score || Math.abs(b.firstReturn) - Math.abs(a.firstReturn));
  return NextResponse.json({ ok:true, generatedAt:new Date().toISOString(), signalTime:'09:20 IST', universe:universe.length, scanned:results.length, rows:results.slice(0, 20) }, { headers:{'Cache-Control':'no-store'} });
}
