import { initialState, runCommand } from './engine.js';
import { MISSIONS, ORIGINAL_FILES } from './missions.js';

export const SAVE_KEY = 'security-lab-game:v1';
const CLUES = [['help', 'approval'], ['scan', 'port-443', 'port-8080', 'rescan'], ['login'], ['baseline', 'hash', 'mismatch']];
export function saveGame(state, storage) {
  const data = {
    version: 1, active: state.active, ports: state.ports, login: state.login,
    restored: state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'],
    hashComputed: state.missions[3].hashes.length === 3 || state.missions[3].hashPending,
    missions: state.missions.map(({ clues, answer, hint, verified, selectedFile }) => ({ clues, answer, hint, verified, selectedFile })),
  };
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}
export async function loadGame(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return { state: initialState(), recovered: false };
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
      state.missions[i] = { ...state.missions[i], clues: [...p.clues], answer: p.answer, hint: p.hint, verified: p.verified, selectedFile: p.selectedFile };
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
    storage.removeItem(SAVE_KEY);
    return { state: initialState(), recovered: true };
  }
}
