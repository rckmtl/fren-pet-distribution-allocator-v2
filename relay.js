// Only the public, read-only quest endpoint is relayed. No user-supplied destination,
// upstream credentials, cookies, or request headers are forwarded.
export async function relay(pathname, {fetchImpl = fetch} = {}) {
  if (!/^\/api\/frenpet\/quests\/(?:0|[1-9]\d{0,14})$/.test(pathname)) return null;
  try {
    const response = await fetchImpl('https://www.frenpet.xyz/api/quests/' + pathname.split('/').pop(), {signal:AbortSignal.timeout(40000),cache:'no-store'});
    if (!response.ok) return Response.json({error:`Fren Pet quests API returned HTTP ${response.status}.`},{status:[429,503].includes(response.status) ? response.status : 502,headers:{'Cache-Control':'no-store',...(response.headers.has('Retry-After') ? {'Retry-After':response.headers.get('Retry-After')} : {})}});
    const data = await response.json();
    const valid = !data?.error && data?.success !== false &&
      ((typeof data?.ep === 'number' && Number.isSafeInteger(data.ep) && data.ep >= 0) || (typeof data?.ep === 'string' && /^\d+$/.test(data.ep)));
    if (!valid) return Response.json({error:'Fren Pet quests API returned no valid ep count.'},{status:502,headers:{'Cache-Control':'no-store'}});
    // ep is the current Explorer Points total; quest xpReward values are not totals.
    return Response.json({ep:data.ep,fetchedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Fren Pet quests request failed. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
}

const READ_CONTRACTS=new Set(['0x0e22b5f3e11944578b37ed04f5312dfc246f443c','0x5b51cf49cb48617084ef35e7c7d7a21914769ff1','0xca11bde05977b3631167028862be2a173976ca11']);
const LOG_CONTRACTS=new Set(['0x0e22b5f3e11944578b37ed04f5312dfc246f443c','0xd63b06d0a14a656731d338eb01c31dc9716c1d64']);
const hexQuantity=v=>typeof v==='string' && /^0x[0-9a-f]{1,16}$/i.test(v);
const blockTag=v=>hexQuantity(v)||['latest','earliest','safe','finalized'].includes(v);
const hash=v=>typeof v==='string' && /^0x[0-9a-f]{64}$/i.test(v);
function validRead(body) {
  if(!body || Array.isArray(body) || body.jsonrpc!=='2.0' || !(Number.isSafeInteger(body.id)||typeof body.id==='string'&&body.id.length<80) || !Array.isArray(body.params)) return false;
  const p=body.params;
  switch(body.method) {
    case 'eth_chainId': case 'eth_blockNumber': return p.length===0;
    case 'eth_getBlockByNumber': return p.length===2 && blockTag(p[0]) && p[1]===false;
    case 'eth_call': return p.length===2 && p[0] && Object.keys(p[0]).every(k=>['to','data'].includes(k)) && READ_CONTRACTS.has(p[0].to?.toLowerCase()) && typeof p[0].data==='string' && /^0x(?:[a-f0-9]{2}){4,65536}$/i.test(p[0].data) && blockTag(p[1]);
    case 'eth_getLogs': {
      const f=p[0];
      return p.length===1 && f && Object.keys(f).every(k=>['address','fromBlock','toBlock','topics'].includes(k)) && LOG_CONTRACTS.has(f.address?.toLowerCase()) && hexQuantity(f.fromBlock) && hexQuantity(f.toBlock) && BigInt(f.toBlock)>=BigInt(f.fromBlock) && BigInt(f.toBlock)-BigInt(f.fromBlock)<20000n && (f.topics===undefined || Array.isArray(f.topics) && f.topics.length<=4 && f.topics.every(t=>t===null || hash(t) || Array.isArray(t)&&t.length<=8&&t.every(hash)));
    }
    default: return false;
  }
}

// Owner-private Site boundary protects the key. The relay permits only the reads
// needed by this report, with no destination, key or arbitrary headers from clients.
export async function relayBase(request,{rpcUrl,fetchImpl=fetch}={}) {
  const reply=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
  if(request.method!=='POST') return reply({error:'Use POST for Base reads.'},405);
  if(!/^https:\/\/base-mainnet\.chainnodes\.org\/[a-zA-Z0-9_-]+$/.test(rpcUrl || '')) return reply({error:'Base RPC is not configured. Set the private BASE_RPC_URL server setting.'},503);
  let body;
  try {
    const text=await request.text();
    if(text.length>262144) return reply({error:'RPC request too large.'},413);
    body=JSON.parse(text);
    if(!validRead(body)) return reply({error:'This RPC request is not allowed by the report.'},400);
  }catch{return reply({error:'Invalid RPC request.'},400);}
  const redact=value=>String(value).split(rpcUrl).join('[private endpoint]').split(new URL(rpcUrl).pathname.slice(1)).join('[redacted]').slice(0,500);
  try {
    const upstream=await fetchImpl(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'FrenPetAllocator/1.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000),redirect:'manual'});
    let data;
    try { data=await upstream.json(); }
    catch {return reply({error:`Chainnodes returned HTTP ${upstream.status} without an RPC response.`},[429,503].includes(upstream.status)?upstream.status:502,upstream.headers.has('Retry-After')?{'Retry-After':upstream.headers.get('Retry-After')}:{ });}
    const retrySeconds=Number(data?.error?.data?.backoff_seconds);
    const retryHeaders={};
    if(upstream.headers.has('Retry-After')) retryHeaders['Retry-After']=upstream.headers.get('Retry-After');
    if(Number.isFinite(retrySeconds)&&retrySeconds>0) {
      const headerSeconds=Number(retryHeaders['Retry-After']) || Math.max(0,(Date.parse(retryHeaders['Retry-After'])-Date.now())/1000) || 0;
      retryHeaders['Retry-After']=String(Math.ceil(Math.max(retrySeconds,headerSeconds)));
    }
    if(data?.error) {
      const message=redact(data.error.message || 'Base RPC request failed.');
      const limited=upstream.status===429 || data.error.code===429 || /rate.?limit|too many requests|per second.*limit/i.test(message);
      return reply({jsonrpc:'2.0',id:body.id,error:{code:data.error.code,message}},limited?429:upstream.ok?200:upstream.status===503?503:502,retryHeaders);
    }
    if(!upstream.ok || data?.jsonrpc!=='2.0' || data.id!==body.id || data.result===undefined) return reply({error:'Base RPC returned an invalid response.'},upstream.status===429?429:upstream.status===503?503:502,retryHeaders);
    return reply({jsonrpc:'2.0',id:body.id,result:data.result});
  }catch(error){return reply({error:'Base RPC connection failed: '+redact(error.message || 'unknown network error')},502);}
}
