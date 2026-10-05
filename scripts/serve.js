import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const realRoot = await realpath(root);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
const requiredFiles = [
  'index.html', 'src/bootstrap.js', 'src/app.js', 'src/engine.js',
  'src/missions.js', 'src/storage.js', 'src/loading.css', 'src/style.css',
  'src/labbridge.js', 'src/scene-entry.js',
];
const optionalFiles = [
  'assets/credits.txt',
  'src/collision.js', 'src/player3d.js', 'src/interaction3d.js',
  'src/scene3d.js', 'src/batch3d.js', 'src/scene3d.css',
  'src/city3d.js', 'src/visibility3d.js', 'src/upscale3d.js',
  'assets/environment/city-sunset.png',
  'assets/models/security_lab.glb',
  'vendor/three/build/three.module.js', 'vendor/three/build/three.core.js',
  'vendor/three/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/three/examples/jsm/utils/SkeletonUtils.js',
  'vendor/three/examples/jsm/controls/PointerLockControls.js',
  'vendor/three/examples/jsm/libs/meshopt_decoder.module.js',
  'vendor/three/examples/jsm/environments/RoomEnvironment.js',
];
const publicFiles = new Set([...requiredFiles, ...optionalFiles]);
const assets = new Map();
const optionalAssetWarnings = new Map();

async function readAsset(name) {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error('Not inside game directory');
  const actualPath = await realpath(path);
  if (!actualPath.startsWith(realRoot + sep) || !(await stat(actualPath)).isFile()) {
    throw new Error('Not a regular bundled file inside the game directory');
  }
  const body = await readFile(actualPath);
  if (!body.length) throw new Error('Bundled file is empty');
  return body;
}

// Validate the 2D entry before listening; optional 3D failures stay recoverable.
for (const name of requiredFiles) {
  try {
    assets.set(name, await readAsset(name));
  } catch (error) {
    throw new Error(name + ': required bundled file unreadable (' + error.message + ')');
  }
}
for (const name of optionalFiles) {
  try {
    assets.set(name, await readAsset(name));
  } catch (error) {
    optionalAssetWarnings.set(name, error.message);
    console.warn('Optional 3D asset warning: ' + name + ': ' + error.message);
  }
}

const html = assets.get('index.html').toString('utf8').replaceAll('\r\n', '\n');
const guard = html.match(/<script id="startup-guard">([\s\S]*?)<\/script>/)?.[1];
if (guard === undefined) throw new Error('index.html: startup guard missing');
const startupHash = createHash('sha256').update(guard).digest('base64');
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const headers = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-" + startupHash + "'; style-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'X-Security-Lab-Version': version,
};
const assetDigests = new Map([...assets].map(([name, body]) => [name, createHash('sha256').update(body).digest('hex')]));
const server = createServer((req, res) => {
  function respond(status, body, type = 'text/plain; charset=utf-8', digest) {
    res.writeHead(status, { ...headers, ...(digest ? { 'X-Security-Lab-SHA256': digest } : {}), 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    respond(405, 'Method not allowed');
    return;
  }
  try {
    // Preserve dot segments until the exact allowlist check; URL() normalizes them.
    const pathname = decodeURIComponent(req.url.split(/[?#]/, 1)[0]);
    let relative = pathname === '/' ? 'index.html' : pathname.startsWith('/') ? pathname.slice(1) : '';
    if (relative.startsWith('__scene__/')) {
      const retry = /^__scene__\/[a-z0-9]{1,16}-[0-9]{1,6}\/(.+)$/.exec(relative);
      if (!retry || !optionalFiles.includes(retry[1])) throw new Error('Not a 3D retry asset');
      relative = retry[1];
    }
    const body = assets.get(relative);
    if (!publicFiles.has(relative) || !body) throw new Error('Not public or unavailable');
    respond(200, body, types[extname(relative)], assetDigests.get(relative));
  } catch {
    respond(404, 'Not found');
  }
});
server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log('Security Lab: http://localhost:' + server.address().port));
// Runtime modules and environment images share the strict Python allowlist.
