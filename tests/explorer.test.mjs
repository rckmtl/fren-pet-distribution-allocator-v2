import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExplorer,reconcileExplorer,setExplorerFallback,questRecord,explorerSource,QUESTS_API} from '../web/explorer.js';
import {createSeed,readSeed} from '../web/seed.js';
import {FIELDS,calculate,comparisonCSV} from '../web/core.js';
const wallet = i=>'0x'+i.toString(16).padStart(40,'0');
const owner = '0x040ba8d0e4870ac54e4560e18b2666e3bf0b055c';
const row = (wallet,pets)=>({wallet,pets,...Object.fromEntries(FIELDS.map(f=>[f.key,'0']))});
const snapshot = rows=>({version:2,rows,coverage:{explorer_points:{available:false,note:'Not loaded'}}});
test('every eligible pet is requested after an individual failure and pet counts aggregate by wallet',async()=>{
  const d = snapshot([row(owner,[8159,2]),...Array.from({length:7},(_,i)=>row(wallet(i+1),[i+10]))]);
  const seen = [];
  await collectExplorer(d,{fetchPet:async id=>{
    seen.push(id); if (id===11) throw new Error('HTTP 429');
    return {ep:id===8159 ? 38200 : 100,quests:[{xpReward:999999}]};
  }});
  assert.equal(seen.length,9); assert.equal(d.rows[0].explorer_points,'38300');
  assert.deepEqual(new Set(seen),new Set(d.rows.flatMap(r=>r.pets)));
  assert.equal(d.explorer.version,2); assert.equal(d.explorer.source,QUESTS_API);
  assert.equal(d.rows[2].explorer_points,null); assert.equal(d.rows[7].explorer_points,'100');
  assert.equal(d.coverage.explorer_points.available,false);
  setExplorerFallback(d,11,wallet(2),'75','Verified in game');
  assert.equal(d.coverage.explorer_points.available,true);
  assert.equal(d.rows[2].explorer_points,'75');
});
test('valid API counts including zero take precedence; fallback never follows another owner',async()=>{
  for (const value of [0,40000]) {
    const d=snapshot([row(owner,[8159])]);
    d.explorer={fallbacks:[{petId:8159,wallet:owner,value:'38200',note:'Previously confirmed',recordedAt:'2026-10-09'}]};
    await collectExplorer(d,{fetchPet:async()=>({ep:value})});
    assert.equal(d.rows[0].explorer_points,String(value)); assert.deepEqual(reconcileExplorer(d),[]);
  }
  const d=snapshot([row(wallet(1),[8159])]);
  d.explorer={fallbacks:[{petId:8159,wallet:owner,value:'38200',note:'Previously confirmed',recordedAt:'2026-10-09'}]};
  await collectExplorer(d,{fetchPet:async()=>({quests:[]})});
  assert.equal(d.rows[0].explorer_points,null); assert.equal(d.explorer.fallbacks.length,0);
});
test('manual fallback validation, clearing, and seed replay preserve auditable allocation',async()=>{
  const d=snapshot([row(owner,[8159]),row(wallet(1),[1])]);
  await collectExplorer(d,{fetchPet:async id=>id===8159 ? {} : {ep:38200}});
  assert.equal(d.coverage.explorer_points.available,false); // No built-in 8159 fallback.
  setExplorerFallback(d,8159,owner,'38200','User supplied in game');
  assert.equal(d.coverage.explorer_points.available,true);
  for (const value of ['-1','1.5','NaN','']) {
    if (value) assert.throws(()=>setExplorerFallback(d,8159,owner,value,'Game UI'));
  }
  assert.throws(()=>setExplorerFallback(d,8159,owner,'12',''),/source note/);
  const config={pool:'1000',precision:2,mode:'weights',smoothing:'sqrt',weights:Object.fromEntries(FIELDS.map(f=>[f.key,f.key==='explorer_points'?'1':'0']))};
  const before=comparisonCSV(calculate(d.rows,config),'sqrt');
  const {saved}=await readSeed((await createSeed({dataset:d,config})).text);
  reconcileExplorer(saved.dataset);
  assert.equal(comparisonCSV(calculate(saved.dataset.rows,saved.config),'sqrt'),before);
  assert.equal(saved.dataset.explorer.fallbacks[0].value,'38200');
  assert.match(saved.dataset.explorer.fallbacks[0].note,/User supplied/);
  setExplorerFallback(d,8159,owner,'','');
  assert.equal(d.coverage.explorer_points.available,false);
  await collectExplorer(d,{fetchPet:async()=>({})});
  assert.equal(d.explorer.fallbacks.length,0); // A deliberate clear survives a refresh.
});
test('malformed audit records cannot silently add or omit a pet',async()=>{
  const d=snapshot([row(owner,[8159])]); await collectExplorer(d,{fetchPet:async()=>({})});
  const duplicate=structuredClone(d); duplicate.explorer.records.push({...duplicate.explorer.records[0]});
  assert.throws(()=>reconcileExplorer(duplicate),/does not match/);
  d.explorer.records=[]; assert.throws(()=>reconcileExplorer(d),/missing an eligible pet/);
});
test('quest response uses only ep and rejects absent, invalid or error totals',()=>{
  assert.equal(questRecord({ep:38200,quests:[{xpReward:999999}]},8159,owner,'now').apiValue,'38200');
  assert.equal(questRecord({ep:0},8159,owner,'now').apiValue,'0');
  for (const data of [{},{quests:[{xpReward:250}]},{ep:null},{ep:-1},{ep:1.5},{ep:9007199254740992},{ep:true},{ep:''},{ep:38200,error:'Failed'}])
    assert.equal(questRecord(data,8159,owner,'now').apiValue,null);
});
test('old Analytica seeds preserve their source; refresh migrates to direct quest data',async()=>{
  const d=snapshot([row(owner,[8159])]);
  d.explorer={version:1,records:[{petId:8159,wallet:owner,apiValue:null,issue:'No matching current pet record in FP Analytica.',fetchedAt:'2026-10-09'}],fallbacks:[{petId:8159,wallet:owner,value:'38200',note:'User supplied previously',recordedAt:'2026-10-09'}]};
  const {saved}=await readSeed((await createSeed({dataset:d,config:{}})).text);
  reconcileExplorer(saved.dataset);
  assert.equal(saved.dataset.rows[0].explorer_points,'38200');
  assert.match(explorerSource(saved.dataset.explorer),/FP Analytica/);
  await collectExplorer(saved.dataset,{fetchPet:async()=>({ep:40000})});
  assert.equal(saved.dataset.rows[0].explorer_points,'40000');
  assert.equal(explorerSource(saved.dataset.explorer),'Fren Pet quests API');
  assert.equal(saved.dataset.explorer.records[0].sourceUrl,QUESTS_API+'8159');
});
