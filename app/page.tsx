'use client';
import { useEffect, useMemo, useState } from 'react';

type Row={symbol:string;score:number;bias:'LONG'|'SHORT';setup:string;entry:number;stop:number;target1:number;rr:number;reasons:string[];firstReturn:number;rangePct:number;volume:number};
type Scan={ok:boolean;error?:string;generatedAt?:string;signalTime?:string;universe?:number;scanned?:number;rows?:Row[]};
const money=(n:number)=>Number.isFinite(n)?n.toFixed(2):'—';
export default function Home(){
 const [data,setData]=useState<Scan|null>(null); const [loading,setLoading]=useState(false); const [now,setNow]=useState(new Date());
 const scan=async()=>{setLoading(true);try{const r=await fetch('/api/scan?ts='+Date.now(),{cache:'no-store'});setData(await r.json())}catch(e){setData({ok:false,error:'Unable to reach scanner API'})}finally{setLoading(false)}};
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t)},[]);
 useEffect(()=>{scan(); const t=setInterval(scan,30000); return()=>clearInterval(t)},[]);
 const ist=useMemo(()=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now),[now]);
 const rows=data?.rows||[]; const leader=rows[0];
 return <main className="shell"><header className="top"><div className="brand"><h1>PRIME TECHNICAL • INTRADAY</h1><p>F&O 09:20 Opening-Candle Intelligence</p></div><div className="status"><span className="dot"/>LIVE • {ist} IST</div></header>
 <section className="hero"><div className="eyebrow">09:20 PRIME LEADER</div><div className="leader"><div><div className="symbol">{leader?.symbol|| (data?.error?'DATA NOT CONNECTED':'SCANNING F&O')}</div><p className="muted">{leader?leader.reasons.join(' • '):data?.error||'First 5-minute candle ranking will appear here.'}</p></div><div className="score">{leader?leader.score:'—'} <small>/ 100</small></div></div>{leader&&<div className="heroMeta"><span className={leader.bias==='LONG'?'bull':'bear'}>{leader.bias}</span><span>{leader.setup}</span><span>Entry {money(leader.entry)}</span><span>SL {money(leader.stop)}</span><span>Target {money(leader.target1)}</span><span>R:R {leader.rr.toFixed(2)}</span></div>}</section>
 <section className="grid"><div className="card"><div className="label">MARKET</div><div className="value">NSE • {loading?'Updating':'Live'}</div></div><div className="card"><div className="label">F&O UNIVERSE</div><div className="value">{data?.universe??'—'}</div></div><div className="card"><div className="label">SCANNED</div><div className="value">{data?.scanned??'—'}</div></div><div className="card"><div className="label">LAST SCAN</div><div className="value">{data?.generatedAt?new Date(data.generatedAt).toLocaleTimeString('en-IN',{hour12:false}):'—'}</div></div></section>
 <div className="sectionHead"><div><h2>TOP F&O CANDIDATES</h2><p className="muted">Ranked by Prime Score • refreshes every 30 seconds</p></div><button onClick={scan} disabled={loading}>{loading?'SCANNING…':'REFRESH NOW'}</button></div>
 <section className="tablewrap"><table><thead><tr>{['Rank','Stock','Score','Bias','Setup','Entry','SL','Target','R:R'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.length?rows.slice(0,10).map((r,i)=><tr key={r.symbol}><td className="rank">{i+1}</td><td><strong>{r.symbol}</strong></td><td><strong>{r.score}</strong></td><td className={r.bias==='LONG'?'bull':'bear'}>{r.bias}</td><td>{r.setup}</td><td>{money(r.entry)}</td><td>{money(r.stop)}</td><td>{money(r.target1)}</td><td>{r.rr.toFixed(2)}</td></tr>):<tr><td colSpan={9} className="empty">{data?.error||'Waiting for live market data…'}</td></tr>}</tbody></table></section>
 <footer className="footer">Model score is a ranking signal, not a guaranteed prediction or investment advice. Historical validation will be added before treating score as a probability.</footer></main>
}
