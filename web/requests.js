export const REQUEST_PACES = {
  normal: {'base.blockscout.com':1500,'mainnet.base.org':300,'Chainnodes':250,'api.pet.game':150,'www.frenpet.xyz':300},
  slow: {'base.blockscout.com':5000,'mainnet.base.org':1200,'Chainnodes':1000,'api.pet.game':500,'www.frenpet.xyz':1500}
};
export function pause(ms, signal) {
  return new Promise((resolve,reject)=>{
    if (signal?.aborted) { reject(new Error('Cancelled.')); return; }
    const timer = setTimeout(done,ms);
    function done() { signal?.removeEventListener('abort',abort); resolve(); }
    function abort() { clearTimeout(timer); reject(new Error('Cancelled.')); }
    signal?.addEventListener('abort',abort,{once:true});
  });
}
export function retryDelay(header, attempt, now = Date.now()) {
  const seconds = header === null ? NaN : Number(header);
  const date = Date.parse(header || '');
  const requested = Number.isFinite(seconds) ? seconds*1000 : Number.isFinite(date) ? date-now : 0;
  return Math.max(1000,requested,Math.min(120000,10000*2**attempt));
}
const rateMessage = data => {
  const errors = [data?.error?.message,...(Array.isArray(data?.errors) ? data.errors.map(e=>e.message) : [])];
  if (data?.status === '0') errors.push(data.message,typeof data.result === 'string' ? data.result : '');
  if (Array.isArray(data)) errors.push(...data.map(e=>e.error?.message));
  return errors.filter(Boolean).join(' ');
};
export function createRequestClient({fetchImpl=(...args)=>fetch(...args),now=()=>Date.now(),wait=pause}={}) {
  let mode = 'slow', onWait = ()=>{};
  const next = new Map(), cooldown = new Map();
  return {
    configure(options={}) {
      if (options.mode && !REQUEST_PACES[options.mode]) throw new Error('Invalid request speed.');
      mode = options.mode || mode; onWait = options.onWait || (()=>{});
    },
    async json(url,options={},signal) {
      const host = url==='/api/base-rpc' ? 'Chainnodes' : new URL(url).hostname;
      for (let attempt=0;attempt<6;attempt++) {
        if (signal?.aborted) throw new Error('Cancelled.');
        const at = Math.max(now(),next.get(host) || 0,cooldown.get(host) || 0), delay = at-now();
        next.set(host,at+(REQUEST_PACES[mode][host] || 0));
        if (delay>0) {
          if (delay>=1500) onWait(`Waiting ${Math.ceil(delay/1000)}s for ${host}${attempt ? ' after a rate limit' : ' ('+mode+' mode)'}… Cancel remains available.`);
          await wait(delay,signal);
        }
        while (now() < (cooldown.get(host) || 0)) {
          const resumed = Math.max(next.get(host)||0,cooldown.get(host));
          next.set(host,resumed+(REQUEST_PACES[mode][host] || 0));
          await wait(resumed-now(),signal);
        }
        // Read the public quest endpoint through the same-origin browser relay.
        const target = typeof location !== 'undefined' && /^https:\/\/www\.frenpet\.xyz\/api\/quests\/(?:0|[1-9]\d{0,14})$/.test(url) ? '/api/frenpet/quests/'+url.split('/').pop() : url;
        let response, data;
        try {
          response = await fetchImpl(target,{...options,signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)});
          const content=await response.text();
          try{data=JSON.parse(content);}catch{if(response.ok) throw new Error(`Invalid JSON from ${host}`);}
        } catch(error) {
          if (signal?.aborted) throw new Error('Cancelled.');
          if (attempt===5) throw error;
          next.set(host,Math.max(next.get(host)||0,now()+retryDelay(null,attempt,now())));
          onWait(`Connection failed for ${host}; retrying more slowly (${attempt+1}/5)…`);
          continue;
        }
        const message = rateMessage(data);
        const limited = response.status===429 || response.status===503 || /rate.?limit|too many requests|request limit|limit reached/i.test(message);
        if (limited) {
          if (attempt===5) throw new Error(`${host} is still rate-limiting after 5 retries. Completed fields are retained; try again later.`);
          const delay = retryDelay(response.headers.get('Retry-After'),attempt,now());
          cooldown.set(host,now()+delay);
          next.set(host,Math.max(next.get(host)||0,now()+delay));
          onWait(`${host} requested a pause; retrying in at least ${Math.ceil(delay/1000)}s (${attempt+1}/5)…`);
          continue;
        }
        if (!response.ok) throw new Error(typeof data?.error==='string' ? data.error : message || `HTTP ${response.status} from ${host}`);
        return data;
      }
    }
  };
}
