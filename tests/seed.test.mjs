import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed,readSeed} from '../web/seed.js';
import {FIELDS,calculate,comparisonCSV} from '../web/core.js';
const saved = {dataset:{version:5,balanceSnapshot:{cutoffExclusiveUtc:"2026-09-24T00:00:00Z",blockNumber:1,blockTime:1790207999},rows:[{wallet:'0x'+'a'.repeat(40),...Object.fromEntries(FIELDS.map(f=>[f.key,'1']))}],window:{start:'2023-11-10',end:'2026-09-30'},blockTime:1791579000},config:{pool:'250000',precision:18,mode:'weights',smoothing:'sqrt',weights:Object.fromEntries(FIELDS.map(f=>[f.key,'1']))}};
test('verification seed reproduces frozen data, settings and both allocation methods exactly', async()=>{
  const seed = await createSeed(saved), restored = await readSeed(seed.text);
  assert.deepEqual(restored.saved.dataset,saved.dataset); assert.deepEqual(restored.saved.config,saved.config);
  const before = comparisonCSV(calculate(saved.dataset.rows,saved.config),'sqrt');
  const after = comparisonCSV(calculate(restored.saved.dataset.rows,restored.saved.config),'sqrt');
  assert.equal(before,after); assert.equal(restored.digest,seed.digest);
});
test('modified checksums and damaged seeds are rejected',async()=>{
  const seed = await createSeed(saved);
  await assert.rejects(readSeed(seed.text.replace(seed.digest,'0'.repeat(64))),/checksum/);
  await assert.rejects(readSeed(seed.text.slice(0,-20)),/damaged/);
  await assert.rejects(readSeed('not a seed'),/Invalid/);
});
