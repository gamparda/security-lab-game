import { initialState, runCommand } from './engine.js';
import { MISSIONS, ORIGINAL_FILES } from './missions.js';

export const SAVE_KEY = 'security-lab-game:v1';
export const CURRENT_SAVE_KEY = 'security-lab-game:v2';
export const BACKUP_KEY = 'security-lab-game:backup';
const CLUES = [['help', 'approval'], ['scan', 'port-443', 'port-8080', 'rescan'], ['login'], ['baseline', 'hash', 'mismatch']];
function loadObservations(raw, index, state) {
  const changed = index === 1 ? !state.ports[443] || !state.ports[8080]
    : index === 2 ? state.login.minLength !== 6 || state.login.blockCommon || state.login.limitAttempts
    : index === 3 ? state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'] : false;
  function snapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (index === 1 && [443, 8080].every(port => typeof value[port] === 'boolean')) return { 443: value[443], 8080: value[8080] };
    if (index === 2 && [6, 12, 15].includes(value.minLength) && typeof value.blockCommon === 'boolean' && typeof value.limitAttempts === 'boolean') return { minLength: value.minLength, blockCommon: value.blockCommon, limitAttempts: value.limitAttempts };
    if (index === 3 && Object.keys(ORIGINAL_FILES).every(name => typeof value.matches?.[name] === 'boolean')) return { matches: Object.fromEntries(Object.keys(ORIGINAL_FILES).map(name => [name, value.matches[name]])) };
    return null;
  }
  const modified = changed || raw?.changed === true;
  return { changed: modified, before: snapshot(raw?.before), after: modified ? snapshot(raw?.after) : null };
}
export function encodeGame(state) {
  return {
    version: 1, active: state.active, ports: state.ports, login: state.login,
    restored: state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'],
    hashComputed: state.missions[3].hashes.length === 3 || state.missions[3].hashPending,
    missions: state.missions.map(({ clues, answer, hint, verified, selectedFile, observations }) => ({ clues, answer, hint, verified, selectedFile, observations })),
  };
}
export function saveGame(state, storage) {
  storage.setItem(SAVE_KEY, JSON.stringify(encodeGame(state)));
}
export async function loadGame(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return { state: initialState(), recovered: false };
  return decodeGame(raw);
}
export async function decodeGame(raw) {
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Number.isInteger(data.active) || data.active < 0 || data.active > 3 || !Array.isArray(data.missions) || data.missions.length !== 4) throw new Error('Invalid save');
    if ([443, 8080].some(port => typeof data.ports?.[port] !== 'boolean') || ![6, 12, 15].includes(data.login?.minLength) || typeof data.login?.blockCommon !== 'boolean' || typeof data.login?.limitAttempts !== 'boolean' || typeof data.restored !== 'boolean' || typeof data.hashComputed !== 'boolean') throw new Error('Invalid policy');
    const state = initialState();
    state.active = data.active;
    state.ports = { 443: data.ports[443], 8080: data.ports[8080] };
    state.login = { minLength: data.login.minLength, blockCommon: data.login.blockCommon, limitAttempts: data.login.limitAttempts };
    if (data.restored) state.files['budget.csv'] = ORIGINAL_FILES['budget.csv'];
    data.missions.forEach((p, i) => {
      if (!Array.isArray(p.clues) || p.clues.length > CLUES[i].length || p.clues.some(key => !CLUES[i].includes(key)) || new Set(p.clues).size !== p.clues.length || !(p.answer === null || Number.isInteger(p.answer) && p.answer >= 0 && p.answer < MISSIONS[i].answers.length) || !Number.isInteger(p.hint) || p.hint < 0 || p.hint > 3 || typeof p.verified !== 'boolean' || !(p.selectedFile === null || i === 3 && Object.hasOwn(ORIGINAL_FILES, p.selectedFile))) throw new Error('Invalid progress');
      if (i < state.active && !p.verified || i > state.active && (p.verified || p.clues.length || p.answer !== null || p.hint || p.selectedFile !== null)) throw new Error('Invalid order');
      state.missions[i] = { ...state.missions[i], clues: [...p.clues], answer: p.answer, hint: p.hint, verified: p.verified, selectedFile: p.selectedFile, observations: loadObservations(p.observations, i, state) };
    });
    // 완료 플래그를 신뢰하지 않고 저장된 정책과 단서로 다시 판정한다.
    const active = state.active;
    let hashRetryNeeded = false;
    if (data.hashComputed) {
      if (active !== 3 || !state.missions[3].clues.includes('hash')) throw new Error('Invalid hash progress');
      state.active = 3;
      try {
        await runCommand(state, 'hash files');
      } catch {
        // 연산 실패는 저장 손상이 아니다. 다음 복원에서도 재계산을 시도한다.
        state.missions[3].hashPending = true;
        state.missions[3].verified = false;
        hashRetryNeeded = true;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (!data.missions[i].verified) continue;
      state.active = i;
      state.missions[i].verified = false;
      await runCommand(state, 'verify');
      if (i === 3 && hashRetryNeeded) continue;
      if (!state.missions[i].verified) throw new Error('Invalid completion');
    }
    state.active = active;
    return { state, recovered: false, hashRetryNeeded };
  } catch {
    return { state: initialState(), recovered: true };
  }
}

function saveError(code, message) {
  return Object.assign(new Error(message), { code });
}

// The browser app writes only v2. saveGame/loadGame retain the v1 codec for migration.
export async function createSaveSession(storage, locks = globalThis.navigator?.locks) {
  let expected = storage.getItem(CURRENT_SAVE_KEY);
  const legacy = storage.getItem(SAVE_KEY);
  let revision = 0, loaded;
  try {
    if (expected !== null) {
      const envelope = JSON.parse(expected);
      if (envelope.version !== 2 || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) throw new Error('Unknown save');
      revision = envelope.revision;
      loaded = await decodeGame(JSON.stringify(envelope.game));
    } else loaded = legacy === null ? { state: initialState(), recovered: false } : await decodeGame(legacy);
  } catch { loaded = { state: initialState(), recovered: true }; }
  let blocked = loaded.recovered ? 'preserved' : !locks?.request ? 'unavailable' : null;
  let queue = Promise.resolve();
  const session = {
    ...loaded,
    get blocked() { return blocked; },
    changed() {
      if (storage.getItem(CURRENT_SAVE_KEY) !== expected || expected === null && storage.getItem(SAVE_KEY) !== legacy) blocked = 'conflict';
      return blocked === 'conflict';
    },
    save(state, { backup = false } = {}) {
      const game = structuredClone(encodeGame(state));
      const result = queue.then(async () => {
        if (blocked) throw saveError(blocked, 'Automatic save blocked');
        return locks.request(CURRENT_SAVE_KEY, () => {
          if (session.changed()) throw saveError('conflict', 'Save changed in another tab');
          if (revision >= Number.MAX_SAFE_INTEGER) throw saveError('preserved', 'Save revision limit');
          // No writes to the original v1 key. Back up before migrating or importing.
          if (backup || expected === null && legacy !== null) storage.setItem(BACKUP_KEY, expected ?? legacy);
          const raw = JSON.stringify({ version: 2, revision: revision + 1, game });
          storage.setItem(CURRENT_SAVE_KEY, raw);
          expected = raw;
          revision++;
        });
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  return session;
}

export function exportGame(state) {
  return JSON.stringify({ format: 'security-lab-progress', version: 1, game: encodeGame(state) }, null, 2);
}
