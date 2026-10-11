export const QUESTS_API = 'https://www.frenpet.xyz/api/quests/';
// New pulls have no built-in overrides. Explicit corrections in saved data survive.
export const DEFAULT_EXPLORER_FALLBACKS = [];
export const explorerSource = state => state?.version === 2 ? 'Fren Pet quests API' : 'FP Analytica (saved snapshot)';
const key = (wallet, petId) => `${wallet.toLowerCase()}:${petId}`;
export function explorerCount(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value)))
    throw new Error('Explorer Points must be a non-negative whole number.');
  return String(BigInt(value));
}
export function questRecord(data, petId, wallet, fetchedAt) {
  const record = {petId,wallet,apiValue:null,fetchedAt,issue:'',sourceUrl:QUESTS_API+petId};
  try {
    if (data?.error || data?.success === false) throw new Error('Quest request failed.');
    record.apiValue = explorerCount(data?.ep);
  } catch { record.issue = 'Fren Pet quests API returned no valid ep count.'; }
  return record;
}
export function reconcileExplorer(dataset) {
  const state = dataset.explorer;
  if (!state) return []; // Older saved snapshots remain supported.
  if (![1,2].includes(state.version) || !Array.isArray(state.records) || !Array.isArray(state.fallbacks) || (state.version === 2 && state.source !== QUESTS_API)) throw new Error('Invalid Explorer Points audit data.');
  const eligible = new Map();
  for (const row of dataset.rows) {
    if (!Array.isArray(row.pets)) throw new Error('Missing eligible pet IDs.');
    for (const petId of row.pets) {
      if (!Number.isSafeInteger(Number(petId)) || Number(petId) < 0 || eligible.has(key(row.wallet,petId))) throw new Error('Invalid or duplicate eligible pet ID.');
      eligible.set(key(row.wallet,petId),row);
    }
  }
  const records = new Map(), fallbacks = new Map();
  for (const record of state.records) {
    const k = key(record.wallet,record.petId);
    if (!eligible.has(k) || records.has(k)) throw new Error('Explorer record does not match an eligible pet.');
    if (record.apiValue !== null) record.apiValue = explorerCount(record.apiValue);
    if (typeof record.issue !== 'string' || typeof record.fetchedAt !== 'string') throw new Error('Invalid Explorer record metadata.');
    if (state.version === 2 && record.sourceUrl !== QUESTS_API+record.petId) throw new Error('Invalid quest source URL.');
    records.set(k,record);
  }
  for (const fallback of state.fallbacks) {
    const k = key(fallback.wallet,fallback.petId);
    if (!eligible.has(k) || fallbacks.has(k)) throw new Error('Explorer fallback does not match an eligible pet.');
    fallback.value = explorerCount(fallback.value);
    if (!fallback.note?.trim() || typeof fallback.recordedAt !== 'string' || !fallback.recordedAt) throw new Error('Manual Explorer Points require a source note and date.');
    fallbacks.set(k,fallback);
  }
  const issues = [], totals = new Map(dataset.rows.map(r=>[r.wallet,0n])), missingWallets = new Set();
  let missing = 0, manual = 0;
  for (const [k,row] of eligible) {
    const record = records.get(k);
    if (!record) throw new Error('Explorer audit is missing an eligible pet.');
    const fallback = fallbacks.get(k);
    if (record.apiValue !== null) totals.set(row.wallet,totals.get(row.wallet)+BigInt(record.apiValue));
    else {
      issues.push({...record,fallback:fallback || null});
      if (fallback) { totals.set(row.wallet,totals.get(row.wallet)+BigInt(fallback.value)); manual++; }
      else { missing++; missingWallets.add(row.wallet); }
    }
  }
  for (const row of dataset.rows) row.explorer_points = missingWallets.has(row.wallet) ? null : String(totals.get(row.wallet));
  dataset.coverage.explorer_points = {
    available:missing === 0,
    note:missing ? `${missing} pet(s) need Explorer Points; other records retained. Open Explorer Points corrections.` :
      `${explorerSource(state)}${manual ? ` + ${manual} user-provided fallback(s)` : ''} · activity dates do not apply`
  };
  return issues;
}
export function setExplorerFallback(dataset, petId, wallet, value, note, recordedAt = new Date().toISOString()) {
  reconcileExplorer(dataset);
  const state = dataset.explorer, k = key(wallet,petId);
  const record = state?.records.find(r=>key(r.wallet,r.petId)===k);
  if (!record || record.apiValue !== null) throw new Error('Manual fallback is only available for a missing API value.');
  let fallback = null;
  if (value !== '') {
    if (!note.trim()) throw new Error('Enter a source note for the manual count.');
    fallback = {petId:record.petId,wallet:record.wallet,value:explorerCount(value),note:note.trim(),recordedAt};
  }
  state.fallbacks = state.fallbacks.filter(f=>key(f.wallet,f.petId)!==k);
  if (fallback) state.fallbacks.push(fallback);
  return reconcileExplorer(dataset);
}
export async function collectExplorer(dataset, {fetchPet, signal, onProgress = ()=>{}}) {
  const eligible = new Set(dataset.rows.flatMap(r=>r.pets.map(id=>key(r.wallet,id))));
  const fallbacks = structuredClone(dataset.explorer?.fallbacks ?? DEFAULT_EXPLORER_FALLBACKS).filter(f=>eligible.has(key(f.wallet,f.petId)));
  let cursor = 0, count = 0;
  const pending = dataset.rows.flatMap(row=>row.pets.map(petId=>({petId,wallet:row.wallet})));
  const records = new Array(pending.length);
  const workers = Array.from({length:3},async()=>{
    while (cursor < pending.length) {
      if (signal?.aborted) throw new Error('Cancelled.');
      const index = cursor++, {petId,wallet} = pending[index];
      try { records[index] = questRecord(await fetchPet(petId),petId,wallet,new Date().toISOString()); }
      catch (error) {
        if (signal?.aborted) throw new Error('Cancelled.');
        records[index] = {...questRecord(null,petId,wallet,new Date().toISOString()),issue:error.message || String(error)};
      }
      onProgress(`Fren Pet Explorer Points: ${++count}/${pending.length} pets…`);
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(o=>o.status==='rejected');
  if (failure) throw failure.reason;
  dataset.explorer = {version:2,source:QUESTS_API,records,fallbacks};
  reconcileExplorer(dataset);
  return dataset;
}
