import test from 'node:test';
import assert from 'node:assert/strict';
import {FIELDS,calculate,sqrtComparison,comparisonCSV,parseDelimited,asNumber} from '../web/core.js';
const row = (i,p,l) => ({wallet:'0x'+String(i).padStart(40,'0'),...Object.fromEntries(FIELDS.map(f=>[f.key,'0'])),points:p,lootboxes:l});
const config = {pool:'1000',precision:6,mode:'percent',weights:Object.fromEntries(FIELDS.map(f=>[f.key,f.key==='points'?'20':f.key==='lootboxes'?'60':'0']))};
test('sqrt acts after field allocation and preserves the same allocated budget and reserve', () => {
  const r = calculate([row(1,'100','0'),row(2,'0','3'),row(3,'0','0')],config);
  const s = sqrtComparison(r);
  assert.equal([...s.values()].reduce((n,r)=>n+r.units,0n),r.allocatedUnits);
  assert.equal(r.unallocatedUnits,200000000n);
  assert.equal(s.get(row(3).wallet).units,0n);
  const share = asNumber(s.get(row(1).wallet).share);
  assert.ok(Math.abs(share - 0.8/(1+Math.sqrt(3))) < 1e-12);
});
test('CSV includes both methods and never presents unavailable source counts as zero', () => {
  const r = calculate([row(1,'1','1')],config);
  const parsed = parseDelimited(comparisonCSV(r,'sqrt',{revives_bought:{available:false}}));
  assert.equal(parsed.records[0][parsed.headers.indexOf('selected_method')],'sqrt');
  assert.equal(parsed.records[0][parsed.headers.indexOf('revives_bought_count')],'unavailable');
  assert.equal(parsed.records[0][parsed.headers.indexOf('revives_bought_within_field_pct')],'');
});
