import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectTraining,collectHibernations,collectPotionFlags,evolvedSpecies,applyRecords,assertFrozenSnapshot,BALANCE_CUTOFF} from '../web/api.js';
const wallet='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const cutoff=Date.parse(BALANCE_CUTOFF)/1000;
const sample=()=>({rows:[{wallet,pets:[1,2]},{wallet:other,pets:[3]}],coverage:{},window:{from:100,until:200},balanceSnapshot:{cutoffExclusiveUtc:BALANCE_CUTOFF,blockNumber:99,blockTime:cutoff-1}});
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const dna=n=>'0x'+[32,3,n,0,1].map(word).join('');
test('training sums attack and defense levels per pet and wallet',async()=>{
 const d=sample();const r=await collectTraining(d,{query:async q=>{assert.match(q,/trainingAtk trainingDef/);return {pets:{items:[{id:1,trainingAtk:14,trainingDef:10},{id:2,trainingAtk:1,trainingDef:2},{id:3,trainingAtk:0,trainingDef:0}]}};}});
 applyRecords(d,'training_camps',r);assert.equal(d.rows[0].training_camps,'27');assert.equal(r[0].value,'24');assert.equal(d.rows[1].training_camps,'0');
});
test('missing and invalid training levels never become zero',async()=>{
 for(const items of [[],[{id:1,trainingAtk:null,trainingDef:10},{id:2,trainingAtk:1,trainingDef:2},{id:3,trainingAtk:0,trainingDef:0}]])await assert.rejects(collectTraining(sample(),{query:async()=>({pets:{items}})}));
});
test('revive proxy counts losing pet hibernations inside the captured date range',async()=>{
 const d=sample();const records=await collectHibernations(d,{query:async(q,v)=>{assert.match(q,/loserId:1,createdAt_gte:\$from,createdAt_lt:\$until/);assert.deepEqual(v,{from:100,until:200});return {p0:{totalCount:4},p1:{totalCount:2},p2:{totalCount:0}};}});
 applyRecords(d,'revives_bought',records);assert.equal(d.rows[0].revives_bought,'6');assert.equal(d.rows[1].revives_bought,'0');
 await assert.rejects(collectHibernations(d,{query:async()=>({p0:{totalCount:0}})}),/Invalid hibernation/);
});
test('only the requested six evolved species qualify; historical reads OR by wallet',async()=>{
 for(let n=0;n<=13;n++)assert.equal(evolvedSpecies(dna(n)).used,[7,9,10,11,12,13].includes(n));
 assert.throws(()=>evolvedSpecies(dna(14)),/Unknown/);assert.throws(()=>evolvedSpecies('0x'),/Invalid/);
 const d=sample();const records=await collectPotionFlags(d,{reader:{block:async n=>({timestamp:n===99?cutoff-1:cutoff})},read:async calls=>{assert.ok(calls.every(c=>c.params[1]==='0x63'&&c.params[0].data.startsWith('0x422627c3')));return [dna(6),dna(12),dna(8)];}});
 applyRecords(d,'potion_use',records);assert.equal(d.rows[0].potion_use,'1');assert.equal(d.rows[1].potion_use,'0');
 await assert.rejects(collectPotionFlags(d,{reader:{block:async()=>({timestamp:cutoff})}}),/cutoff/);
});
test('new field records are complete and never change the six frozen fields',()=>{
 const original=JSON.parse(fs.readFileSync(new URL('../web/frozen.json',import.meta.url))).dataset;
 assert.equal(original.rows.length,203);assert.equal(original.rows.reduce((n,r)=>n+r.pets.length,0),1404);
 const copy=structuredClone(original);const records=copy.rows.flatMap(r=>r.pets.map(id=>({id,wallet:r.wallet,value:'1'})));
 for(const key of ['training_camps','revives_bought','potion_use']){applyRecords(copy,key,records);assertFrozenSnapshot(copy,original);}
 assert.throws(()=>applyRecords(copy,'training_camps',records.slice(1)),/Incomplete/);
 copy.rows[0].points='0';assertFrozenSnapshot(copy,original);copy.rows[0].pets=[];assert.throws(()=>assertFrozenSnapshot(copy,original),/wallet cohort/);
});
