import {collectExplorer,QUESTS_API} from './explorer.js';
import {FIELDS,formatUnits} from './core.js';
import {createRequestClient} from './requests.js';
import {createBaseReader} from './chain.js';
export const GRAPHQL='https://api.pet.game';
export const BALANCE_CUTOFF='2026-09-24T00:00:00Z';
export const BALANCE_FIELDS=['points','petage_carrots','staked_fp'];
export const FROZEN_FIELDS=['points','petage_carrots','lootboxes','staked_fp','explorer_points','shields_bought'];
export const REMAINING_FIELDS=['training_camps','potion_use','revives_bought'];
const GAME='0x0e22b5f3e11944578b37ed04f5312dfc246f443c';
export function assertFrozenSnapshot(data,reference){
 const select=d=>({window:d.window,balanceSnapshot:d.balanceSnapshot,blockNumber:d.blockNumber,blockTime:d.blockTime,rows:d.rows.map(r=>({wallet:r.wallet,pets:r.pets})).sort((a,b)=>a.wallet.localeCompare(b.wallet))});
 if(!reference||JSON.stringify(select(data))!==JSON.stringify(select(reference)))throw Error('This v2 report must use the original wallet cohort and date cutoffs.');
}
const requests=createRequestClient();
export const json=(url,options={},signal)=>requests.json(url,options,signal);
const base=createBaseReader(json);
export const DEFINITIONS={
points:'Per-pet points before September 24, 2026 00:00 UTC, summed by the captured current wallet.',
petage_carrots:'Per-pet carrots before September 24, 2026 00:00 UTC. Not days alive.',
staked_fp:'Per-pet staked FP before September 24, 2026 00:00 UTC.',
lootboxes:'Indexed loot spins during the captured activity range.',
explorer_points:'Current ep totals from a fresh Fren Pet quest API pull when refreshed.',
shields_bought:'Shop shield purchases during the captured activity range.',
training_camps:'Current trainingAtk + trainingDef levels from api.pet.game for each captured eligible pet, summed by wallet. Cumulative levels, not filtered by activity dates.',
potion_use:'1 if any captured eligible pet was sheep, penguin, dragon, monkey, panda or doge at the last block before September 24, 2026 00:00 UTC; otherwise 0. Historical DNA is read at that single Base block.',
revives_bought:'Count of api.pet.game hibernateds where loserId is a captured living pet, within the captured activity range. Hibernations are used as the revive proxy requested by the user.'
};
export function dateWindow(start, end, now = Math.floor(Date.now() / 1000)) {
  function parse(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Use dates in YYYY-MM-DD format.');
    const ms = Date.parse(s + 'T00:00:00Z');
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== s) throw new Error('Invalid calendar date.');
    return ms / 1000;
  }
  const from = start ? parse(start) : 0, requestedUntil = end ? parse(end) + 86400 : now + 1;
  if (requestedUntil <= from) throw new Error('End date must be on or after start date.');
  if (from > now) throw new Error('Start date is in the future.');
  if (end && parse(end) > now) throw new Error('End date is in the future.');
  return { from, until: Math.min(requestedUntil, now + 1), start, end, now };
}

const hexWord=value=>BigInt(value).toString(16).padStart(64,'0');
export function aggregateCall(calls) {
  const bodies = calls.map(c => {
    const data = c.params[0].data.slice(2);
    return c.params[0].to.slice(2).padStart(64,'0') + hexWord(64) + hexWord(data.length / 2) + data.padEnd(Math.ceil(data.length / 64) * 64,'0');
  });
  let offset = calls.length * 32;
  const offsets = bodies.map(b => { const w = hexWord(offset); offset += b.length / 2; return w; });
  return {method:'eth_call',params:[{to:'0xca11bde05977b3631167028862be2a173976ca11',data:'0x252dba42'+hexWord(32)+hexWord(calls.length)+offsets.join('')+bodies.join('')},calls[0].params[1]]};
}
export function aggregateResults(data, expected) {
  const s = data.slice(2), wordAt = byte => Number(BigInt('0x'+s.slice(byte*2,byte*2+64)));
  const array = wordAt(32), count = wordAt(array);
  if (count !== expected) throw new Error('Incomplete balance batch.');
  return Array.from({length:count},(_,i) => {
    const at = array + 32 + wordAt(array + 32 + i*32), length = wordAt(at);
    const value = s.slice((at+32)*2,(at+32+length)*2);
    if (value.length !== length*2) throw new Error('Truncated balance batch.');
    return '0x'+value;
  });
}

