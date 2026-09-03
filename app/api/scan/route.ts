import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Instrument = { symbol: string; instrumentKey: string };
type Candle = [string, number, number, number, number, number, number?];
type Daily = { open:number; high:number; low:number; close:number; volume?:number };
type Row = {
  symbol:string; score:number; bias:'LONG'|'SHORT'; setup:string; trigger:number; stop:number; target1:number; rr:number;
  reasons:string[]; firstReturn:number; rangePct:number; volume:number; volumeRatio:number; volumeStars:number;
  lastPrice:number; status:'WATCH'|'SETUP'|'CONFIRMED'|'FAKE BREAKOUT'|'NO TRADE'; level:string;
  ema20:number; emaAligned:boolean; compression:boolean; nr4:boolean; nr7:boolean; room:boolean;
};

const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
const clamp=(v:number,lo=0,hi=100)=>Math.max(lo,Math.min(hi,v));
const istNow=()=>new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'});
const todayISO=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=(n:number)=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};

async function up(path:string,token:string){
  const r=await fetch('https://api.upstox.com'+path,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!r.ok) throw new Error(`Upstox ${r.status}`);
  return r.json();
}

async function getUniverse():Promise<Instrument[]>{
  const configured=process.env.FNO_UNIVERSE_JSON;
  if(configured){try{return JSON.parse(configured)}catch{throw new Error('FNO_UNIVERSE_JSON is invalid JSON')}}
  const r=await fetch('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',{cache:'no-store'});
  if(!r.ok) throw new Error('Unable to download Upstox NSE instrument master');
  const records=JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')) as any[];
  const today=new Date(); today.setHours(0,0,0,0);
  const bySymbol=new Map<string,any>();
  for(const x of records){
    if(x.segment!=='NSE_FO'||x.instrument_type!=='FUT'||x.underlying_type!=='EQUITY'||!x.underlying_symbol||!x.underlying_key)continue;
    const expiry=new Date(typeof x.expiry==='number'?x.expiry:x.expiry);
    if(expiry<today)continue;
    const old=bySymbol.get(x.underlying_symbol);
    if(!old||new Date(typeof old.expiry==='number'?old.expiry:old.expiry)>expiry)bySymbol.set(x.underlying_symbol,x);
  }
  return [...bySymbol.values()].slice(0,120).map(x=>({symbol:x.underlying_symbol,instrumentKey:x.underlying_key}));
}

function levels(prev:Daily){
  const YH=prev.high,YL=prev.low,MID=(YH+YL)/2;
  const P=(YH+YL+prev.close)/3;
  return {YH,YL,MID,R1:2*P-YL,R2:P+(YH-YL),R3:YH+2*(P-YL),S1:2*P-YH,S2:P-(YH-YL),S3:YL-2*(YH-P)};
}
function ema(values:number[],len=20){
  if(!values.length)return 0;
  const k=2/(len+1); let e=values[0];
  for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);
  return e;
}
function dailyCompression(ds:Daily[]){
  if(ds.length<8)return {compression:false,nr4:false,nr7:false};
  const ranges=ds.slice(-8).map(d=>d.high-d.low);
  const recent=ranges.slice(-4).reduce((a,b)=>a+b,0)/4;
  const base=ranges.slice(0,7).reduce((a,b)=>a+b,0)/7;
  const recentATR=recent, atrBase=base;
  const highs=ds.slice(-7).map(d=>d.high), lows=ds.slice(-7).map(d=>d.low);
  const band=Math.max(...highs)-Math.min(...lows);
  const compression=base>0 && recentATR/base<=0.75 && recentATR/atrBase<=0.80 && band>0;
  const dayRanges=ds.map(d=>d.high-d.low);
  const last=dayRanges[dayRanges.length-1];
  const nr4=last<=Math.min(...dayRanges.slice(-4));
  const nr7=last<=Math.min(...dayRanges.slice(-7));
  return {compression,nr4,nr7};
}

