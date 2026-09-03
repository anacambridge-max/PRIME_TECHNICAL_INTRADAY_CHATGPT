import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Instrument={symbol:string;instrumentKey:string};
type Candle=[string,number,number,number,number,number,number?];
type Daily={open:number;high:number;low:number;close:number;volume?:number};
type Row={symbol:string;score:number;bias:'LONG'|'SHORT';setup:string;trigger:number;stop:number;target1:number;rr:number;reasons:string[];firstReturn:number;rangePct:number;volume:number;volumeRatio:number;volumeStars:number;lastPrice:number;status:'WATCH'|'SETUP'|'CONFIRMED'|'FAKE BREAKOUT'|'NO TRADE';level:string;ema20:number;emaAligned:boolean;compression:boolean;nr4:boolean;nr7:boolean;room:boolean};

const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
const clamp=(v:number,lo=0,hi=100)=>Math.max(lo,Math.min(hi,v));
const todayISO=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=(n:number)=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};

async function up(path:string,token:string){
  const r=await fetch('https://api.upstox.com'+path,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!r.ok)throw new Error(`Upstox ${r.status}`);
  return r.json();
}

async function getUniverse():Promise<Instrument[]>{
  const configured=process.env.FNO_UNIVERSE_JSON;
  if(configured){try{return JSON.parse(configured)}catch{throw new Error('FNO_UNIVERSE_JSON is invalid JSON')}}
  const r=await fetch('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz',{cache:'no-store'});
  if(!r.ok)throw new Error('Unable to download Upstox NSE instrument master');
  const records=JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')) as any[];
  const today=new Date();today.setHours(0,0,0,0);
  const bySymbol=new Map<string,any>();
  for(const x of records){
    if(x.segment!=='NSE_FO'||x.instrument_type!=='FUT'||x.underlying_type!=='EQUITY'||!x.underlying_symbol||!x.underlying_key)continue;
    const expiry=new Date(typeof x.expiry==='number'?x.expiry:x.expiry);if(expiry<today)continue;
    const old=bySymbol.get(x.underlying_symbol);
    if(!old||new Date(typeof old.expiry==='number'?old.expiry:old.expiry)>expiry)bySymbol.set(x.underlying_symbol,x);
  }
  return [...bySymbol.values()].map(x=>({symbol:x.underlying_symbol,instrumentKey:x.underlying_key}));
}

