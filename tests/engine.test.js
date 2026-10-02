import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, progress, runCommand, applyAnswer, applyPort, applyLogin, canRestoreFiles, restoreFile, nextMission, resetMission, score, sha256, accepted, loginSimulation } from '../src/engine.js';
import { ORIGINAL_FILES } from '../src/missions.js';
import { loadGame, saveGame, SAVE_KEY } from '../src/storage.js';

async function tutorial(state) {
  await runCommand(state, 'help'); await runCommand(state, 'inspect approval'); applyAnswer(state, 0);
  await runCommand(state, 'verify'); assert.equal(progress(state).verified, true); nextMission(state);
}
async function services(state) {
  await runCommand(state, 'scan club-server'); await runCommand(state, 'inspect club-server 8080'); applyAnswer(state, 1);
  applyPort(state, 8080, false); await runCommand(state, 'scan club-server'); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, true); nextMission(state);
}
async function login(state) {
  await runCommand(state, 'inspect login'); applyAnswer(state, 2);
  applyLogin(state, { minLength: 15, blockCommon: true, limitAttempts: true }); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, true); nextMission(state);
}
async function integrity(state) {
  await runCommand(state, 'inspect baseline'); await runCommand(state, 'hash files'); applyAnswer(state, 1);
  restoreFile(state, 'budget.csv'); await runCommand(state, 'hash files'); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, true);
}
function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('튜토리얼: 단서와 범위 없이는 완료 불가', async () => {
  const state = initialState();
  assert.equal(nextMission(state), false);
  applyAnswer(state, 0); await runCommand(state, 'verify'); assert.equal(progress(state).verified, false);
  await tutorial(state); assert.equal(state.active, 1);
});
test('4개 미션이 순서대로 완료되고 각각 100점', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  assert.ok(state.missions.every(p => p.verified));
  assert.deepEqual(state.missions.map((_, i) => score(state, i)), [100, 100, 100, 100]);
  assert.equal(nextMission(state), false);
});
test('전체 포트 차단은 정상 서비스 실패로 판정', async () => {
  const state = initialState(); await tutorial(state);
  await runCommand(state, 'scan club-server'); await runCommand(state, 'inspect club-server 8080'); applyAnswer(state, 1);
  applyPort(state, 443, false); applyPort(state, 8080, false);
  await runCommand(state, 'scan club-server'); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, false);
  assert.equal(progress(state).checks.find(c => c.label.includes('443')).passed, false);
});
test('방어 후 다시 scan하지 않으면 완료 불가', async () => {
  const state = initialState(); await tutorial(state);
  await runCommand(state, 'scan club-server'); await runCommand(state, 'inspect club-server 8080'); applyAnswer(state, 1);
  applyPort(state, 8080, false); await runCommand(state, 'verify'); assert.equal(progress(state).verified, false);
});
test('완료 이후 포트 변경은 검증 무효화', async () => {
  const state = initialState(); await tutorial(state); await services(state); state.active = 1;
  applyPort(state, 8080, true); assert.equal(progress(state).verified, false); assert.equal(progress(state).clues.includes('rescan'), false);
});
test('길어도 흔한 비밀번호는 차단 목록으로 거부', () => {
  const policy = { minLength: 15, blockCommon: true, limitAttempts: true };
  assert.equal(accepted('school-club-password', policy), false);
  assert.equal(accepted('school-club-password', { ...policy, blockCommon: false }), true);
  const result = loginSimulation(policy);
  assert.equal(result.normal, true); assert.equal(result.repeatedBlocked, true);
  assert.equal(result.attempts[2].result, '실패'); assert.equal(result.attempts[3].result, '제한됨');
});
test('시도 제한 없는 정책은 완료 불가', async () => {
  const state = initialState(); await tutorial(state); await services(state);
  await runCommand(state, 'inspect login'); applyAnswer(state, 2);
  applyLogin(state, { minLength: 15, blockCommon: true, limitAttempts: false }); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, false);
});
test('SHA-256 표준 벡터와 한 바이트 변경', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256('abc'), await sha256('abc')); assert.notEqual(await sha256('abc'), await sha256('abd'));
});
test('변경된 파일만 탐지하고 복구 후 재계산이 필수', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state);
  await runCommand(state, 'inspect baseline'); await runCommand(state, 'hash files'); applyAnswer(state, 1);
  assert.deepEqual(progress(state).hashes.filter(row => !row.matches).map(row => row.name), ['budget.csv']);
  restoreFile(state, 'budget.csv'); await runCommand(state, 'verify'); assert.equal(progress(state).verified, false);
  await runCommand(state, 'hash files'); await runCommand(state, 'verify'); assert.equal(progress(state).verified, true);
});
test('기준과 변경을 조사하기 전에는 파일 복구가 상태를 바꾸지 않음', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state);
  let before = structuredClone(state);
  assert.equal(canRestoreFiles(state), false);
  assert.throws(() => restoreFile(state, 'budget.csv'), /기준을 확인/); assert.deepEqual(state, before);
  await runCommand(state, 'hash files');
  before = structuredClone(state);
  assert.equal(canRestoreFiles(state), false);
  assert.throws(() => restoreFile(state, 'budget.csv'), /기준을 확인/); assert.deepEqual(state, before);
  await runCommand(state, 'inspect baseline');
  assert.equal(canRestoreFiles(state), true);
  restoreFile(state, 'notice.txt');
  assert.equal(canRestoreFiles(state), true);
  restoreFile(state, 'budget.csv'); await runCommand(state, 'hash files'); applyAnswer(state, 1); await runCommand(state, 'verify');
  assert.equal(progress(state).verified, true);
});
test('알 수 없는 명령, URL, IP, 긴 입력은 상태를 변경하지 않음', async () => {
  const state = initialState(); await tutorial(state); const before = structuredClone(state);
  for (const input of ['', ' ', 'x'.repeat(201), 'scan https://example.com', 'scan 127.0.0.1', 'scan club-server extra', 'eval alert(1)', '<script>alert(1)</script>', 'inspect club-server __proto__']) {
    assert.equal(typeof await runCommand(state, input), 'string'); assert.deepEqual(state, before);
  }
});
test('허용하지 않는 설정 값과 파일을 거부', async () => {
  const state = initialState(); await tutorial(state);
  assert.throws(() => applyPort(state, 22, true)); assert.throws(() => applyPort(state, 443, 'false'));
  assert.throws(() => restoreFile(state, '__proto__')); assert.throws(() => applyAnswer(state, 99));
});
test('힌트는 점수를 낮추지 않음', async () => {
  const state = initialState(); await tutorial(state); state.active = 0;
  const before = score(state); progress(state).hint = 3; assert.equal(score(state), before);
});
test('현재 미션 초기화는 앞 미션 유지, 정책·단서·점수 복원', async () => {
  const state = initialState(); await tutorial(state); await services(state); state.active = 1;
  progress(state).hint = 3; resetMission(state);
  assert.equal(state.missions[0].verified, true); assert.equal(score(state), 0);
  assert.deepEqual(state.ports, { 443: true, 8080: true }); assert.equal(progress(state).hint, 0);
});
test('전체 초기 상태에는 이전 완료와 복구가 없음', () => {
  const state = initialState(); assert.equal(state.active, 0); assert.ok(state.missions.every(p => !p.verified));
  assert.notEqual(state.files['budget.csv'], ORIGINAL_FILES['budget.csv']);
});
test('완료한 모든 미션과 힌트가 저장 후 재판정·복원됨', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  state.missions[1].hint = 2;
  const storage = memoryStorage(); saveGame(state, storage); const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false); assert.equal(loaded.state.active, 3);
  assert.ok(loaded.state.missions.every(p => p.verified)); assert.equal(loaded.state.missions[1].hint, 2);
  assert.equal(storage.getItem(SAVE_KEY).includes('reading-stars'), false);
});
test('손상 저장과 잘못된 완료 상태는 안전하게 초기화', async () => {
  for (const value of ['{bad', '{}', '{"version":9}', '{"version":1,"active":0,"missions":null}']) {
    const storage = memoryStorage(); storage.setItem(SAVE_KEY, value); const loaded = await loadGame(storage);
    assert.equal(loaded.recovered, true); assert.equal(loaded.state.active, 0);
  }
  const storage = memoryStorage(), state = initialState(); state.missions[0].verified = true;
  saveGame(state, storage); assert.equal((await loadGame(storage)).recovered, true);
});
test('복구 직후 새로고침도 복구 후 해시 재계산을 대신하지 않음', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state);
  await runCommand(state, 'inspect baseline'); await runCommand(state, 'hash files'); applyAnswer(state, 1);
  restoreFile(state, 'budget.csv');
  const storage = memoryStorage(); saveGame(state, storage); const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false); assert.equal(progress(loaded.state).hashes.length, 0);
  await runCommand(loaded.state, 'verify'); assert.equal(progress(loaded.state).verified, false);
});