async function enrich(inst:Instrument, first:Candle, prev:Daily, lastPrice:number, token:string, niftyReturn:number):Promise<Row>{
  const firstOpen=first[1], firstHigh=first[2], firstLow=first[3], firstClose=first[4], firstVol=num(first[5]);
  const range=Math.max(firstHigh-firstLow,0.0001), body=Math.abs(firstClose-firstOpen), bodyPct=body/range;
  const closePos=(firstClose-firstLow)/range, bull=firstClose>firstOpen, bear=firstClose<firstOpen;
  const firstReturn=prev.close?((firstClose/prev.close)-1)*100:0;
  const gapPct=prev.close?((firstOpen/prev.close)-1)*100:0;
  const upper=(firstHigh-Math.max(firstOpen,firstClose))/range;
  const lower=(Math.min(firstOpen,firstClose)-firstLow)/range;
  const strongBull=closePos>=0.75, strongBear=closePos<=0.25;
  const baseDate=daysAgo(35), today=todayISO();
  let candles:Candle[]=[]; let daily:Candle[]=[];
  try{
    const e=encodeURIComponent(inst.instrumentKey);
    const [h,d]=await Promise.all([
      up(`/v3/historical-candle/${e}/minutes/5/${today}/${baseDate}`,token),
      up(`/v3/historical-candle/${e}/days/1/${today}/${daysAgo(20)}`,token)
    ]);
    candles=(h?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
    daily=(d?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
  }catch{}
  const priorBars=candles.filter(c=>String(c[0]).slice(0,10)!==today).slice(-60);
  const closes=priorBars.map(c=>c[4]).concat([firstClose]);
  const ema20=ema(closes.slice(-60),20);
  const priorVols=priorBars.slice(-19).map(c=>num(c[5]));
  const volMA=(priorVols.concat([firstVol])).reduce((a,b)=>a+b,0)/Math.max(priorVols.length+1,1);
  const volRatio=volMA>0?firstVol/volMA:0;
  const stars=volRatio>=6.5?3:volRatio>=4?2:volRatio>=2?1:0;
  const priceAbove=firstClose>ema20, priceBelow=firstClose<ema20;
  const emaSlope=ema20>ema(closes.slice(-21,-1),20);
  const emaLong=priceAbove&&emaSlope, emaShort=priceBelow&&!emaSlope;
  const L=levels(prev);
  const atrProxy=Math.max((priorBars.slice(-14).reduce((a,c)=>a+(c[2]-c[3]),0)/Math.max(Math.min(priorBars.length,14),1)),range);
  const tol=atrProxy*0.3;
  const near=(v:number,l:number)=>Math.abs(v-l)<=tol;
  const res:[string,number][]=[['YH',L.YH],['R1',L.R1],['R2',L.R2],['R3',L.R3]];
  const sup:[string,number][]=[['YL',L.YL],['S1',L.S1],['S2',L.S2],['S3',L.S3]];
  const resHit=res.find(([,v])=>near(firstHigh,v));
  const supHit=sup.find(([,v])=>near(firstLow,v));
  const brokeRes=res.find(([,v])=>firstClose>v);
  const brokeSup=sup.slice().reverse().find(([,v])=>firstClose<v);
  const nextRes=res.filter(([,v])=>v>firstClose).sort((a,b)=>a[1]-b[1])[0];
  const nextSup=sup.filter(([,v])=>v<firstClose).sort((a,b)=>b[1]-a[1])[0];
  const roomLong=!!nextRes ? nextRes[1]-firstClose>atrProxy*0.75 : true;
  const roomShort=!!nextSup ? firstClose-nextSup[1]>atrProxy*0.75 : true;
  const comp= daily.length>=8 ? dailyCompression(daily.map(c=>({open:c[1],high:c[2],low:c[3],close:c[4]}))) : {compression:false,nr4:false,nr7:false};
  const locationBull=!!supHit||!!brokeRes;
  const locationBear=!!resHit||!!brokeSup;
  const level= bull ? (brokeRes?.[0]||supHit?.[0]||'NONE') : (brokeSup?.[0]||resHit?.[0]||'NONE');
  const participation=stars>=1;
  let bias:'LONG'|'SHORT'=bull?'LONG':'SHORT';
  let setup='WATCH';
  if(bull&&locationBull)setup='Setup 1 • Normal BUY';
  if(bear&&locationBear)setup='Setup 1 • Normal SELL';
  if((bull&&resHit&&!brokeRes)||(bear&&supHit&&!brokeSup))setup='Setup 2 • Fake Breakout ARMED';
  const fakeArmed=(bull&&resHit&&!brokeRes)||(bear&&supHit&&!brokeSup);
  const eligibleNormal=(bull&&locationBull&&strongBull&&participation&&emaLong&&roomLong)||(bear&&locationBear&&strongBear&&participation&&emaShort&&roomShort);
  const confirmedNow=(bull&&brokeRes&&strongBull&&participation&&emaLong&&roomLong)||(bear&&brokeSup&&strongBear&&participation&&emaShort&&roomShort);
  const exhausted=Math.abs(gapPct)>3||Math.abs(firstReturn)>4.5||(bull?upper:lower)>0.30||bodyPct<0.45;
  if(!eligibleNormal&&!fakeArmed)setup='WATCH';
  if(exhausted&&!confirmedNow)setup='NO TRADE';
  let status:'WATCH'|'SETUP'|'CONFIRMED'|'FAKE BREAKOUT'|'NO TRADE'='WATCH';
  if(exhausted&&!confirmedNow)status='NO TRADE';
  else if(confirmedNow)status='CONFIRMED';
  else if(fakeArmed)status='FAKE BREAKOUT';
  else if(eligibleNormal)status='SETUP';
  const trigger=bull?(brokeRes?.[1]||resHit?.[1]||firstHigh):(brokeSup?.[1]||supHit?.[1]||firstLow);
  const stop=bull?Math.min(firstLow,L.YL,L.S1)-atrProxy*0.2:Math.max(firstHigh,L.YH,L.R1)+atrProxy*0.2;
  const risk=Math.max(Math.abs(trigger-stop),0.01);
  const target1=bull?trigger+2*risk:trigger-2*risk;
  let score=0;
  score+=locationBull||locationBear?20:0;
  score+=strongBull||strongBear?15:bodyPct>=0.45?8:0;
  score+=clamp(Math.abs(firstReturn)*3,0,15);
  score+=clamp(Math.abs(firstReturn-niftyReturn)*3,0,10);
  score+=stars===3?15:stars===2?12:stars===1?8:0;
  score+=emaLong||emaShort?10:0;
  score+=roomLong||roomShort?5:0;
  score+=comp.compression?5:0;
  score+=comp.nr7?5:comp.nr4?3:0;
  if(exhausted)score-=20;
  if(!locationBull&&!locationBear)score-=15;
  if(status==='NO TRADE')score-=25;
  if(status==='FAKE BREAKOUT')score-=5;
  score=Math.round(clamp(score));
  const reasons=[
    `${strongBull||strongBear?'Strong':'Weak'} opening candle`,
    `${firstReturn>=0?'+':''}${firstReturn.toFixed(2)}% first-candle return`,
    `Location: ${level}`,
    `Volume ${stars?`${'★'.repeat(stars)} ${volRatio.toFixed(1)}×`:'below 1★'}`,
    `20 EMA ${emaLong||emaShort?'aligned':'not aligned'}`,
    `${comp.compression?'Compression active':'No compression'}${comp.nr7?' • NR7':comp.nr4?' • NR4':''}`,
    `${firstReturn-niftyReturn>=0?'+':''}${(firstReturn-niftyReturn).toFixed(2)}% vs NIFTY`
  ];
  return {symbol:inst.symbol,score,bias,setup,trigger,stop,target1,rr:2,reasons,firstReturn,rangePct:range/firstOpen*100,volume:firstVol,volumeRatio:volRatio,volumeStars:stars,lastPrice,status,level,ema20,emaAligned:emaLong||emaShort,compression:comp.compression,nr4:comp.nr4,nr7:comp.nr7,room:bull?roomLong:roomShort};
}

export async function GET(){
  const token=process.env.UPSTOX_ACCESS_TOKEN;
  if(!token)return NextResponse.json({ok:false,error:'UPSTOX_ACCESS_TOKEN is not configured'},{status:503});
  try{
    const universe=await getUniverse();
    let niftyReturn=0;
    try{
      const nk=encodeURIComponent('NSE_INDEX|Nifty 50');
      const ni=await up(`/v3/historical-candle/intraday/${nk}/minutes/5`,token);
      const cs=(ni?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
      const f=cs.find((c:Candle)=>String(c[0]).includes('09:15'))||cs[0];
      if(f)niftyReturn=((f[4]/f[1])-1)*100;
    }catch{}
    const dailyQuotes=await up(`/v3/market-quote/ohlc?instrument_key=${universe.map(x=>encodeURIComponent(x.instrumentKey)).join(',')}&interval=1d`,token).catch(()=>({data:{}}));
    const quoteMap:any=dailyQuotes?.data||{};
    const base:{inst:Instrument;first:Candle;prev:Daily;last:number}[]=[];
    for(let i=0;i<universe.length;i+=15){
      const batch=universe.slice(i,i+15);
      const got=await Promise.all(batch.map(async inst=>{
        try{
          const e=encodeURIComponent(inst.instrumentKey);
          const intra=await up(`/v3/historical-candle/intraday/${e}/minutes/5`,token);
          const cs=(intra?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
          const first=cs.find((c:Candle)=>String(c[0]).includes('09:15'))||cs.find((c:Candle)=>String(c[0]).slice(0,10)===todayISO());
          const q=quoteMap[Object.keys(quoteMap).find(k=>k.includes(inst.symbol))||''];
          const prev=q?.prev_ohlc;
          if(!first||!prev)return null;
          return {inst,first,prev:{open:num(prev.open),high:num(prev.high),low:num(prev.low),close:num(prev.close)},last:num(q?.last_price)||first[4]};
        }catch{return null;}
      }));
      base.push(...got.filter(Boolean) as any);
    }
    const preliminary=base.map(x=>({x, rough:Math.abs(((x.first[4]/x.prev.close)-1)*100)})).sort((a,b)=>b.rough-a.rough).slice(0,45);
    const rows:Row[]=[];
    for(let i=0;i<preliminary.length;i+=10){
      const chunk=preliminary.slice(i,i+10);
      const out=await Promise.all(chunk.map(z=>enrich(z.x.inst,z.x.first,z.x.prev,z.x.last,token,niftyReturn)));
      rows.push(...out);
    }
    const rankStatus=(s:string)=>s==='CONFIRMED'?4:s==='SETUP'?3:s==='WATCH'?2:s==='FAKE BREAKOUT'?1:0;
    rows.sort((a,b)=>rankStatus(b.status)-rankStatus(a.status)||b.score-a.score||Math.abs(b.firstReturn)-Math.abs(a.firstReturn));
    return NextResponse.json({ok:true,generatedAt:new Date().toISOString(),signalTime:'09:20 IST',universe:universe.length,scanned:base.length,rows:rows.slice(0,20)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Scanner error'},{status:500});}
}
