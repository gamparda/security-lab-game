import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary' };
const publicFiles = new Set(['index.html', 'src/bootstrap.js', 'src/app.js', 'src/engine.js', 'src/missions.js', 'src/storage.js', 'src/loading.css', 'src/style.css','src/labbridge.js','src/collision.js','src/player3d.js','src/interaction3d.js','src/scene3d.js','src/batch3d.js','src/scene3d.css','assets/models/security_lab.glb','vendor/three/build/three.module.js','vendor/three/build/three.core.js','vendor/three/examples/jsm/loaders/GLTFLoader.js','vendor/three/examples/jsm/utils/BufferGeometryUtils.js','vendor/three/examples/jsm/utils/SkeletonUtils.js','vendor/three/examples/jsm/controls/PointerLockControls.js']);
const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replaceAll('\r\n', '\n');
const guard = html.match(/<script id="startup-guard">([\s\S]*?)<\/script>/)[1];
const startupHash = createHash('sha256').update(guard).digest('base64');
const server = createServer(async (req, res) => {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'sha256-" + startupHash + "'; style-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, headers).end('Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep) || !publicFiles.has(relative)) throw new Error('Not public');
    if (!(await realpath(path)).startsWith((await realpath(root)) + sep)) throw new Error('Not inside game directory');
    const body = await readFile(path);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(path)] ?? 'text/plain', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log('Security Lab: http://localhost:' + server.address().port));
