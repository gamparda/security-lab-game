import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.186.1';
const files = [
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/controls/PointerLockControls.js',
  'LICENSE',
];
const check = process.argv.includes('--check');
const normalize = (source) => source.replace(/\r\n?/g, '\n');

async function readJson(name) {
  return JSON.parse(await readFile(resolve(root, name), 'utf8'));
}

async function main() {
  if (process.argv.slice(2).some((argument) => argument !== '--check')) {
    throw new Error('Usage: node scripts/vendor-three.js [--check]');
  }
  const manifest = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const installed = await readJson('node_modules/three/package.json');
  const pins = [
    ['package.json', manifest.devDependencies?.three],
    ['package-lock.json root', lock.packages?.['']?.devDependencies?.three],
    ['package-lock.json node_modules/three', lock.packages?.['node_modules/three']?.version],
    ['installed Three.js', installed.version],
  ];
  for (const [name, pin] of pins) {
    if (pin !== version) {
      throw new Error(`${name} must pin Three.js exactly to ${version}; found ${JSON.stringify(pin)}. Run npm ci after restoring the pin.`);
    }
  }
  if (installed.name !== 'three') throw new Error('node_modules/three is not the Three.js package.');

  const outputs = new Map();
  for (const name of files) {
    let source = normalize(await readFile(resolve(root, 'node_modules/three', name), 'utf8'));
    if (!source) throw new Error(`Installed Three.js file is empty: ${name}`);
    if (name.startsWith('examples/')) {
      source = source.replaceAll("from 'three'", "from '../../../build/three.module.js'");
    }
    outputs.set(name, source);
  }
  outputs.set('README.md', `Three.js ${version}, MIT. Vendored from the exact npm dependency with scripts/vendor-three.js. Only bare three imports are changed to local relative imports; text files use LF line endings. No CDN or runtime npm required.\n`);

  const differences = [];
  for (const [name, expected] of outputs) {
    const destination = resolve(root, 'vendor/three', name);
    if (check) {
      let actual;
      try {
        actual = normalize(await readFile(destination, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (actual !== expected) differences.push(`vendor/three/${name}`);
    } else {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, expected, 'utf8');
    }
  }
  if (differences.length) {
    throw new Error(`Vendored Three.js differs from the pinned npm files: ${differences.join(', ')}. Run npm run vendor and review the changes.`);
  }
  console.log(check ? `Verified vendored Three.js ${version}.` : `Vendored Three.js ${version}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
