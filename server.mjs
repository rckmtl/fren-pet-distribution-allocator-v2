import http from 'node:http';
import { readFile } from 'node:fs/promises';
import {relay,relayBase} from './relay.js';
// Local-only .env is ignored by Git and is never served as an asset.
try { process.loadEnvFile(new URL('./.env',import.meta.url)); } catch(error) { if(error.code!=='ENOENT') throw error; }
const root = new URL('./web/', import.meta.url);
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', csv: 'text/csv', json:'application/json' };
http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if(pathname==='/api/base-rpc') {
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
      const request=new Request('http://localhost/api/base-rpc',{method:req.method,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const upstream=await relayBase(request,{rpcUrl:process.env.BASE_RPC_URL});
      res.writeHead(upstream.status,Object.fromEntries(upstream.headers));res.end(await upstream.text());return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
    if (pathname.startsWith('/api/') && req.method === 'GET') {
      const upstream = await relay(pathname);
      if (!upstream) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(await upstream.text()); return;
    }
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error('Invalid path');
    const content = await readFile(new URL(name, root));
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4174, '127.0.0.1', () => process.stdout.write('Local: http://127.0.0.1:4174\n'));