test('복원 중 해시 연산 실패는 저장과 앞 미션을 보존하고 재시도할 수 있음', async t => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  progress(state).hint = 2;
  const storage = memoryStorage(); saveGame(state, storage);
  const saved = storage.getItem(SAVE_KEY);
  const digest = t.mock.method(crypto.subtle, 'digest', async () => { throw new Error('Temporary digest failure'); });
  const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false); assert.equal(loaded.hashRetryNeeded, true);
  assert.equal(storage.getItem(SAVE_KEY), saved);
  assert.equal(loaded.state.active, 3); assert.ok(loaded.state.missions.slice(0, 3).every(p => p.verified));
  assert.equal(progress(loaded.state).verified, false); assert.equal(progress(loaded.state).hint, 2);
  assert.equal(progress(loaded.state).hashes.length, 0); assert.equal(nextMission(loaded.state), false);
  await runCommand(loaded.state, 'verify'); assert.equal(progress(loaded.state).verified, false);
  saveGame(loaded.state, storage);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).hashComputed, true);
  assert.equal((await loadGame(storage)).hashRetryNeeded, true);
  digest.mock.restore();
  const retried = await loadGame(storage);
  assert.equal(retried.recovered, false); assert.equal(retried.hashRetryNeeded, false);
  assert.equal(progress(retried.state).hashes.length, 3); assert.equal(progress(retried.state).verified, false);
  await runCommand(retried.state, 'verify'); assert.equal(progress(retried.state).verified, true);
});

