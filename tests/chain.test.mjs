import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseReader} from '../web/chain.js';
const hex=n=>'0x'+n.toString(16);
const log=(block,index=0)=>({blockNumber:hex(block),transactionIndex:'0x0',logIndex:hex(index),transactionHash:'0x'+block.toString(16).padStart(64,'0'),data:'0x',topics:[]});
test('RPC block search honors inclusive start, exclusive end and a frozen head',async()=>{
  const seen=[];
  const reader=createBaseReader(async(url,options)=>{
    assert.equal(url,'/api/base-rpc');const q=JSON.parse(options.body);seen.push(q);
    const n=Number(BigInt(q.params[0]));assert.ok(n<=10);
    return {result:{number:hex(n),timestamp:hex(100+2*n)}};
  });
  for(const [time,expected] of [[0,0],[99,0],[100,0],[101,1],[110,5],[111,6],[120,10],[121,11]]) assert.equal(await reader.firstBlockAt(time,10),expected);
  assert.equal(new Set(seen.map(q=>q.params[0])).size,seen.length,'block cache prevents repeat lookups');
});
test('log scanning stays within 20,000 blocks and includes both boundary blocks without duplicates',async()=>{
  const ranges=[];
  const reader=createBaseReader(async(url,options)=>{
    const q=JSON.parse(options.body),f=q.params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));ranges.push([from,to]);
    return {result:[log(to),log(from),log(from)]};
  });
  const logs=await reader.eventLogs('game',['topic'],7,40007);
  assert.deepEqual(ranges,[[7,20006],[20007,40006],[40007,40007]]);
  assert.deepEqual(logs.map(l=>Number(BigInt(l.blockNumber))),[7,20006,20007,40006,40007]);
});
test('oversized ranges split, but missing history and rate limits never become empty data',async()=>{
  const reader=createBaseReader(async(url,options)=>{
    const f=JSON.parse(options.body).params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
    if(to>from) return {error:{message:'response size too large'}};
    return {result:[log(from)]};
  });
  assert.equal((await reader.eventLogs('game',[],1,4)).length,4);
  for(const message of ['block not available','rate-limit exceeded']) {
    let calls=0;const fail=createBaseReader(async()=>{calls++;return {error:{message}};});
    await assert.rejects(fail.eventLogs('game',[],1,4),new RegExp(message));assert.equal(calls,1);
  }
  const invalid=createBaseReader(async()=>({result:[{...log(1),removed:true}]}));
  await assert.rejects(invalid.eventLogs('game',[],1,4),/Invalid historical/);
});