async function rpcBatch(calls,signal){const c=aggregateCall(calls);return aggregateResults(await base.rpc(c.method,c.params,signal),calls.length);}
export async function graphql(query,variables={},signal){const r=await json(GRAPHQL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})},signal);if(r.errors?.length)throw Error(r.errors.map(e=>e.message).join('; '));if(!r.data)throw Error('Game API returned no data.');return r.data;}
const count=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid '+label);return BigInt(value);};
function petsFor(dataset){const seen=new Set();return dataset.rows.flatMap(row=>row.pets.map(id=>{if(!Number.isSafeInteger(id)||id<0||seen.has(id))throw Error('Invalid or duplicate pet ID.');seen.add(id);return {id,wallet:row.wallet};}));}
export function evolvedSpecies(data){
 if(!/^0x(?:[0-9a-f]{64})+$/i.test(data||''))throw Error('Invalid historical DNA.');
 const w=data.slice(2).match(/.{64}/g).map(x=>BigInt('0x'+x));
 if(w[0]!==32n||w[1]<1n||w[1]>32n||BigInt(w.length)!==w[1]+2n)throw Error('Incomplete historical DNA.');
 const species=Number(w[2]);if(species<0||species>13)throw Error('Unknown pet species.');
 return {species,used:[7,9,10,11,12,13].includes(species)};
}
export async function collectTraining(dataset,{query=graphql,signal,onProgress=()=>{}}={}){
 const pets=petsFor(dataset),records=[];
 for(let offset=0;offset<pets.length;offset+=25){
  if(signal?.aborted)throw Error('Cancelled.');const group=pets.slice(offset,offset+25);onProgress('Training levels: '+offset+'/'+pets.length+' pets…');
  const d=await query('{pets(limit:25,where:{id_in:['+group.map(p=>p.id).join(',')+']}){items{id trainingAtk trainingDef}}}',{},signal);
  const items=d.pets?.items;if(!Array.isArray(items)||items.length!==group.length||new Set(items.map(p=>p.id)).size!==group.length)throw Error('Incomplete training levels.');
  for(const p of group){const found=items.find(x=>x.id===p.id);if(!found)throw Error('Missing training pet '+p.id);const attack=count(found.trainingAtk,'attack training level'),defense=count(found.trainingDef,'defense training level');records.push({...p,attack:String(attack),defense:String(defense),value:String(attack+defense)});}
 }
 return records;
}
export async function collectHibernations(dataset,{query=graphql,signal,onProgress=()=>{}}={}){
 const pets=petsFor(dataset),records=[];
 for(let offset=0;offset<pets.length;offset+=25){
  if(signal?.aborted)throw Error('Cancelled.');const group=pets.slice(offset,offset+25);onProgress('Hibernations: '+offset+'/'+pets.length+' pets…');
  const q='query($from:Int!,$until:Int!){'+group.map((p,i)=>'p'+i+':hibernateds(where:{loserId:'+p.id+',createdAt_gte:$from,createdAt_lt:$until}){totalCount}').join(' ')+'}';
  const d=await query(q,{from:dataset.window.from,until:dataset.window.until},signal);
  group.forEach((p,i)=>records.push({...p,value:String(count(d['p'+i]?.totalCount,'hibernation count'))}));
 }
 return records;
}
export async function collectPotionFlags(dataset,{read=rpcBatch,reader=base,signal,onProgress=()=>{}}={}){
 const snap=dataset.balanceSnapshot;if(snap?.cutoffExclusiveUtc!==BALANCE_CUTOFF||!Number.isSafeInteger(snap.blockNumber))throw Error('Missing historical cutoff block.');
 const cutoff=Date.parse(BALANCE_CUTOFF)/1000;
 const block=await reader.block(snap.blockNumber,signal),next=await reader.block(snap.blockNumber+1,signal);
 if(block.timestamp!==snap.blockTime||block.timestamp>=cutoff||next.timestamp<cutoff)throw Error('Cannot verify evolution cutoff block.');
 const pets=petsFor(dataset),records=[];
 for(let offset=0;offset<pets.length;offset+=25){
  if(signal?.aborted)throw Error('Cancelled.');const group=pets.slice(offset,offset+25);onProgress('Evolved species at cutoff: '+offset+'/'+pets.length+' pets…');
  const values=await read(group.map(p=>({method:'eth_call',params:[{to:GAME,data:'0x422627c3'+hexWord(p.id)},'0x'+snap.blockNumber.toString(16)]})),signal);
  if(values.length!==group.length)throw Error('Incomplete historical species batch.');
  group.forEach((p,i)=>{const found=evolvedSpecies(values[i]);records.push({...p,species:found.species,value:found.used?'1':'0'});});
 }
 return records;
}
export function applyRecords(dataset,key,records){
 const pets=petsFor(dataset),expected=new Map(pets.map(p=>[p.id,p.wallet]));
 if(records.length!==pets.length||new Set(records.map(r=>r.id)).size!==pets.length)throw Error('Incomplete field records.');
 const totals=new Map(dataset.rows.map(r=>[r.wallet,0n]));
 for(const r of records){if(expected.get(r.id)!==r.wallet||!/^\d+$/.test(r.value))throw Error('Invalid field record.');const value=BigInt(r.value);if(key==='potion_use'&&value>1n)throw Error('Invalid potion flag.');totals.set(r.wallet,key==='potion_use'?(totals.get(r.wallet)||value):totals.get(r.wallet)+value);}
 for(const row of dataset.rows)row[key]=String(totals.get(row.wallet));
 dataset.remainingAudit??={};dataset.remainingAudit[key]={source:key==='potion_use'?'Historical Base getDna':'https://api.pet.game',checkedAt:new Date().toISOString(),records};
 dataset.coverage[key]={available:true,note:key==='training_camps'?'Current attack + defense training levels':key==='potion_use'?'Evolved species before September 24, 2026 00:00 UTC → 0/1':'Hibernations in captured date range → revive proxy'};
}
export async function loadRemaining(dataset,{signal,onProgress=()=>{},onSnapshot=()=>{},requestMode='slow',fields=REMAINING_FIELDS,collectors={training_camps:collectTraining,revives_bought:collectHibernations,potion_use:collectPotionFlags}}={}){
 if(!Array.isArray(fields)||!fields.length||fields.some(k=>!FIELDS.some(f=>f.key===k))||new Set(fields).size!==fields.length)throw Error('Select a valid field.');
 requests.configure({mode:requestMode,onWait:onProgress});const data=structuredClone(dataset);
 for(const key of fields){
  const collect=collectors[key];
  try{
   if(collect){const records=await collect(data,{signal,onProgress});applyRecords(data,key,records);}
   else await refreshPreloaded(data,key,{signal,onProgress});
  }
  catch(e){if(signal?.aborted)throw Error('Cancelled.');if(key==='explorer_points')delete data.explorer;data.rows.forEach(r=>r[key]=null);delete data.remainingAudit?.[key];data.coverage[key]={available:false,note:e.message};}
  onSnapshot(structuredClone(data));
 }
 return data;
}

