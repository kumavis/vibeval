import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { build, root } from './build.mjs';

await build();
const directory = resolve(root, 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = resolve(directory, '.' + decodeURIComponent(url.pathname));
    if (path !== directory && !path.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }).end(); return; }
      path = resolve(path, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', function () {
  console.log(`Vibeval: http://127.0.0.1:${this.address().port}`);
});
