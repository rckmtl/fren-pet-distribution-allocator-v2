const MAX_BYTES = 25000000;
async function transform(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = []; let total = 0;
  try {
    while(true) {
      const {value,done} = await reader.read(); if(done) break;
      total += value.length; if(total > MAX_BYTES) throw new Error('Seed exceeds the 25 MB limit.'); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(total); let at = 0; for(const chunk of chunks){result.set(chunk,at);at += chunk.length;} return result;
}
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
function base64url(bytes) { let s = ''; for(let i=0;i<bytes.length;i+=8192) s += String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
export async function createSeed(saved) {
  const bytes = new TextEncoder().encode(JSON.stringify({seedVersion:1,...saved}));
  if(bytes.length > MAX_BYTES) throw new Error('Snapshot is too large for a seed.');
  const digest = await hash(bytes), zipped = await transform(bytes,new CompressionStream('gzip'));
  return {text:`fpalloc1.${digest}.${base64url(zipped)}`,digest};
}
export async function readSeed(seed) {
  const text = String(seed).trim();
  if(text.length > 4000000) throw new Error('Seed exceeds the encoded size limit.');
  const parts = /^fpalloc1\.([0-9a-f]{64})\.([A-Za-z0-9_-]+)$/.exec(text);
  if(!parts) throw new Error('Invalid verification seed.');
  let decoded;
  try { decoded = Uint8Array.from(atob(parts[2].replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
  catch { throw new Error('Invalid seed encoding.'); }
  let bytes;
  try { bytes = await transform(decoded,new DecompressionStream('gzip')); }
  catch { throw new Error('Seed is damaged or exceeds the size limit.'); }
  if(await hash(bytes) !== parts[1]) throw new Error('Seed checksum does not match. The seed was changed or damaged.');
  const saved = JSON.parse(new TextDecoder().decode(bytes));
  if(saved.seedVersion !== 1) throw new Error('Unsupported seed version.');
  return {saved,digest:parts[1]};
}
