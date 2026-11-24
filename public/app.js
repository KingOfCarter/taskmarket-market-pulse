const $ = s => document.querySelector(s);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = String(text); if (cls) el.className = cls; return el; };
const fmt = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n) : 'Unavailable';
const params = new URLSearchParams(location.search);
let chain = ['4217', '8453'].includes(params.get('chain')) ? params.get('chain') : '4217';
let range = ['7d', '30d', '90d', 'all'].includes(params.get('range')) ? params.get('range') : '30d';
let current, feedCursor, generation = 0, feedSeen = new Set();
const token = value => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) / 1e6 : NaN;
const svg = (tag, attrs, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text != null) e.textContent = String(text); return e; };
function table(headers, rows) {
  const wrapper = node('div', null, 'table-scroll'), t = node('table'), head = node('thead'), tr = node('tr');
  headers.forEach(h => { const th = node('th', h); th.scope = 'col'; tr.append(th); }); head.append(tr); t.append(head);
  const body = node('tbody'); rows.forEach(row => { const r = node('tr'); row.forEach(x => r.append(node('td', x))); body.append(r); }); t.append(body); wrapper.append(t); return wrapper;
}
function empty(target, message = 'Data unavailable. See source errors below.') { target.replaceChildren(node('p', message, 'empty')); }
function chart(target, rows, field, title, monetary = false) {
  const card = node('article', null, 'chart-card'); card.append(node('h3', title));
  if (!rows?.length) { empty(card); target.append(card); return; }
  const values = rows.map(x => monetary ? token(x[field]) : x[field]);
  if (values.some(x => !Number.isFinite(x))) { empty(card); target.append(card); return; }
  const total = values.reduce((a,b) => a+b,0), last = values.at(-1);
  card.append(node('div', fmt(monetary ? total : last), 'metric'), node('div', monetary ? 'Total in range · mixed-chain token units' : 'Latest UTC bucket · still in progress', 'caption'));
  const width = 480, height = 155, left = 48, right = 465, top = 12, bottom = 120, max = Math.max(...values, 1);
  const plot = svg('svg', {viewBox:`0 0 ${width} ${height}`,role:'img','aria-label': `${title}. ${rows.length} daily buckets. Maximum ${fmt(Math.max(...values))}. See data table for exact values.`,class:'chart'});
  [0,.5,1].forEach(v => { const y = bottom - v * (bottom-top); plot.append(svg('line',{x1:left,y1:y,x2:right,y2:y}), svg('text',{x:left-8,y:y+4,'text-anchor':'end'},new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(max*v))); });
  const points = values.map((v,i) => [left + i / Math.max(values.length-1,1)*(right-left), bottom-v/max*(bottom-top)]);
  plot.append(svg('path',{d:points.map(([x,y],i) => `${i?'L':'M'}${x},${y}`).join(' ')}));
  points.forEach(([cx,cy],i) => { const p = svg('circle',{cx,cy,r:2}); p.append(svg('title',{},`${rows[i].bucket}: ${fmt(values[i])}`)); plot.append(p); });
  plot.append(svg('text',{x:left,y:146},rows[0].bucket),svg('text',{x:right,y:146,'text-anchor':'end'},rows.at(-1).bucket)); card.append(plot);
  const details = node('details',null,'data'); details.append(node('summary','View daily values'),table(['UTC day', monetary ? 'Token units' : 'Count'],rows.map((r,i) => [r.bucket,monetary ? (BigInt(r[field])/1000000n).toString()+'.'+(BigInt(r[field])%1000000n).toString().padStart(6,'0') : values[i]]))); card.append(details); target.append(card);
}
function bars(target, rows, key) {
  target.replaceChildren(); if (!rows) return empty(target);
  const max = Math.max(...rows.map(x => Number(x.count)),1);
  rows.slice().sort((a,b)=>b.count-a.count).forEach(x => { const r=node('div',null,'bar-row'),track=node('div',null,'track'),fill=node('span',null,'fill'); fill.style.width=`${Number(x.count)/max*100}%`; track.append(fill); r.append(node('span',String(x[key]).replaceAll('_',' ')),track,node('code',fmt(x.count))); target.append(r); });
}
function renderHeat(d) {
  const target=$('#heatmap'); target.replaceChildren(); if (!d) return empty(target);
  const grid=node('div',null,'heat'), days=['Day 0','Day 1','Day 2','Day 3','Day 4','Day 5','Day 6']; grid.append(node('span','Hour'));
  d.colKeys.forEach(h=>grid.append(node('label',String(h).padStart(2,'0'))));
  const byCell=new Map(d.cells.map(c=>[`${c.row}/${c.col}`,c]));
  d.rowKeys.forEach(row=>{ grid.append(node('label',days[Number(row)] || row)); d.colKeys.forEach(col=>{ const cell=byCell.get(`${row}/${col}`), e=node('button',null,'cell'), label=`${days[Number(row)] || row}, hour ${col}: ${cell ? fmt(cell.count)+' events' : 'not returned'}`; e.type='button'; e.title=label; e.setAttribute('aria-label',label); e.dataset.level=cell ? String(Math.min(4,Math.max(0,Math.ceil(cell.count/Math.max(d.maxCount,1)*4)))) : '0'; grid.append(e); }); }); target.append(grid);
}
function renderFeed(d, append=false) {
  const list=$('#feed'); if (!append) { list.replaceChildren(); feedSeen=new Set(); }
  for (const event of d?.items || []) {
    const key=`${event.type}:${event.taskId}:${event.actor}:${event.timestamp}`; if(feedSeen.has(key)) continue; feedSeen.add(key);
    const row=node('li'),time=node('time',new Date(event.timestamp).toLocaleString('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC'),body=node('div'); time.dateTime=event.timestamp;
    body.append(node('span',String(event.type).replaceAll('_',' '),'kind'),node('span',event.taskTitle || event.taskId),node('span',`${String(event.actor).slice(0,10)}…${String(event.actor).slice(-6)} · ${event.actorType}`,'actor')); row.append(time,body); list.append(row);
  }
  if(!list.children.length) list.append(node('li','No matching events in scanned pages. Earlier activity may still exist.','empty'));
  feedCursor=d?.nextCursor; $('#more').hidden=!feedCursor; $('#feed-note').textContent=d?.note || 'Feed unavailable.';
}
function render(d) {
  current=d; $('#headline').replaceChildren();
  const labels={registeredWorkers:'Registered workers',activeWorkers7d:'Active workers · 7d',activeAgents7d:'Active agents · 7d',openTasks:'Open tasks',paidWorkers:'Paid workers',activeWallets:'Active wallets'};
  Object.entries(labels).forEach(([key,label])=>{ const c=node('article',null,'stat'); c.append(node('span',label,'label'),node('strong',fmt(d.headline?.[key]),'number'),node('span',`chainId=${chain} supplied · scope unverified`,'scope')); $('#headline').append(c); });
  const trends=$('#trends'); trends.replaceChildren();
  [['activeAgents','Daily active agents',false],['tasksCreated','Tasks posted',false],['rewardVolume','Rewards posted',true],['paidVolume','Rewards paid',true]].forEach(args=>chart(trends,d.series,...args));
  const w=$('#weekly'); w.replaceChildren();
  if(d.weekly) {
    const strip=node('div',null,'weekly-bars'),max=Math.max(...d.weekly.map(x=>x.posters),1);
    d.weekly.forEach(x=>{const b=node('div',null,'week-bar'); b.style.height=`${x.posters/max*100}%`; b.title=`Week of ${x.week}: ${x.posters} posters, ${x.tasks} tasks`;strip.append(b);});w.append(strip);
    w.append(table(['Week beginning (UTC)','Distinct posters','Tasks posted'],d.weekly.map(x=>[x.week,x.posters,x.tasks])));
    $('#coverage').textContent=`${chain==='4217'?'Tempo':'Base'} · ${d.taskCoverage.count} tasks · ${d.taskCoverage.pages} pages · complete`;
  } else empty(w);
  bars($('#modes'),d.chainBreakdowns?.mode,'mode');bars($('#statuses'),d.chainBreakdowns?.status,'status');
  bars($('#api-modes'),d.breakdowns?.mode,'mode');bars($('#api-statuses'),d.breakdowns?.status,'status');renderHeat(d.heatmap);renderFeed(d.feed);
  $('#sources').replaceChildren();
  for(const [view,sources] of Object.entries(d.sources)) for(const src of sources) {const li=node('li'); const link=node('a',src.url); link.href=src.url; link.target='_blank';link.rel='noopener noreferrer'; li.append(node('div',`${view} · ${src.fetchedAt}${src.stale?' · STALE':''}`),link);$('#sources').append(li);}
  for(const [key,error] of Object.entries(d.errors)) $('#sources').append(node('li',`${key}: ${error}`));
  const errorCount=Object.keys(d.errors).length;
  $('#status').className=d.stale||errorCount?'error':'';
  $('#status').textContent=`Data as of ${d.asOf ? new Date(d.asOf).toISOString().replace('T',' ').replace('Z',' UTC') : 'unavailable'} · ${d.stale?'STALE · ':''}${errorCount?`${errorCount} unavailable views · `:''}5-minute checks · auto-refresh on`;
}
async function load() {
  const id=++generation; $('#chain').value=chain;
  document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.range===range)));
  history.replaceState(null,'',`?chain=${chain}&range=${range}`);
  $('#status').textContent='Fetching server snapshot…'; $('#refresh').disabled=true; $('#export').disabled=true; $('#share').disabled=true;
  try {const res=await fetch(`./snapshots/${chain}-${range}.json`);if(!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);const d=await res.json();if(id===generation){d.stale ||= !d.asOf || Date.now()-Date.parse(d.asOf)>3_600_000;render(d);if(!performance.getEntriesByName("market-data-ready").length)performance.mark("market-data-ready");}}
  catch(e){if(id===generation){$('#status').textContent=`Refresh failed: ${e.message}${current?' · previous view retained':''}`;$('#status').className='error';}}
  finally{if(id===generation){$('#refresh').disabled=false;$('#export').disabled=!current;$('#share').disabled=!current?.asOf;}}
}
$('#chain').addEventListener('change',e=>{chain=e.target.value;void load();});
document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{range=b.dataset.range;void load();}));
$('#refresh').addEventListener('click',load);
$('#more').addEventListener('click',async()=>{const chainAtStart=chain,id=generation,button=$('#more');button.disabled=true;try{const res=await fetch(`./snapshots/feed-${chain}-${Date.parse(feedCursor)}.json`);if(!res.ok)throw new Error(`HTTP ${res.status}`);const d=await res.json();if(chainAtStart===chain&&id===generation)renderFeed(d,true);}catch(e){$('#feed-note').textContent=`Earlier events unavailable: ${e.message}`;}finally{button.disabled=false;}});
function download(blob,name){const a=node('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}
$('#export').addEventListener('click',()=>{if(current)download(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),`market-pulse-${current.chainId}-${current.range}.json`);});
$('#share').addEventListener('click',async()=>{
  if(!current?.asOf)return; const button=$('#share');button.disabled=true;
  try{
    await document.fonts.ready;await Promise.all([document.fonts.load('64px Instrument'),document.fonts.load('italic 64px Instrument'),document.fonts.load('24px Departure')]);
    const canvas=node('canvas');canvas.width=1200;canvas.height=630;const c=canvas.getContext('2d');c.fillStyle='#12100e';c.fillRect(0,0,1200,630);
    const logo=new Image();logo.src='./assets/taskmarket-lockup.png';await logo.decode();c.drawImage(logo,64,64,360,360*176/971);
    c.fillStyle='#efe9e2';c.font='72px Instrument';c.fillText('The market, in motion.',64,250);
    c.fillStyle='#b0a79d';c.font='24px Inter';c.fillText(`${current.chainId===4217?'Tempo':'Base'} · ${current.range} · ${current.taskCoverage?.complete?'Complete task pagination':'Task coverage unavailable'}`,64,302);
    if(current.weekly?.length){const last=current.weekly.at(-1);c.fillStyle='#d9a097';c.font='48px Departure';c.fillText(String(last.posters),64,395);c.fillStyle='#efe9e2';c.font='24px Inter';c.fillText(`distinct posters · week of ${last.week} UTC (in progress)`,64,438);}
    c.fillStyle='#b0a79d';c.font='15px Departure';c.fillText(`As of ${current.asOf}${current.stale?' · STALE':''}`,64,496);c.fillText('taskmarket.dev',64,553);c.font='18px Inter';c.fillText('Made for a paid Taskmarket bounty. Not an official Taskmarket product.',64,590);
    canvas.toBlob(blob=>{if(blob)download(blob,`market-pulse-${current.chainId}-${current.range}.png`);},'image/png');
  }catch(e){$('#status').textContent=`Share image failed: ${e.message}`;}finally{button.disabled=false;}
});
void load();setInterval(load,300_000);
