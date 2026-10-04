import { initialState, runCommand } from './engine.js';
import { MISSIONS, ORIGINAL_FILES, MISSION_INDEX, LEGACY_MISSION_IDS } from './missions.js';

export const SAVE_KEY = 'security-lab-game:v1';
export const CURRENT_SAVE_KEY = 'security-lab-game:v2';
export const BACKUP_KEY = 'security-lab-game:backup';
const INTEGRITY = MISSION_INDEX.integrity;
const FILE_COUNT = Object.keys(ORIGINAL_FILES).length;
function loadObservations(raw, index, state) {
  const id = MISSIONS[index].id;
  const changed = id === 'services' ? !state.ports[443] || !state.ports[8080]
    : id === 'login' ? state.login.minLength !== 6 || state.login.blockCommon || state.login.limitAttempts
    : id === 'integrity' ? state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'] : false;
  function snapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (id === 'services' && [443, 8080].every(port => typeof value[port] === 'boolean')) return { 443: value[443], 8080: value[8080] };
    if (id === 'login' && [6, 12, 15].includes(value.minLength) && typeof value.blockCommon === 'boolean' && typeof value.limitAttempts === 'boolean') return { minLength: value.minLength, blockCommon: value.blockCommon, limitAttempts: value.limitAttempts };
    if (id === 'integrity' && Object.keys(ORIGINAL_FILES).every(name => typeof value.matches?.[name] === 'boolean')) return { matches: Object.fromEntries(Object.keys(ORIGINAL_FILES).map(name => [name, value.matches[name]])) };
    return null;
  }
  const modified = changed || raw?.changed === true;
  return { changed: modified, before: snapshot(raw?.before), after: modified ? snapshot(raw?.after) : null };
}
export function encodeGame(state, { legacy = false } = {}) {
  const data = {
    version: 2, active: MISSIONS[state.active].id, ports: state.ports, login: state.login,
    restored: state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'],
    hashComputed: state.missions[INTEGRITY].hashes.length === FILE_COUNT || state.missions[INTEGRITY].hashPending,
    missions: state.missions.map(({ clues, answer, hint, verified, selectedFile, observations }, i) => ({ id: MISSIONS[i].id, clues, answer, hint, verified, selectedFile, observations })),
  };
  if (!legacy) return data;
  return { ...data, version: 1, active: LEGACY_MISSION_IDS.indexOf(data.active), missions: LEGACY_MISSION_IDS.map(id => {
    const { id: _id, ...progress } = data.missions.find(p => p.id === id);
    return progress;
  }) };
}
export function saveGame(state, storage) {
  storage.setItem(SAVE_KEY, JSON.stringify(encodeGame(state, { legacy: true })));
}
export async function loadGame(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return { state: initialState(), recovered: false };
  return decodeGame(raw);
}
function normalizeSave(data) {
  if (!data || !Array.isArray(data.missions)) throw new Error('Invalid save');
  let activeId, rows;
  if (data.version === 1) {
    if (!Number.isInteger(data.active) || data.active < 0 || data.active >= LEGACY_MISSION_IDS.length || data.missions.length !== LEGACY_MISSION_IDS.length) throw new Error('Invalid legacy save');
    activeId = LEGACY_MISSION_IDS[data.active];
    rows = data.missions.map((p, i) => ({ ...p, id: LEGACY_MISSION_IDS[i] }));
  } else if (data.version === 2) { activeId = data.active; rows = data.missions; }
  else throw new Error('Unknown save version');
  if (!Object.hasOwn(MISSION_INDEX, activeId) || rows.some(p => !p || !Object.hasOwn(MISSION_INDEX, p.id)) || new Set(rows.map(p => p.id)).size !== rows.length) throw new Error('Unknown mission');
  const active = MISSION_INDEX[activeId];
  if (MISSIONS.slice(0, active + 1).some(m => !rows.some(p => p.id === m.id))) throw new Error('Missing progress');
  const fresh = encodeGame(initialState());
  return { ...data, version: 1, active, missions: MISSIONS.map((m, i) => rows.find(p => p.id === m.id) ?? fresh.missions[i]) };
}
export async function decodeGame(raw) {
  try {
    const data = normalizeSave(JSON.parse(raw));
    if (data.version !== 1 || !Number.isInteger(data.active) || data.active < 0 || data.active >= MISSIONS.length || !Array.isArray(data.missions) || data.missions.length !== MISSIONS.length) throw new Error('Invalid save');
    if ([443, 8080].some(port => typeof data.ports?.[port] !== 'boolean') || ![6, 12, 15].includes(data.login?.minLength) || typeof data.login?.blockCommon !== 'boolean' || typeof data.login?.limitAttempts !== 'boolean' || typeof data.restored !== 'boolean' || typeof data.hashComputed !== 'boolean') throw new Error('Invalid policy');
    const state = initialState();
    state.active = data.active;
    state.ports = { 443: data.ports[443], 8080: data.ports[8080] };
    state.login = { minLength: data.login.minLength, blockCommon: data.login.blockCommon, limitAttempts: data.login.limitAttempts };
    if (data.restored) state.files['budget.csv'] = ORIGINAL_FILES['budget.csv'];
    data.missions.forEach((p, i) => {
      if (!Array.isArray(p.clues) || p.clues.length > Object.keys(MISSIONS[i].clues).length || p.clues.some(key => !Object.hasOwn(MISSIONS[i].clues, key)) || new Set(p.clues).size !== p.clues.length || !(p.answer === null || Number.isInteger(p.answer) && p.answer >= 0 && p.answer < MISSIONS[i].answers.length) || !Number.isInteger(p.hint) || p.hint < 0 || p.hint > MISSIONS[i].hints.length || typeof p.verified !== 'boolean' || !(p.selectedFile === null || MISSIONS[i].id === 'integrity' && Object.hasOwn(ORIGINAL_FILES, p.selectedFile))) throw new Error('Invalid progress');
      if (i < state.active && !p.verified || i > state.active && (p.verified || p.clues.length || p.answer !== null || p.hint || p.selectedFile !== null)) throw new Error('Invalid order');
      state.missions[i] = { ...state.missions[i], clues: [...p.clues], answer: p.answer, hint: p.hint, verified: p.verified, selectedFile: p.selectedFile, observations: loadObservations(p.observations, i, state) };
    });
    // 완료 플래그를 신뢰하지 않고 저장된 정책과 단서로 다시 판정한다.
    const active = state.active;
    let hashRetryNeeded = false;
    if (data.hashComputed) {
      if (active !== INTEGRITY || !state.missions[INTEGRITY].clues.includes('hash')) throw new Error('Invalid hash progress');
      state.active = INTEGRITY;
      try {
        await runCommand(state, 'hash files');
      } catch {
        // 연산 실패는 저장 손상이 아니다. 다음 복원에서도 재계산을 시도한다.
        state.missions[INTEGRITY].hashPending = true;
        state.missions[INTEGRITY].verified = false;
        hashRetryNeeded = true;
      }
    }
    for (let i = 0; i < MISSIONS.length; i++) {
      if (!data.missions[i].verified) continue;
      state.active = i;
      state.missions[i].verified = false;
      await runCommand(state, 'verify');
      if (MISSIONS[i].id === 'integrity' && hashRetryNeeded) continue;
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
    save(state, { backup = false, replacePreserved = false } = {}) {
      const game = structuredClone(encodeGame(state));
      const result = queue.then(async () => {
        if (blocked && !(blocked === 'preserved' && replacePreserved && locks?.request)) throw saveError(blocked, 'Automatic save blocked');
        return locks.request(CURRENT_SAVE_KEY, () => {
          if (session.changed()) throw saveError('conflict', 'Save changed in another tab');
          if (revision >= Number.MAX_SAFE_INTEGER) throw saveError('preserved', 'Save revision limit');
          // No writes to the original v1 key. Back up before migrating or importing.
          if (backup || expected === null && legacy !== null) storage.setItem(BACKUP_KEY, expected ?? legacy);
          const raw = JSON.stringify({ version: 2, revision: revision + 1, game });
          storage.setItem(CURRENT_SAVE_KEY, raw);
          expected = raw;
          revision++;
          blocked = null;
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

export const MAX_IMPORT_BYTES = 128 * 1024;
export async function importGame(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error('진행 파일 크기는 128KiB 이하여야 합니다.');
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('게임 진행 JSON 형식이 아닙니다.'); }
  let game;
  if (data?.format === 'security-lab-progress' && data.version === 1 && Object.keys(data).every(key => ['format', 'version', 'game'].includes(key))) game = data.game;
  else if (data?.version === 2 && Number.isSafeInteger(data.revision) && data.revision > 0 && data.game) game = data.game;
  else if ([1, 2].includes(data?.version) && Array.isArray(data.missions)) game = data;
  else throw new Error('지원하지 않는 진행 파일 형식입니다.');
  const loaded = await decodeGame(JSON.stringify(game));
  if (loaded.recovered) throw new Error('진행의 단서·순서·완료 조건이 올바르지 않습니다.');
  return loaded;
}
