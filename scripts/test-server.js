import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests/server'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
