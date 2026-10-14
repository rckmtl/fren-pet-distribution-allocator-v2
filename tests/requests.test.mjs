import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestClient,retryDelay,pause} from '../web/requests.js';
const url='https://base.blockscout.com/api?module=logs';
test('slow mode spaces successful calls and respects Retry-After longer than local backoff',async()=>{
  let clock=0, calls=0; const times=[], messages=[];
  const client=createRequestClient({now:()=>clock,wait:async ms=>{clock+=ms;},fetchImpl:async()=>{
    times.push(clock); return ++calls===2 ? new Response('',{status:429,headers:{'Retry-After':'180'}}) : Response.json({status:'1',result:[]});
  }});
  client.configure({mode:'slow',onWait:s=>messages.push(s)});
  await client.json(url); await client.json(url);
  assert.deepEqual(times,[0,5000,185000]); assert.ok(messages.some(s=>s.includes('180s')));
});
test('HTTP-200 rate-limit payloads are retried, while non-rate API errors are returned',async()=>{
  let clock=0, calls=0;
  const client=createRequestClient({now:()=>clock,wait:async ms=>{clock+=ms;},fetchImpl:async()=>Response.json(++calls===1 ? {status:'0',message:'NOTOK',result:'Max rate limit reached'} : {status:'0',message:'No logs found',result:[]})});
  assert.deepEqual(await client.json(url),{status:'0',message:'No logs found',result:[]});
  assert.equal(calls,2); assert.equal(clock,10000);
});
test('persistent throttling is bounded and cancellation interrupts a long wait',async()=>{
  let clock=0,calls=0;
  const client=createRequestClient({now:()=>clock,wait:async ms=>{clock+=ms;},fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(client.json(url),/after 5 retries/); assert.equal(calls,6);
  const controller=new AbortController(), waiting=pause(120000,controller.signal);
  controller.abort(); await assert.rejects(waiting,/Cancelled/);
  await assert.rejects(pause(1,controller.signal),/Cancelled/);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:03:00 GMT',0,0),180000);
});

test('private Chainnodes relay uses provider pacing and respects its server cooldown',async()=>{
  let clock=0,calls=0;const times=[];
  const client=createRequestClient({now:()=>clock,wait:async ms=>clock+=ms,fetchImpl:async url=>{
    assert.equal(url,'/api/base-rpc');times.push(clock);
    return ++calls===2 ? Response.json({error:{message:'rate-limit exceeded'}},{status:429,headers:{'Retry-After':'175'}}) : Response.json({result:'0x2105'});
  }});
  await client.json('/api/base-rpc');await client.json('/api/base-rpc');
  assert.deepEqual(times,[0,1000,176000]);
});
