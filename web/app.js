import { FIELDS, fieldInputTotals, sortWalletRows, decimal, add, fraction, mul, formatFraction, formatUnits, calculate, normalizeRows, sqrtComparison, comparisonCSV, csv } from './core.js';
import {loadRemaining,dateWindow,DEFINITIONS,BALANCE_CUTOFF,BALANCE_FIELDS,FROZEN_FIELDS,assertFrozenSnapshot} from './api.js';
import {reconcileExplorer,explorerSource} from './explorer.js';
import {createSeed,readSeed} from './seed.js';
const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = x => formatFraction(mul(x, fraction(100n)), 8);
let dataset = null, result = null, roots = null, controller = null, page = 0;
let frozenReference=null;

$('fields').innerHTML = FIELDS.map(f => `<tr><td><div class="field-label"><button data-refresh-field="${f.key}" id="refresh-${f.key}" aria-label="Refresh ${escape(f.label)}" title="Refresh ${escape(f.label)} from source"><span aria-hidden="true">↻</span></button><span>${escape(f.label)}</span></div></td><td><input id="weight-${f.key}" aria-label="${escape(f.label)} weight" value="0" inputmode="decimal"></td><td id="share-${f.key}">—</td><td id="total-${f.key}">—</td><td id="coverage-${f.key}">Not loaded</td></tr>`).join('');
$('sort-field').innerHTML = '<option value="default">Allocation / default order</option>' + FIELDS.map(f=>`<option value="${f.key}">${escape(f.label)}</option>`).join('');
$('definitions').innerHTML = '<table>' + FIELDS.map(f => `<tr><th>${escape(f.label)}</th><td>${escape(DEFINITIONS[f.key])}</td></tr>`).join('') + '</table>';
function config() { return { pool: $('pool').value, precision: Number($('precision').value), mode: $('mode').value, smoothing: $('smoothing').value, weights: Object.fromEntries(FIELDS.map(f => [f.key, $('weight-' + f.key).value])) }; }
function stale() { return dataset && (dataset.window.start !== $('start').value || dataset.window.end !== $('end').value); }
function renderInputTotals() {
  const c=config();
  try {
    const totals=fieldInputTotals(c.weights,c.mode);
    for(const key of ['weight','pool']) {
      const value=totals[key], exact=value.n===100n*value.d, box=$(key+'-checker');
      const relative=key==='weight'&&c.mode==='weights';
      box.className='total-checker '+(exact?'complete':'incomplete');
      box.querySelector('strong').textContent=formatFraction(value,18)+(relative?'':'%');
      const delta=add(value,fraction(-100n));
      box.querySelector('small').textContent=relative?'Relative weight total':exact?'Complete':formatFraction(fraction(delta.n<0n?-delta.n:delta.n,delta.d),18)+'% '+(delta.n<0n?'remaining':'over');
    }
    FIELDS.forEach((f,i)=>$('share-'+f.key).textContent=formatFraction(totals.shares[i],8)+'%');
  } catch {
    for(const key of ['weight','pool']) {
      const box=$(key+'-checker');box.className='total-checker incomplete';
      box.querySelector('strong').textContent='—';box.querySelector('small').textContent='Check inputs';
    }
  }
}
function recalculate() {
  if (dataset?.explorer) reconcileExplorer(dataset);
  result = null; roots = null; $('error').textContent = ''; $('summary').textContent = '';
  $('export').disabled = $('export-fields').disabled = $('seed-create').disabled = true; $('save').disabled = !dataset || Boolean(controller) || stale();
  $('seed-apply').disabled = Boolean(controller);
  renderExplorer();
  for (const f of FIELDS) {
    $('refresh-'+f.key).disabled = !dataset || !frozenReference || Boolean(controller);
    const available = dataset?.coverage[f.key]?.available;
    const coverage = $('coverage-' + f.key);
    coverage.textContent = dataset?.coverage[f.key]?.note || 'Not loaded';
    coverage.className = available === false ? 'unavailable' : '';
    $('share-' + f.key).textContent = '—';
    $('total-' + f.key).textContent = available ? formatFraction(dataset.rows.reduce((sum, row) => add(sum, decimal(row[f.key])), fraction()), 8) : '—';
  }
  renderInputTotals();
  try {
    if (!dataset) { render(); return; }
    if (controller) { render(); return; }
    if (stale()) throw new Error('Dates changed. Refresh API data to apply this range.');
    const c = config();
    for (const f of FIELDS) if (!dataset.coverage[f.key].available && decimal(c.weights[f.key], f.label + ' weight').n) throw new Error(f.key === 'explorer_points' ? 'Explorer Points has unresolved records. Open Explorer Points corrections to fill them, or set its weight to 0 to exclude this field.' : `${f.label} is unavailable. Refresh data, or set its weight to 0 to exclude it.`);
    const clean = normalizeRows(dataset.rows.map(r => ({ ...r, ...Object.fromEntries(FIELDS.filter(f => !dataset.coverage[f.key].available).map(f => [f.key, '0'])) }))).rows;
    result = calculate(clean, c); roots = sqrtComparison(result);
    for (const f of result.factors) $('share-' + f.key).textContent = pct(f.share) + '%';
    $('summary').textContent = `${dataset.rows.length.toLocaleString()} wallets · Allocated: ${formatUnits(result.allocatedUnits, result.precision)} · Unallocated: ${formatUnits(result.unallocatedUnits, result.precision)}`;
    $('export').disabled = $('export-fields').disabled = $('seed-create').disabled = false;
  } catch (e) { $('error').textContent = e.message; }
  render();
}
function render() {
  const search = $('search').value.trim().toLowerCase();
  let rows = (result?.rows || dataset?.rows || []).filter(r => r.wallet.includes(search));
  if (result && $('smoothing').value === 'sqrt') rows = [...rows].sort((a,b) => roots.get(a.wallet).units > roots.get(b.wallet).units ? -1 : roots.get(a.wallet).units < roots.get(b.wallet).units ? 1 : a.wallet.localeCompare(b.wallet));
  if(dataset) rows=sortWalletRows(rows,dataset.rows,$('sort-field').value,$('sort-direction').value);
  const pageSize=Number($('page-size').value);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.max(0, Math.min(page, pages - 1));
  $('page').textContent = rows.length ? `Page ${page + 1} / ${pages} · ${rows.length} wallets` : 'No wallets';
  $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1;
  $('page-jump').max=String(pages);$('page-jump').value=String(page+1);$('page-jump').disabled=$('page-go').disabled=!rows.length;
  if (!rows.length) { $('results').textContent = dataset ? 'No matching wallets.' : 'Load API data, then set field weights.'; return; }
  const view = result ? $('view').value : 'counts';
  $('view-note').textContent = view==='shares' ? 'Weighted contribution to the total pool before sqrt smoothing. Zero-weight fields contribute 0%. See Allocation comparison for the final payout.' : view==='within' ? 'Unweighted share of each field’s total. These percentages do not represent payout contributions and do not change with field weights.' : '';
  const headers = view === 'comparison' ? ['Wallet', 'No smoothing %', 'No smoothing amount', 'Sqrt %', 'Sqrt amount'] : ['Wallet', ...FIELDS.map(f => f.short + (['shares','within'].includes(view) ? ' %' : ''))];
  const body = rows.slice(page * pageSize, (page + 1) * pageSize).map(r => {
    let cells;
    if (view === 'comparison') { const s = roots.get(r.wallet); cells = [pct(r.share), formatUnits(r.units, result.precision), pct(s.share), formatUnits(s.units, result.precision)]; }
    else cells = FIELDS.map(f => view === 'counts' ? (dataset.rows.find(x => x.wallet === r.wallet)?.[f.key] ?? 'unavailable') : view==='shares' ? pct(r.breakdown.find(b=>b.key===f.key).overall) : !dataset.coverage[f.key].available ? 'unavailable' : pct(r.breakdown.find(b => b.key === f.key).within));
    return `<tr><td class="wallet">${escape(r.wallet)}</td>${cells.map((v,i) => `<td${view === 'comparison' && i === 3 ? ' class="sqrt-amount"' : ''}>${escape(v)}</td>`).join('')}</tr>`;
  }).join('');
  $('results').innerHTML = `<table><thead><tr>${headers.map((h,i) => `<th${view==='comparison'&&i===4?' class="sqrt-amount"':''}>${escape(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
function download(name, text, type) { const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function status() { const missing = FIELDS.filter(f => !dataset.coverage[f.key].available).length; $('load-status').textContent = `${dataset.livingPets} living pets · ${dataset.rows.length} wallets · Eligibility checked: ${new Date(dataset.blockTime * 1000).toISOString()} · Historical balances: ${dataset.balanceSnapshot ? new Date(dataset.balanceSnapshot.blockTime*1000).toISOString() : 'unavailable'} · ${missing ? missing + ' fields unavailable (see below)' : 'All fields loaded'}`; }
function renderExplorer() {
  const disabled = true;
  $('explorer-refresh').disabled = disabled;
  $('explorer-export').disabled = !dataset?.explorer || Boolean(controller);
  if (!dataset?.explorer) {
    $('explorer-status').textContent = dataset ? 'Refresh Explorer Points to get per-pet coverage for this saved snapshot.' : 'Load API data to see missing records and applied fallbacks.';
    $('explorer-issues').textContent = ''; return;
  }
  const issues = reconcileExplorer(dataset), unresolved = issues.filter(r=>!r.fallback).length;
  $('explorer-status').textContent = `${explorerSource(dataset.explorer)} · ${issues.length-unresolved} user-provided fallback(s) applied · ${unresolved} unresolved pet(s). Other wallets keep their API values.`;
  if (!issues.length) { $('explorer-issues').textContent = 'Every eligible pet has a valid API value.'; return; }
  $('explorer-issues').innerHTML = '<table><thead><tr><th>Pet / wallet</th><th>API issue</th><th>Explorer Points</th><th>Source note</th><th></th></tr></thead><tbody>' + issues.map((r,i)=>`<tr><td>#${escape(r.petId)}<br><span class="wallet">${escape(r.wallet)}</span></td><td>${escape(r.issue)}</td><td><input id="explorer-count-${i}" aria-label="Explorer Points for pet ${escape(r.petId)}" inputmode="numeric" value="${escape(r.fallback?.value ?? '')}" ${disabled?'disabled':''}></td><td><input id="explorer-note-${i}" aria-label="Source note for pet ${escape(r.petId)}" value="${escape(r.fallback?.note ?? '')}" ${disabled?'disabled':''}></td><td><button data-explorer-apply="${i}" ${disabled?'disabled':''}>Apply</button> <button data-explorer-clear="${i}" ${disabled || !r.fallback?'disabled':''}>Clear</button></td></tr>`).join('')+'</tbody></table>';
}
function importControls(busy) {
  $('refresh').disabled = busy; $('cancel').hidden = !busy; $('restore').disabled = busy;
  $('start').disabled = $('end').disabled = true; $('request-mode').disabled = busy;
}
$('explorer-export').addEventListener('click',()=>{
  if (!dataset?.explorer || controller || stale()) return;
  const audit = dataset.explorer.records.map(r=>{
    const f = dataset.explorer.fallbacks.find(f=>f.petId===r.petId && f.wallet===r.wallet), manual = r.apiValue===null && f;
    return [r.petId,r.wallet,r.apiValue ?? '',manual ? f.value : r.apiValue ?? '',r.apiValue!==null ? explorerSource(dataset.explorer) : manual ? 'User-provided fallback' : 'Unresolved',r.fetchedAt,manual ? f.note : '',manual ? f.recordedAt : '',r.issue,r.sourceUrl || ''];
  });
  download('explorer-points-audit.csv',csv(['pet_id','wallet','api_points','used_points','source','api_checked_at','manual_source_note','manual_recorded_at','api_issue','source_url'],audit),'text/csv');
});
async function refreshFields(fields) {
  if (controller) return;
  try { dateWindow($('start').value, $('end').value); } catch(e) { $('error').textContent = e.message; return; }
  controller = new AbortController(); importControls(true); recalculate();
  try { dataset = await loadRemaining(dataset,{fields,requestMode:$('request-mode').value,signal:controller.signal,onProgress:s => $('load-status').textContent = s,onSnapshot:d => { dataset=d; recalculate(); }}); page = 0; status(); }
  catch(e) { $('load-status').textContent = e.message + (dataset ? ' Completed fields retained; unfinished fields are unavailable.' : ' No data loaded.'); }
  finally { controller = null; importControls(false); recalculate(); }
}
$('refresh').addEventListener('click',()=>refreshFields());
$('fields').addEventListener('click',event=>{
  const key=event.target.closest('[data-refresh-field]')?.dataset.refreshField;
  if(!key || controller || !dataset || !frozenReference)return;
  refreshFields([key]);
});
$('cancel').addEventListener('click', () => controller?.abort());
for (const id of ['pool','precision','mode','smoothing','start','end',...FIELDS.map(f => 'weight-' + f.key)]) $(id).addEventListener('input', recalculate);
for (const id of ['view','search','sort-field','sort-direction']) $(id).addEventListener('input', () => { page = 0; render(); });
$('page-size').addEventListener('change',()=>{page=0;render();});
function jumpPage(){const value=Number($('page-jump').value);if(!Number.isSafeInteger(value)||value<1){$('page-jump').value=String(page+1);return;}page=value-1;render();}
$('page-go').addEventListener('click',jumpPage);
$('page-jump').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpPage();}});
$('prev').addEventListener('click', () => { page--; render(); }); $('next').addEventListener('click', () => { page++; render(); });
$('export').addEventListener('click', () => { if (result && !controller && !stale()) download('wallet-allocations.csv', comparisonCSV(result, $('smoothing').value, dataset.coverage), 'text/csv'); });
$('export-fields').addEventListener('click', () => { if (!result || stale() || controller) return; download('field-weights.csv', csv(['field','entered_weight_or_percent','pool_percent','field_total','data_status','activity_start_utc','activity_end_utc','eligibility_checked_utc','balance_cutoff_exclusive_utc','balance_block','balance_snapshot_utc'], result.factors.map(f => [f.label,config().weights[f.key],pct(f.share),dataset.coverage[f.key].available ? formatFraction(f.total,18) : '',dataset.coverage[f.key].note,dataset.window.start,dataset.window.end,new Date(dataset.blockTime*1000).toISOString(),BALANCE_FIELDS.includes(f.key)?BALANCE_CUTOFF:'',BALANCE_FIELDS.includes(f.key)?dataset.balanceSnapshot?.blockNumber ?? '':'',BALANCE_FIELDS.includes(f.key)&&dataset.balanceSnapshot?new Date(dataset.balanceSnapshot.blockTime*1000).toISOString():''])), 'text/csv'); });
$('save').addEventListener('click', () => { if (!dataset || stale() || controller) return; download('fren-pet-snapshot.json', JSON.stringify({dataset,config:config()},null,2), 'application/json'); });
function restoreSaved(saved) {
    if (controller) throw new Error('Wait for the current import or cancel it first.');
    const d = saved.dataset, c = saved.config;
    if (d?.version !== 6 || !Array.isArray(d.rows) || !d.coverage || !d.window || !Number.isFinite(d.blockTime) || !c) throw new Error('This snapshot is not compatible with the current calculator. Load fresh API data.');
    if(BALANCE_FIELDS.some(key=>d.coverage[key]?.available) && (d.balanceSnapshot?.cutoffExclusiveUtc!==BALANCE_CUTOFF || !Number.isSafeInteger(d.balanceSnapshot.blockNumber) || !Number.isSafeInteger(d.balanceSnapshot.blockTime) || d.balanceSnapshot.blockTime>=Date.parse(BALANCE_CUTOFF)/1000)) throw new Error('Invalid historical balance snapshot. Load fresh API data.');
    assertFrozenSnapshot(d,frozenReference);
    dateWindow(d.window.start, d.window.end);
    for (const f of FIELDS) if (typeof d.coverage[f.key]?.available !== 'boolean' || typeof d.coverage[f.key]?.note !== 'string') throw new Error('Invalid field coverage.');
    if (d.explorer) reconcileExplorer(d);
    const normalized = normalizeRows(d.rows.map(r => ({ ...r, ...Object.fromEntries(FIELDS.filter(f => !d.coverage[f.key].available).map(f => [f.key,'0'])) })));
    if (normalized.duplicates) throw new Error('Saved snapshot contains duplicate wallets.');
    for (const row of d.rows) { row.wallet = row.wallet.toLowerCase(); for (const f of FIELDS) if (!d.coverage[f.key].available && !(f.key==='explorer_points' && d.explorer)) row[f.key] = null; }
    for (const f of FIELDS) decimal(c.weights?.[f.key], f.label + ' weight');
    if (!['weights','percent'].includes(c.mode) || !['none','sqrt'].includes(c.smoothing)) throw new Error('Invalid saved settings.');
    dataset = d; $('explorer-error').textContent = ''; $('start').value = d.window.start; $('end').value = d.window.end;
    for (const id of ['pool','precision','mode','smoothing']) $(id).value = c[id];
    for (const f of FIELDS) $('weight-' + f.key).value = c.weights[f.key];
    status(); page = 0; recalculate();
}
$('restore').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 25000000) throw new Error('Saved file exceeds 25 MB.');
    restoreSaved(JSON.parse(await file.text()));
  } catch(e) { $('error').textContent = e.message; }
  event.target.value = '';
});
$('seed-create').addEventListener('click', async () => {
  if (!result || stale() || controller) return;
  try {
    const seed = await createSeed({dataset,config:config()});
    $('seed-text').value = seed.text; $('seed-copy').disabled = $('seed-download').disabled = false;
    $('seed-status').textContent = 'SHA-256: '+seed.digest+' · Frozen results; create a new seed after changing data or settings.';
  } catch(e) { $('seed-status').textContent = e.message; }
});
$('seed-text').addEventListener('input', () => { const empty = !$('seed-text').value.trim(); $('seed-copy').disabled = $('seed-download').disabled = empty; $('seed-status').textContent = ''; });
$('seed-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('seed-text').value); $('seed-status').textContent = 'Seed copied. Share it with someone using this calculator.'; } catch { $('seed-status').textContent = 'Select the seed text and copy it manually.'; } });
$('seed-download').addEventListener('click', () => download('fren-pet-verification-seed.txt',$('seed-text').value,'text/plain'));
$('seed-apply').addEventListener('click', async () => {
  if (controller) return;
  try { const {saved,digest} = await readSeed($('seed-text').value); restoreSaved(saved); $('seed-status').textContent = 'Checksum verified. Restored frozen snapshot and settings. SHA-256: '+digest; }
  catch(e) { $('seed-status').textContent = e.message; }
});
recalculate();
$('refresh').disabled=true;
$('start').disabled=$('end').disabled=true;
$('load-status').textContent='Loading the six preloaded fields…';
fetch('./frozen.json').then(r=>{if(!r.ok)throw Error('Frozen data could not be loaded.');return r.json();}).then(saved=>{
 frozenReference=structuredClone(saved.dataset);saved.config={...saved.config,pool:'282000',smoothing:'sqrt'};restoreSaved(saved);$('refresh').disabled=false;
}).catch(e=>{$('load-status').textContent=e.message;$('refresh').disabled=true;});
