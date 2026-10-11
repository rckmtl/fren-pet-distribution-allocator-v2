import {readFile,writeFile,mkdir} from 'node:fs/promises';
// Portable adaptation of the dependency-free Sites Worker ESM starter.
const assets = {};
for(const [name,type] of Object.entries({'index.html':'text/html','styles.css':'text/css','app.js':'text/javascript','core.js':'text/javascript','api.js':'text/javascript','seed.js':'text/javascript','explorer.js':'text/javascript','requests.js':'text/javascript','chain.js':'text/javascript','frozen.json':'application/json'})) assets['/'+name] = {type,body:await readFile(new URL('./web/'+name,import.meta.url),'utf8')};
const relay = (await readFile(new URL('./relay.js',import.meta.url),'utf8')).replaceAll('export async function','async function');
const source = `${relay}\nconst assets = ${JSON.stringify(assets)};\nexport default {async fetch(request,env={}){
  const path=new URL(request.url).pathname;
  if(path==='/api/base-rpc') return relayBase(request,{rpcUrl:env.BASE_RPC_URL});
  if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
  if(path.startsWith('/api/')) return await relay(path) || new Response('Not found',{status:404});
  const asset=assets[path==='/'?'/index.html':path];
  if(!asset) return new Response('Not found',{status:404});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
}};`;
await mkdir(new URL('./dist/server/',import.meta.url),{recursive:true});
await mkdir(new URL('./dist/.openai/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/server/index.js',import.meta.url),source);
await writeFile(new URL('./dist/.openai/hosting.json',import.meta.url),await readFile(new URL('./.openai/hosting.json',import.meta.url)));
const {default:worker} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
for(const path of ['/', '/app.js','/core.js','/api.js','/styles.css','/seed.js','/explorer.js','/requests.js','/chain.js','/frozen.json']) {
  const response = await worker.fetch(new Request('https://test.invalid'+path));
  if(response.status!==200 || !(await response.text()).length) throw new Error('Invalid build: '+path);
}
if((await worker.fetch(new Request('https://test.invalid/api/frenpet/quests/not-a-pet-id'))).status!==404) throw new Error('Relay must reject invalid pet IDs.');
if((await worker.fetch(new Request('https://test.invalid/api/base-rpc',{method:'POST',body:'{}'}))).status!==503) throw new Error('Missing RPC configuration must not fall through to a public provider.');
console.log('Built and validated dependency-free Worker with ten embedded assets.');
