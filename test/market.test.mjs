import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarket, paginateTasks, weeklyPosters, weekOf, selection } from '../lib/market.mjs';

const addr='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const task=(id,createdAt,requester=addr,chainId=4217)=>({id,requester,createdAt,chainId,mode:'bounty',status:'open'});
test('UTC Monday boundaries, case-insensitive wallets and duplicate task IDs',()=>{
  const rows=weeklyPosters([
    task('a','2026-11-22T23:59:59Z'),task('b','2026-11-23T00:00:00Z'),
    task('c','2026-11-23T10:00:00Z',addr.toUpperCase().replace('0X','0x')),
    task('c','2026-11-23T10:00:00Z')
  ],null,'2026-11-24T12:00:00Z');
  assert.deepEqual(rows,[{week:'2026-11-16',posters:1,tasks:1},{week:'2026-11-23',posters:1,tasks:2}]);
  assert.equal(weekOf('2026-11-22T19:00:00-06:00'),'2026-11-23');
});
test('weekly range preserves the complete boundary week and rejects bad requester/date',()=>{
  assert.equal(weeklyPosters([task('a','2026-11-16T00:00:00Z')],'2026-11-20','2026-11-24')[0].posters,1);
  assert.throws(()=>weeklyPosters([task('a','bad')]));
  assert.throws(()=>weeklyPosters([task('a','2026-11-23','guessed-name')]));
});
test('task pagination follows cursor, deduplicates overlaps and includes closed tasks',async()=>{
  const queries=[];const get=async(path,params)=>{queries.push(params);return{url:path,fetchedAt:'2026-11-24T00:00:00Z',data:params.cursor?{tasks:[task('b','2026-11-22'),{...task('c','2026-11-21'),status:'completed'}],hasMore:false,nextCursor:null}:{tasks:[task('a','2026-11-23'),task('b','2026-11-22')],hasMore:true,nextCursor:'next'}}};
  const result=await paginateTasks(get,4217);assert.equal(result.pages,2);assert.equal(result.tasks.length,3);assert.equal(queries[0].status,'ALL');assert.equal(queries[1].cursor,'next');
});
test('pagination refuses stalled cursors, page budget and wrong chains',async()=>{
  const get=async()=>({data:{tasks:[task('a','2026-11-23')],hasMore:true,nextCursor:'same'}});
  await assert.rejects(paginateTasks(get,4217),/stalled/);
  await assert.rejects(paginateTasks(get,4217,1),/budget/);
  await assert.rejects(paginateTasks(async()=>({data:{tasks:[task('a','2026-11-23',addr,8453)],hasMore:false}}),4217),/chain/);
});
test('cache coalesces concurrent GETs, expires and preserves original timestamp on failure',async()=>{
  let calls=0,clock=0,fail=false;const market=createMarket({now:()=>clock,fetcher:async()=>{calls++;if(fail)throw new Error('offline');return new Response('{"ok":true}');}});
  const results=await Promise.all([market.get('/api/market/stats'),market.get('/api/market/stats')]);assert.equal(calls,1);
  clock=299999;await market.get('/api/market/stats');assert.equal(calls,1);
  clock=300001;fail=true;const stale=await market.get('/api/market/stats');assert.equal(calls,2);assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,results[0].fetchedAt);
  await assert.rejects(market.get('/api/wallet/create'),/not allowed/);
});
test('chain filter scans feed pages rather than relabeling events',async()=>{
  let calls=0;const market=createMarket({fetcher:async url=>{calls++;const cursor=new URL(url).searchParams.get('cursor');return Response.json({items:[{type:'task_created',taskId:cursor?'base':'tempo',actor:addr,timestamp:'2026-11-24T00:00:00Z',chainId:cursor?8453:4217}],nextCursor:cursor?null:'2026-11-23T00:00:00Z'});}});
  const f=await market.feed(8453);assert.equal(calls,2);assert.equal(f.items.length,1);assert.equal(f.items[0].taskId,'base');
});
test('schema changes produce unavailable views, never invented fallback data',async()=>{
  const m=createMarket({fetcher:async()=>Response.json({unexpected:true})});const d=await m.snapshot(4217,'7d');assert.equal(d.headline,undefined);assert.equal(d.series,undefined);assert.ok(d.errors.series);assert.ok(d.errors.taskList);
});
test('inputs allow only the two networks and four documented ranges',()=>{
  assert.throws(()=>selection(1,'7d'));assert.throws(()=>selection(4217,'custom'));assert.equal(selection('8453','all').chainId,8453);
});
