import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRemaining} from '../web/api.js';
import {sortWalletRows} from '../web/core.js';
test('single-field refresh calls only its collector and preserves other data',async()=>{
 const original={rows:[{wallet:'a',pets:[1],points:'123',potion_use:'1',revives_bought:'7',training_camps:'2'}],coverage:{points:{available:true},potion_use:{available:true},revives_bought:{available:true}}};
 const calls=[];const collectors=Object.fromEntries(['training_camps','potion_use','revives_bought'].map(key=>[key,async()=>{calls.push(key);return [{id:1,wallet:'a',value:'24'}];}]));
 const result=await loadRemaining(original,{fields:['training_camps'],collectors});
 assert.deepEqual(calls,['training_camps']);assert.equal(result.rows[0].training_camps,'24');
 for(const key of ['points','potion_use','revives_bought']){assert.equal(result.rows[0][key],original.rows[0][key]);assert.deepEqual(result.coverage[key],original.coverage[key]);}
 assert.equal(original.rows[0].training_camps,'2');
 await assert.rejects(loadRemaining(original,{fields:['invalid'],collectors}),/valid field/);
 assert.deepEqual(calls,['training_camps']);
});
test('field sorting moves full rows, uses exact decimals, and leaves missing values last',()=>{
 const rows=Array.from({length:60},(_,i)=>({wallet:String(i).padStart(2,'0'),points:String(i),lootboxes:String(60-i)}));
 const sorted=sortWalletRows(rows,rows,'points');assert.equal(sorted[0].wallet,'59');assert.equal(sorted[0].lootboxes,'1');assert.equal(sorted[25].wallet,'34');assert.equal(rows[0].wallet,'00');
 assert.equal(sortWalletRows(rows,rows,'lootboxes')[0].wallet,'00');
 assert.equal(sortWalletRows(rows,rows,'points','asc')[0].wallet,'00');
 const exact=[{wallet:'a',points:'9007199254740993.000000000000000001'},{wallet:'b',points:'9007199254740993'},{wallet:'c',points:null}];
 assert.deepEqual(sortWalletRows(exact,exact,'points').map(r=>r.wallet),['a','b','c']);
 assert.deepEqual(sortWalletRows(exact,exact,'points','asc').map(r=>r.wallet),['b','a','c']);
});
import {refreshPreloaded,BALANCE_CUTOFF} from '../web/api.js';
test('each historical field requests only its selector at the cutoff and retains other fields',async()=>{
 const cutoff=Date.parse(BALANCE_CUTOFF)/1000;
 for(const [key,selector,decimals] of [['points','0x13c2dfc3',12],['petage_carrots','0xad8c0c03',18],['staked_fp','0xb525f504',18]]){
  const d={rows:[{wallet:'a',pets:[1,2],lootboxes:'99'}],coverage:{lootboxes:{available:true}},balanceSnapshot:{cutoffExclusiveUtc:BALANCE_CUTOFF,blockNumber:99,blockTime:cutoff-1}};
  await refreshPreloaded(d,key,{reader:{block:async n=>({timestamp:n===99?cutoff-1:cutoff})},read:async calls=>{assert.equal(calls.length,2);assert.ok(calls.every(c=>c.params[0].data.startsWith(selector)&&c.params[1]==='0x63'));return calls.map(()=> '0x'+(10n**BigInt(decimals)).toString(16).padStart(64,'0'));}});
  assert.equal(Number(d.rows[0][key]),2);assert.equal(d.rows[0].lootboxes,'99');assert.ok(d.remainingAudit[key].checkedAt);
 }
});
test('lootboxes and shields refresh exact counts with date and purchase filters',async()=>{
 const wallet='0x'+'a'.repeat(40),mixed='0x'+'A'.repeat(40);
 for(const key of ['lootboxes','shields_bought']){
  const d={rows:[{wallet,pets:[1],points:'55'}],coverage:{},window:{from:1,until:2}};
  await refreshPreloaded(d,key,{query:async(q,v)=>{
   if(q.includes('items{id owner}'))return {pets:{items:[{id:1,owner:mixed}]}};
   assert.deepEqual(v,{from:1,until:2});assert.match(q,/createdAt_gte:\$from,createdAt_lt:\$until/);
   if(key==='shields_bought'){assert.match(q,/itemId:6,isSell:false/);assert.ok(q.includes(mixed));}else assert.match(q,/lootSpins\(where:\{petId:1/);
   return {p0:{totalCount:7}};
  }});
  assert.equal(d.rows[0][key],'7');assert.equal(d.rows[0].points,'55');
 }
});
test('Explorer refresh replaces prior quest values without changing other columns',async()=>{
 const wallet='0x'+'1'.repeat(40),d={rows:[{wallet,pets:[1,2],points:'55',explorer_points:'1'}],coverage:{}};
 await refreshPreloaded(d,'explorer_points',{fetchPet:async id=>({ep:id*10})});
 assert.equal(d.rows[0].explorer_points,'30');assert.equal(d.rows[0].points,'55');assert.equal(d.explorer.records.length,2);
});
import {fieldInputTotals,FIELDS,formatFraction} from '../web/core.js';
test('total checkers remain exact for under, over, zero, blanks, and normalized weights',()=>{
 const weights=Object.fromEntries(FIELDS.map(f=>[f.key,'0']));
 for(const value of ['90','100','110','99.999999999999999999']){
  weights.points=value;const t=fieldInputTotals(weights,'percent');
  assert.equal(formatFraction(t.weight,18),value);assert.equal(formatFraction(t.pool,18),value);
  assert.equal(t.pool.n===100n*t.pool.d,value==='100');
 }
 weights.points='90';assert.equal(formatFraction(fieldInputTotals(weights,'weights').pool),'100');
 weights.points='';assert.equal(formatFraction(fieldInputTotals(weights,'weights').pool),'0');
 weights.points='0.1';weights.lootboxes='99.9';assert.equal(formatFraction(fieldInputTotals(weights,'percent').pool),'100');
 weights.points='no';assert.throws(()=>fieldInputTotals(weights,'percent'));
});
import fs from 'node:fs';
import {calculate,formatUnits,normalizeRows} from '../web/core.js';
test('stake-only screenshot pays 1707.08 and every zero-weight field contributes zero',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../web/frozen.json',import.meta.url))).dataset;
 const rows=normalizeRows(d.rows.map(r=>({...r,...Object.fromEntries(FIELDS.filter(f=>r[f.key]==null).map(f=>[f.key,'0']))}))).rows;
 const config={pool:'282000',precision:2,mode:'weights',weights:Object.fromEntries(FIELDS.map(f=>[f.key,f.key==='staked_fp'?'100':'0']))};
 const result=calculate(rows,config),r=result.rows.find(r=>r.wallet==='0x555a614bf347b0a4a59700f136a8dddf0fc4fb89');
 assert.equal(formatUnits(r.units,2),'1707.08');
 assert.ok(result.rows.every(r=>r.breakdown.filter(b=>b.key!=='staked_fp').every(b=>b.overall.n===0n&&b.amount.n===0n)));
 const altered=rows.map(r=>({...r,...Object.fromEntries(FIELDS.filter(f=>f.key!=='staked_fp').map(f=>[f.key,f.key==='potion_use'?'1':'999999']))}));
 assert.deepEqual(calculate(altered,config).rows.map(r=>[r.wallet,r.units]),result.rows.map(r=>[r.wallet,r.units]));
});