export async function refreshPreloaded(data,key,{signal,onProgress=()=>{},query=graphql,read=rpcBatch,reader=base,fetchPet=id=>json(QUESTS_API+id,{},signal)}={}){
 if(!FROZEN_FIELDS.includes(key))throw Error('Unknown field.');
 if(key==='explorer_points'){await collectExplorer(data,{signal,onProgress,fetchPet});return;}
 const pets=petsFor(data),totals=new Map(data.rows.map(r=>[r.wallet,0n])),records=[];
 if(BALANCE_FIELDS.includes(key)){
  const snap=data.balanceSnapshot,cutoff=Date.parse(BALANCE_CUTOFF)/1000;
  if(snap?.cutoffExclusiveUtc!==BALANCE_CUTOFF||!Number.isSafeInteger(snap.blockNumber))throw Error('Missing historical cutoff block.');
  const b=await reader.block(snap.blockNumber,signal),next=await reader.block(snap.blockNumber+1,signal);
  if(b.timestamp!==snap.blockTime||b.timestamp>=cutoff||next.timestamp<cutoff)throw Error('Cannot verify balance cutoff block.');
  const selector={points:'0x13c2dfc3',petage_carrots:'0xad8c0c03',staked_fp:'0xb525f504'}[key];
  for(let offset=0;offset<pets.length;offset+=25){
   if(signal?.aborted)throw Error('Cancelled.');const group=pets.slice(offset,offset+25);onProgress(key+': '+offset+'/'+pets.length+' pets…');
   const values=await read(group.map(p=>({method:'eth_call',params:[{to:GAME,data:selector+hexWord(p.id)},'0x'+snap.blockNumber.toString(16)]})),signal);
   if(values.length!==group.length||values.some(v=>!/^0x[0-9a-f]{64}$/i.test(v)))throw Error('Incomplete historical balances.');
   group.forEach((p,i)=>{totals.set(p.wallet,totals.get(p.wallet)+BigInt(values[i]));records.push({...p,raw:values[i]});});
  }
  data.rows.forEach(r=>r[key]=formatUnits(totals.get(r.wallet),key==='points'?12:18));
 }else{
  const owners=new Map(data.rows.map(r=>[r.wallet,new Set([r.wallet])]));
  if(key==='shields_bought')for(let offset=0;offset<pets.length;offset+=25){
   const group=pets.slice(offset,offset+25);onProgress('Checking shield owner address forms: '+offset+'/'+pets.length+' pets…');
   const d=await query('{pets(limit:25,where:{id_in:['+group.map(p=>p.id).join(',')+']}){items{id owner}}}',{},signal);
   if(!Array.isArray(d.pets?.items)||d.pets.items.length!==group.length)throw Error('Incomplete shield owner records.');
   for(const p of d.pets.items){if(typeof p.owner!=='string'||!/^0x[0-9a-f]{40}$/i.test(p.owner))throw Error('Invalid shield owner address.');owners.get(p.owner.toLowerCase())?.add(p.owner);}
  }
  const targets=key==='lootboxes'?pets:data.rows.map(r=>({wallet:r.wallet}));
  for(let offset=0;offset<targets.length;offset+=25){
   if(signal?.aborted)throw Error('Cancelled.');const group=targets.slice(offset,offset+25);onProgress(key+': '+offset+'/'+targets.length+' records…');
   const q='query($from:Int!,$until:Int!){'+group.map((p,i)=>'p'+i+':'+(key==='lootboxes'?'lootSpins(where:{petId:'+p.id:'consumeds(where:{giver_in:'+JSON.stringify([...owners.get(p.wallet)])+',itemId:6,isSell:false')+',createdAt_gte:$from,createdAt_lt:$until}){totalCount}').join(' ')+'}';
   const d=await query(q,{from:data.window.from,until:data.window.until},signal);
   group.forEach((p,i)=>{const value=count(d['p'+i]?.totalCount,key+' count');totals.set(p.wallet,totals.get(p.wallet)+value);records.push({...p,value:String(value)});});
  }
  data.rows.forEach(r=>r[key]=String(totals.get(r.wallet)));
 }
 const checkedAt=new Date().toISOString();
 data.remainingAudit??={};data.remainingAudit[key]={source:BALANCE_FIELDS.includes(key)?'Historical Base balance':GRAPHQL,checkedAt,records};
 data.coverage[key]={available:true,note:(BALANCE_FIELDS.includes(key)?'Before September 24, 2026 00:00 UTC · Base block '+data.balanceSnapshot.blockNumber:key==='lootboxes'?'Indexed spins within the date range':'Shop purchases within the date range')+' · Refreshed '+checkedAt};
}