test('Web Crypto가 없는 환경에서도 유효한 저장을 삭제하지 않음', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  const storage = memoryStorage(); saveGame(state, storage);
  const saved = storage.getItem(SAVE_KEY), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const loaded = await loadGame(storage);
    assert.equal(loaded.recovered, false); assert.equal(loaded.hashRetryNeeded, true);
    assert.equal(storage.getItem(SAVE_KEY), saved); assert.equal(loaded.state.active, 3);
    assert.ok(loaded.state.missions.slice(0, 3).every(p => p.verified));
    assert.equal(progress(loaded.state).verified, false);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('해시 연산 실패 중에도 잘못된 앞 미션 완료는 그대로 인정하지 않음', async t => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  state.login.limitAttempts = false;
  const storage = memoryStorage(); saveGame(state, storage);
  t.mock.method(crypto.subtle, 'digest', async () => { throw new Error('Temporary digest failure'); });
  const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, true); assert.equal(loaded.state.active, 0);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('설명·포트·로그인·파일 변경은 이전 통과 결과와 완료 상태를 무효화함', async () => {
  const completed = initialState(); await tutorial(completed); await services(completed); await login(completed); await integrity(completed);
  for (const [index, change] of [
    [1, state => applyAnswer(state, 0)],
    [1, state => applyPort(state, 8080, true)],
    [2, state => applyLogin(state, { minLength: 6, blockCommon: false, limitAttempts: false })],
    [3, state => restoreFile(state, 'notice.txt')],
  ]) {
    const state = structuredClone(completed); state.active = index;
    assert.ok(progress(state).checks.length > 0); assert.ok(progress(state).checks.every(check => check.passed));
    change(state);
    assert.equal(progress(state).verified, false); assert.deepEqual(progress(state).checks, []);
    assert.equal(nextMission(state), false);
  }
});

test('미충족 검사 뒤 새 단서와 해시 재계산을 얻으면 이전 검사 결과를 비움', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state);
  await runCommand(state, 'hash files'); applyAnswer(state, 1); await runCommand(state, 'verify');
  assert.ok(progress(state).checks.length > 0);
  await runCommand(state, 'inspect baseline'); assert.deepEqual(progress(state).checks, []);
  restoreFile(state, 'budget.csv'); await runCommand(state, 'verify');
  assert.ok(progress(state).checks.some(check => !check.passed));
  await runCommand(state, 'hash files'); assert.deepEqual(progress(state).checks, []);
  assert.equal(progress(state).verified, false);
  await runCommand(state, 'verify'); assert.equal(progress(state).verified, true);
});