function levels(p:Daily){
  const YH=p.high,YL=p.low,MID=(YH+YL)/2,P=(YH+YL+p.close)/3;
  return {YH,YL,MID,R1:2*P-YL,R2:P+(YH-YL),R3:YH+2*(P-YL),S1:2*P-YH,S2:P-(YH-YL),S3:YL-2*(YH-P)};
}
function ema(values:number[],len=20){if(!values.length)return 0;const k=2/(len+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e;}
function dailyCompression(ds:Daily[]){
  if(ds.length<8)return{compression:false,nr4:false,nr7:false};
  const d=ds.slice(-7),ranges=d.map(x=>x.high-x.low),recentCount=4;
  const recentAvg=ranges.slice(-recentCount).reduce((a,b)=>a+b,0)/recentCount;
  const baselineAvg=ranges.reduce((a,b)=>a+b,0)/7;
  const compHigh=Math.max(...d.map(x=>x.high)),compLow=Math.min(...d.map(x=>x.low));
  const band=compHigh-compLow;
  const compression=baselineAvg>0&&recentAvg/baselineAvg<=0.75&&recentAvg/baselineAvg<=0.80&&band>0;
  const last=ranges[ranges.length-1];
  const nr4=last===Math.min(...ranges.slice(-4));
  const nr7=last===Math.min(...ranges.slice(-7));
  return{compression,nr4,nr7};
}

async function enrich(inst:Instrument,first:Candle,prev:Daily,lastPrice:number,token:string,niftyReturn:number):Promise<Row>{
  const [open,high,low,close,firstVol]=[first[1],first[2],first[3],first[4],num(first[5])];
  const range=Math.max(high-low,0.0001),body=Math.abs(close-open),bodyPct=body/range,closePos=(close-low)/range;
  const bull=close>open,bear=close<open,strongBull=closePos>=0.75,strongBear=closePos<=0.25;
  const firstReturn=prev.close?((close/prev.close)-1)*100:0,gapPct=prev.close?((open/prev.close)-1)*100:0;
  const upper=(high-Math.max(open,close))/range,lower=(Math.min(open,close)-low)/range;
  const L=levels(prev),baseDate=daysAgo(35),today=todayISO();
  let candles:Candle[]=[],daily:Candle[]=[];
  try{
    const e=encodeURIComponent(inst.instrumentKey);
    const [h,d]=await Promise.all([up(`/v3/historical-candle/${e}/minutes/5/${today}/${baseDate}`,token),up(`/v3/historical-candle/${e}/days/1/${today}/${daysAgo(20)}`,token)]);
    candles=(h?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
    daily=(d?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0])));
  }catch{}
  const priorBars=candles.filter(c=>String(c[0]).slice(0,10)!==today).slice(-80);
  const closes=priorBars.map(c=>c[4]).concat([close]);
  const ema20=ema(closes.slice(-60),20),emaPrev=ema(closes.slice(-21,-1),20);
  const priorVols=priorBars.slice(-19).map(c=>num(c[5])),volMA=(priorVols.concat([firstVol])).reduce((a,b)=>a+b,0)/Math.max(priorVols.length+1,1);
  const volRatio=volMA>0?firstVol/volMA:0,stars=volRatio>=6.5?3:volRatio>=4?2:volRatio>=2?1:0;
  const emaLong=close>ema20&&ema20>emaPrev,emaShort=close<ema20&&ema20<emaPrev;
  const atrProxy=Math.max(priorBars.slice(-14).reduce((a,c)=>a+(c[2]-c[3]),0)/Math.max(Math.min(priorBars.length,14),1),range);
  const tol=atrProxy*0.3,near=(v:number,l:number)=>Math.abs(v-l)<=tol;
  const res:[string,number][]=[['YH',L.YH],['R1',L.R1],['R2',L.R2],['R3',L.R3]],sup:[string,number][]=[['YL',L.YL],['S1',L.S1],['S2',L.S2],['S3',L.S3]];
  const resHit=res.find(([,v])=>near(high,v)),supHit=sup.find(([,v])=>near(low,v));
  const brokeRes=res.filter(([,v])=>close>v).sort((a,b)=>b[1]-a[1])[0],brokeSup=sup.filter(([,v])=>close<v).sort((a,b)=>a[1]-b[1])[0];
  const nextRes=res.filter(([,v])=>v>close).sort((a,b)=>a[1]-b[1])[0],nextSup=sup.filter(([,v])=>v<close).sort((a,b)=>b[1]-a[1])[0];
  const roomLong=!nextRes||(nextRes[1]-close)>atrProxy*0.75,roomShort=!nextSup||(close-nextSup[1])>atrProxy*0.75;
  const comp=daily.length>=8?dailyCompression(daily.map(c=>({open:c[1],high:c[2],low:c[3],close:c[4]}))):{compression:false,nr4:false,nr7:false};
  const locationLong=!!supHit||!!brokeRes,locationShort=!!resHit||!!brokeSup;
  const level=bull?(brokeRes?.[0]||supHit?.[0]||'NONE'):(brokeSup?.[0]||resHit?.[0]||'NONE');
  const participation=stars>=1;
  const normalLong=bull&&locationLong&&strongBull&&participation&&emaLong&&roomLong;
  const normalShort=bear&&locationShort&&strongBear&&participation&&emaShort&&roomShort;
  const fakeBuy=bull&&resHit&&!brokeRes, fakeSell=bear&&supHit&&!brokeSup;
  const confirmed=normalLong&&!!brokeRes||normalShort&&!!brokeSup;
  const exhausted=Math.abs(gapPct)>3||Math.abs(firstReturn)>4.5||(bull?upper:lower)>0.30||bodyPct<0.45;
  let status:'WATCH'|'SETUP'|'CONFIRMED'|'FAKE BREAKOUT'|'NO TRADE'='WATCH';
  if(exhausted&&!confirmed)status='NO TRADE';else if(confirmed)status='CONFIRMED';else if(fakeBuy||fakeSell)status='FAKE BREAKOUT';else if(normalLong||normalShort)status='SETUP';
  let bias:'LONG'|'SHORT'=bull?'LONG':'SHORT';
  if(fakeBuy)bias='SHORT';if(fakeSell)bias='LONG';
  const setup=fakeBuy?'Setup 2 • Fake Breakout SELL':fakeSell?'Setup 2 • Fake Breakout BUY':normalLong?'Setup 1 • Normal BUY':normalShort?'Setup 1 • Normal SELL':'WATCH';
  const trigger=bull?(brokeRes?.[1]||resHit?.[1]||high):(brokeSup?.[1]||supHit?.[1]||low);
  const stop=bull?Math.min(low,L.YL,L.S1)-atrProxy*0.2:Math.max(high,L.YH,L.R1)+atrProxy*0.2;
  const risk=Math.max(Math.abs(trigger-stop),0.01),target1=bull?trigger+2*risk:trigger-2*risk;
  let score=0;
  score+=locationLong||locationShort?20:0;score+=strongBull||strongBear?15:bodyPct>=0.45?8:0;score+=clamp(Math.abs(firstReturn)*3,0,15);score+=clamp(Math.abs(firstReturn-niftyReturn)*3,0,10);
  score+=stars===3?15:stars===2?12:stars===1?8:0;score+=emaLong||emaShort?10:0;score+=(bull?roomLong:roomShort)?5:0;score+=comp.compression?5:0;score+=comp.nr7?5:comp.nr4?3:0;
  if(exhausted)score-=20;if(!locationLong&&!locationShort)score-=15;if(status==='NO TRADE')score-=25;if(status==='FAKE BREAKOUT')score-=5;score=Math.round(clamp(score));
  const reasons=[`${strongBull||strongBear?'Strong':'Weak'} opening candle`,`${firstReturn>=0?'+':''}${firstReturn.toFixed(2)}% first-candle return`,`Location: ${level}`,`Volume ${stars?`${'★'.repeat(stars)} ${volRatio.toFixed(1)}×`:'below 1★'}`,`20 EMA ${emaLong||emaShort?'aligned':'not aligned'}`,`${comp.compression?'Compression active':'No compression'}${comp.nr7?' • NR7':comp.nr4?' • NR4':''}`,`${firstReturn-niftyReturn>=0?'+':''}${(firstReturn-niftyReturn).toFixed(2)}% vs NIFTY`];
  return{symbol:inst.symbol,score,bias,setup,trigger,stop,target1,rr:2,reasons,firstReturn,rangePct:range/open*100,volume:firstVol,volumeRatio:volRatio,volumeStars:stars,lastPrice,status,level,ema20,emaAligned:emaLong||emaShort,compression:comp.compression,nr4:comp.nr4,nr7:comp.nr7,room:bull?roomLong:roomShort};
}

