import test from 'node:test';
import assert from 'node:assert/strict';
import {relay,relayBase} from '../relay.js';
test('quest relay only requests a numeric pet ID and returns ep without quest rewards',async()=>{
  const response=await relay('/api/frenpet/quests/8159',{fetchImpl:async(url,options)=>{
    assert.equal(url,'https://www.frenpet.xyz/api/quests/8159');
    assert.equal(options.cache,'no-store'); assert.equal(options.headers,undefined);
    return Response.json({ep:38200,quests:[{xpReward:999999}]});
  }});
  assert.equal(response.status,200); assert.equal((await response.json()).ep,38200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  for (const path of ['/api/frenpet/quests/8159?url=https://example.com','/api/frenpet/quests/../1','/api/frenpet/quests/-1','/api/analytica/owner/0x'+'1'.repeat(40)])
    assert.equal(await relay(path,{fetchImpl:()=>{throw new Error('Must not fetch');}}),null);
});

const rpcUrl='https://base-mainnet.chainnodes.org/TEST_SECRET';
const request=(method='eth_chainId',params=[])=>new Request('https://report.test/api/base-rpc',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('Base relay keeps the key server-side and only forwards approved reads',async()=>{
  const good=await relayBase(request(),{rpcUrl,fetchImpl:async(url,options)=>{
    assert.equal(url,rpcUrl);assert.equal(options.redirect,'manual');assert.deepEqual(options.headers,{'Content-Type':'application/json','Accept':'application/json','User-Agent':'FrenPetAllocator/1.0'});
    return Response.json({jsonrpc:'2.0',id:1,result:'0x2105'});
  }});
  assert.equal(good.status,200);assert.equal((await good.json()).result,'0x2105');
  const deny=async()=>{throw Error('Should not send this request upstream');};
  for(const q of [request('eth_sendRawTransaction',['0x1234']),request('debug_traceTransaction',['0x'+'1'.repeat(64),{tracer:'callTracer'}]),request('debug_traceTransaction',['0x'+'1'.repeat(64),{tracer:'arbitrary code'}]),request('eth_getLogs',[{address:'0x'+'1'.repeat(40),fromBlock:'0x0',toBlock:'0x1'}]),request('eth_getLogs',[{address:'0x0e22b5f3e11944578b37ed04f5312dfc246f443c',fromBlock:'0x0',toBlock:'0x10000'}])]) assert.equal((await relayBase(q,{rpcUrl,fetchImpl:deny})).status,400);
  assert.equal((await relayBase(request(),{rpcUrl:'https://evil.test/key',fetchImpl:deny})).status,503);
  const redirect=await relayBase(request(),{rpcUrl,fetchImpl:async()=>new Response('',{status:302,headers:{Location:'https://other.example/'}})});
  assert.equal(redirect.status,502,'redirects must never forward the private request to another destination');
});
test('Base relay preserves Chainnodes cooldown and removes secrets from error messages',async()=>{
  const response=await relayBase(request(),{rpcUrl,fetchImpl:async()=>Response.json({jsonrpc:'2.0',id:1,error:{code:429,message:'rate-limit exceeded at '+rpcUrl,data:{backoff_seconds:175}}},{status:429,headers:{'Retry-After':'10'}})});
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'175');
  assert.ok(!(await response.text()).includes('TEST_SECRET'));
  const failure=await relayBase(request(),{rpcUrl,fetchImpl:async()=>{throw Error(rpcUrl);}});
  assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes('TEST_SECRET'));
});
test('quest relay preserves throttling headers and rejects a missing ep total',async()=>{
  const limited=await relay('/api/frenpet/quests/8159',{fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'90'}})});
  assert.equal(limited.status,429); assert.equal(limited.headers.get('Retry-After'),'90');
  for (const ep of [null,-1,1.2,true,9007199254740992]) {
    const invalid=await relay('/api/frenpet/quests/8159',{fetchImpl:async()=>Response.json({ep})});
    assert.equal(invalid.status,502);
  }
});
