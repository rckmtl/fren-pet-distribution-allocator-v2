// The browser only knows this local route, never the provider's keyed URL.
export const BASE_RPC = '/api/base-rpc';
export const BASE_SOURCE = 'https://www.chainnodes.org/docs/base';
export const MAX_LOG_BLOCKS = 20000;
const quantity = value => '0x' + BigInt(value).toString(16);
const integer = value => {
  if (!/^0x[0-9a-f]+$/i.test(value || '')) throw new Error('Invalid Base block response.');
  const n=Number(BigInt(value));
  if(!Number.isSafeInteger(n)) throw new Error('Invalid Base block number.');
  return n;
};
export function createBaseReader(request) {
  const blocks = new Map();
  async function rpc(method,params,signal) {
    const data=await request(BASE_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},signal);
    if(data?.error || data?.result === undefined) throw new Error(data?.error?.message || data?.error || 'Missing Base RPC response.');
    return data.result;
  }
  async function block(number,signal) {
    if(!blocks.has(number)) {
      const data=await rpc('eth_getBlockByNumber',[quantity(number),false],signal);
      if (!data || integer(data.number)!==number) throw new Error('Missing historical Base block.');
      blocks.set(number,{number,timestamp:integer(data.timestamp)});
    }
    return blocks.get(number);
  }
  // Lower bound: first block at/after the inclusive start or exclusive end.
  // This excludes the block immediately before midnight without per-log requests.
  async function firstBlockAt(timestamp,head,signal) {
    if(timestamp<=0) return 0;
    const latest=await block(head,signal);
    if(timestamp>latest.timestamp) return head+1;
    // Start near the requested date so recent ranges do not need ancient blocks.
    // The cadence is only an estimate; actual neighboring timestamps verify it.
    if(head>0) {
      const previous=await block(head-1,signal),cadence=latest.timestamp-previous.timestamp;
      if(cadence>0) {
        const guess=Math.max(0,head-Math.floor((latest.timestamp-timestamp)/cadence));
        const found=await block(guess,signal);
        if(found.timestamp>=timestamp && (guess===0 || (await block(guess-1,signal)).timestamp<timestamp)) return guess;
        if(found.timestamp<timestamp && guess<head && (await block(guess+1,signal)).timestamp>=timestamp) return guess+1;
      }
    }
    let low=0,high=head+1;
    while(low<high) {
      const mid=low+Math.floor((high-low)/2);
      if((await block(mid,signal)).timestamp<timestamp) low=mid+1;
      else high=mid;
    }
    return low;
  }
  async function eventLogs(address,topics,fromBlock,toBlock,signal,onProgress=()=>{}) {
    const records=[],seen=new Set();
    async function range(from,to) {
      if(signal?.aborted) throw new Error('Cancelled.');
      let logs;
      try { logs=await rpc('eth_getLogs',[{address,topics,fromBlock:quantity(from),toBlock:quantity(to)}],signal); }
      catch(error) {
        if(from===to || /rate.?limit|quota|monthly|per second|too many requests/i.test(error.message) || !/too (?:large|many)|response size|block range|timeout|timed out|query returned|limit exceeded/i.test(error.message)) throw error;
        const mid=Math.floor((from+to)/2);await range(from,mid);await range(mid+1,to);return;
      }
      if(!Array.isArray(logs)) throw new Error('Historical event query returned no records.');
      for(const log of logs) {
        if(!/^0x[0-9a-f]{64}$/i.test(log.transactionHash || '') || log.removed || integer(log.blockNumber)<from || integer(log.blockNumber)>to || !/^0x[0-9a-f]+$/i.test(log.logIndex || '')) throw new Error('Invalid historical event record.');
        const key=log.transactionHash.toLowerCase()+':'+integer(log.logIndex);
        if(!seen.has(key)){seen.add(key);records.push(log);}
      }
    }
    for(let from=fromBlock;from<=toBlock;from+=MAX_LOG_BLOCKS) {
      const to=Math.min(toBlock,from+MAX_LOG_BLOCKS-1);
      await range(from,to);
      onProgress(`${records.length.toLocaleString()} event records · ${Math.round((to-fromBlock+1)/(toBlock-fromBlock+1)*100)}% of block range checked…`);
    }
    return records.sort((a,b)=>integer(a.blockNumber)-integer(b.blockNumber)||integer(a.transactionIndex)-integer(b.transactionIndex)||integer(a.logIndex)-integer(b.logIndex));
  }
  return {rpc,block,firstBlockAt,eventLogs};
}