function roughScore(first:Candle,prev:Daily,niftyReturn:number){
  const o=first[1],h=first[2],l=first[3],c=first[4],range=Math.max(h-l,0.0001),body=Math.abs(c-o),pos=(c-l)/range,ret=prev.close?((c/prev.close)-1)*100:0;
  const L=levels(prev),near=(v:number,x:number)=>Math.abs(v-x)<=range*0.5;
  const location=near(h,L.YH)||near(h,L.R1)||near(h,L.R2)||near(h,L.R3)||near(l,L.YL)||near(l,L.S1)||near(l,L.S2)||near(l,L.S3)||c>L.YH||c>L.R1||c<L.YL||c<L.S1;
  return (location?30:0)+(pos>=0.75||pos<=0.25?20:body/range>=0.45?10:0)+clamp(Math.abs(ret)*4,0,20)+clamp(Math.abs(ret-niftyReturn)*3,0,10);
}

export async function GET(){
  const token=process.env.UPSTOX_ACCESS_TOKEN;if(!token)return NextResponse.json({ok:false,error:'UPSTOX_ACCESS_TOKEN is not configured'},{status:503});
  try{
    const universe=await getUniverse();let niftyReturn=0;
    try{const nk=encodeURIComponent('NSE_INDEX|Nifty 50'),ni=await up(`/v3/historical-candle/intraday/${nk}/minutes/5`,token),cs=(ni?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0]))),f=cs.find((c:Candle)=>String(c[0]).includes('09:15'))||cs[0];if(f)niftyReturn=((f[4]/f[1])-1)*100}catch{}
    const dailyQuotes=await up(`/v3/market-quote/ohlc?instrument_key=${universe.map(x=>encodeURIComponent(x.instrumentKey)).join(',')}&interval=1d`,token).catch(()=>({data:{}}));
    const quoteMap:any=dailyQuotes?.data||{},base:{inst:Instrument;first:Candle;prev:Daily;last:number}[]=[];
    for(let i=0;i<universe.length;i+=20){
      const got=await Promise.all(universe.slice(i,i+20).map(async inst=>{try{const e=encodeURIComponent(inst.instrumentKey),intra=await up(`/v3/historical-candle/intraday/${e}/minutes/5`,token),cs=(intra?.data?.candles||[]).sort((a:Candle,b:Candle)=>String(a[0]).localeCompare(String(b[0]))),first=cs.find((c:Candle)=>String(c[0]).includes('09:15'))||cs.find((c:Candle)=>String(c[0]).slice(0,10)===todayISO()),key=Object.keys(quoteMap).find(k=>k.includes(inst.symbol))||'',q=quoteMap[key],p=q?.prev_ohlc;if(!first||!p)return null;return{inst,first,prev:{open:num(p.open),high:num(p.high),low:num(p.low),close:num(p.close)},last:num(q?.last_price)||first[4]} as const}catch{return null}}));
      base.push(...got.filter(Boolean) as any);
    }
    const preliminary=base.map(x=>({x,rough:roughScore(x.first,x.prev,niftyReturn)})).sort((a,b)=>b.rough-a.rough).slice(0,50);
    const rows:Row[]=[];
    for(let i=0;i<preliminary.length;i+=10){const out=await Promise.all(preliminary.slice(i,i+10).map(z=>enrich(z.x.inst,z.x.first,z.x.prev,z.x.last,token,niftyReturn)));rows.push(...out)}
    const rank=(s:string)=>s==='CONFIRMED'?4:s==='SETUP'?3:s==='WATCH'?2:s==='FAKE BREAKOUT'?1:0;
    rows.sort((a,b)=>rank(b.status)-rank(a.status)||b.score-a.score||Math.abs(b.firstReturn)-Math.abs(a.firstReturn));
    return NextResponse.json({ok:true,generatedAt:new Date().toISOString(),signalTime:'09:20 IST',universe:universe.length,scanned:base.length,rows:rows.slice(0,20)},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Scanner error'},{status:500})}
}
