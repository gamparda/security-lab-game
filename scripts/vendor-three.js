import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const files = ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'examples/jsm/controls/PointerLockControls.js', 'LICENSE'];
for (const file of files) {
  const destination = resolve('vendor/three', file);
  await mkdir(resolve(destination, '..'), { recursive: true });
  if (file.endsWith('.js')) {
    let source = await readFile(resolve('node_modules/three', file), 'utf8');
    if (file.startsWith('examples/')) source = source.replaceAll("from 'three'", "from '../../../build/three.module.js'");
    await writeFile(destination, source);
  } else await copyFile(resolve('node_modules/three', file), destination);
}
await writeFile('vendor/three/README.md', 'Three.js 0.186.1, MIT. Vendored from the exact npm dependency with scripts/vendor-three.js. Only bare three imports are changed to local relative imports. No CDN or runtime npm required.\n');
