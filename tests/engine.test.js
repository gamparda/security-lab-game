import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, progress, runCommand, answerFeedback, applyAnswer, applyPort, applyLogin, canRestoreFiles, restoreFile, nextMission, resetMission, score, sha256, accepted, loginSimulation } from '../src/engine.js';
import { MISSIONS, ORIGINAL_FILES } from '../src/missions.js';
import { loadGame, saveGame, SAVE_KEY, createSaveSession, CURRENT_SAVE_KEY, exportGame, importGame } from '../src/storage.js';

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

function serializedLocks() {
  let queue = Promise.resolve();
  return { request: (_name, action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  } };
}

test('오래된 탭은 진행과 전체 초기화 결과를 덮어쓰지 못함', async () => {
  const storage = memoryStorage(), locks = serializedLocks();
  const a = await createSaveSession(storage, locks), b = await createSaveSession(storage, locks);
  const state = initialState(); await tutorial(state);
  await a.save(state);
  await assert.rejects(b.save(initialState()), { code: 'conflict' });
  const c = await createSaveSession(storage, locks);
  await c.save(initialState());
  await assert.rejects(a.save(state), { code: 'conflict' });
  assert.equal((await createSaveSession(storage, locks)).state.active, 0);
});

test('동시 저장은 잠금 안에서 개정을 비교해 하나만 성공함', async () => {
  const storage = memoryStorage(), locks = serializedLocks();
  const a = await createSaveSession(storage, locks), b = await createSaveSession(storage, locks);
  const results = await Promise.allSettled([a.save(initialState()), b.save(initialState())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(storage.getItem(CURRENT_SAVE_KEY)).revision, 1);
});

test('v1 변환과 저장 실패에도 원본이 남고 잠금 미지원은 쓰기를 막음', async () => {
  const storage = memoryStorage(), state = initialState(); await tutorial(state);
  saveGame(state, storage); const original = storage.getItem(SAVE_KEY);
  const session = await createSaveSession(storage, serializedLocks());
  assert.equal(session.state.active, 1);
  await session.save(session.state);
  assert.equal(storage.getItem(SAVE_KEY), original);
  const readOnly = await createSaveSession(storage, null);
  await assert.rejects(readOnly.save(initialState()), { code: 'unavailable' });
  const before = storage.getItem(CURRENT_SAVE_KEY);
  storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(session.save(initialState()), /quota/);
  assert.equal(storage.getItem(CURRENT_SAVE_KEY), before);
  assert.equal(storage.getItem(SAVE_KEY), original);
});

test('미지원 저장과 변환 백업 실패는 원본을 자동으로 바꾸지 않음', async () => {
  for (const raw of ['{broken', '{"version":99}']) {
    const storage = memoryStorage(); storage.setItem(SAVE_KEY, raw);
    const session = await createSaveSession(storage, serializedLocks());
    await assert.rejects(session.save(initialState()), { code: 'preserved' });
    assert.equal(storage.getItem(SAVE_KEY), raw);
    assert.equal(storage.getItem(CURRENT_SAVE_KEY), null);
  }
  const storage = memoryStorage(); saveGame(initialState(), storage);
  const original = storage.getItem(SAVE_KEY);
  const session = await createSaveSession(storage, serializedLocks());
  storage.setItem = () => { throw new Error('backup full'); };
  await assert.rejects(session.save(initialState()), /backup full/);
  assert.equal(storage.getItem(SAVE_KEY), original);
  assert.equal(storage.getItem(CURRENT_SAVE_KEY), null);
});

test('진행 이동은 완료를 재검증하고 크기·형식·순서 오류를 거부함', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  assert.ok((await importGame(exportGame(state))).state.missions.every(m => m.verified));
  await assert.rejects(importGame('x'.repeat(128 * 1024 + 1)), /크기/);
  await assert.rejects(importGame('{broken'), /형식/);
  const tampered = JSON.parse(exportGame(state)); tampered.game.ports[443] = false;
  await assert.rejects(importGame(JSON.stringify(tampered)), /진행/);
  tampered.game.active = 0;
  await assert.rejects(importGame(JSON.stringify(tampered)), /진행/);
});

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
  assert.notEqual(storage.getItem(SAVE_KEY), null);
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

test('포트 관찰은 조사 당시 값을 보존하고 새 설정에는 재조사가 필요함', async () => {
  const state = initialState(); await tutorial(state);
  assert.deepEqual(progress(state).observations, { changed: false, before: null, after: null });
  await runCommand(state, 'scan club-server');
  const before = { 443: true, 8080: true };
  assert.deepEqual(progress(state).observations.before, before);
  applyAnswer(state, 1); assert.equal(progress(state).observations.changed, false);
  applyPort(state, 8080, false);
  assert.deepEqual(progress(state).observations.before, before); assert.equal(progress(state).observations.after, null);
  await runCommand(state, 'scan club-server');
  assert.deepEqual(progress(state).observations.after, { 443: true, 8080: false });
  applyPort(state, 443, false); assert.equal(progress(state).observations.after, null);
  await runCommand(state, 'scan club-server');
  assert.deepEqual(progress(state).observations.after, { 443: false, 8080: false });
  assert.deepEqual(progress(state).observations.before, before);
  resetMission(state); assert.deepEqual(progress(state).observations, { changed: false, before: null, after: null });
});

test('로그인 비교는 길이만 변경한 결과와 흔한 값·시도 제한을 구분함', async () => {
  const state = initialState(); await tutorial(state); await services(state);
  await runCommand(state, 'inspect login');
  const before = { minLength: 6, blockCommon: false, limitAttempts: false };
  assert.deepEqual(progress(state).observations.before, before);
  applyLogin(state, { ...state.login, minLength: 15 });
  assert.equal(progress(state).observations.after, null);
  await runCommand(state, 'inspect login');
  assert.equal(accepted('school-club-password', progress(state).observations.after), true);
  assert.equal(loginSimulation(progress(state).observations.after).repeatedBlocked, false);
  applyLogin(state, { minLength: 15, blockCommon: true, limitAttempts: true });
  applyAnswer(state, 2); await runCommand(state, 'verify');
  assert.equal(accepted('school-club-password', progress(state).observations.after), false);
  assert.equal(loginSimulation(progress(state).observations.after).normal, true);
  assert.equal(loginSimulation(progress(state).observations.after).repeatedBlocked, true);
  assert.deepEqual(progress(state).observations.before, before);
});

test('파일 비교는 복구 뒤 새 해시 계산 전까지 변경 후 결과를 만들지 않음', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state);
  await runCommand(state, 'inspect baseline'); await runCommand(state, 'hash files'); applyAnswer(state, 1);
  const before = structuredClone(progress(state).observations.before);
  assert.equal(before.matches['budget.csv'], false);
  restoreFile(state, 'budget.csv'); await runCommand(state, 'verify');
  assert.equal(progress(state).observations.after, null);
  const storage = memoryStorage(); saveGame(state, storage);
  const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false); assert.equal(progress(loaded.state).observations.after, null);
  assert.deepEqual(progress(loaded.state).observations.before, before);
  await runCommand(loaded.state, 'hash files');
  assert.ok(Object.values(progress(loaded.state).observations.after.matches).every(Boolean));
  assert.equal(progress(loaded.state).verified, false);
});

test('전후 기록은 저장·복원되고 기록 없는 기존 v1 저장도 읽음', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  const storage = memoryStorage(); saveGame(state, storage);
  const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.state.missions.map(p => p.observations), state.missions.map(p => p.observations));
  const legacy = JSON.parse(storage.getItem(SAVE_KEY));
  legacy.missions.forEach(p => { delete p.observations; });
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const old = await loadGame(storage);
  assert.equal(old.recovered, false); assert.ok(old.state.missions.every(p => p.verified));
  assert.ok(old.state.missions.every(p => p.observations.before === null));
  assert.deepEqual(old.state.missions[1].observations.after, { 443: true, 8080: false });
});

test('선택 관찰 기록이 손상되어도 정상 진행은 보존함', async () => {
  const state = initialState(); await tutorial(state);
  const storage = memoryStorage(); saveGame(state, storage);
  const data = JSON.parse(storage.getItem(SAVE_KEY));
  data.missions[1].observations = { changed: false, before: { 443: 'true', 8080: true }, after: [] };
  storage.setItem(SAVE_KEY, JSON.stringify(data));
  const loaded = await loadGame(storage);
  assert.equal(loaded.recovered, false); assert.equal(loaded.state.active, 1);
  assert.equal(loaded.state.missions[0].verified, true);
  assert.equal(progress(loaded.state).observations.before, null);
  assert.equal(progress(loaded.state).observations.after, null);
});

test('조사 전 정답 선택도 근거 확인을 안내하고 완료를 대신하지 않음', async () => {
  for (const [index, commands] of [[0, ['help', 'inspect approval']], [1, ['scan club-server', 'inspect club-server 8080']], [2, ['inspect login']], [3, ['inspect baseline', 'hash files']]]) {
    const state = initialState(); state.active = index;
    assert.equal(answerFeedback(state), null);
    applyAnswer(state, MISSIONS[index].correct);
    assert.equal(answerFeedback(state).status, 'investigate');
    for (const command of commands) await runCommand(state, command);
    assert.equal(answerFeedback(state).status, 'supported');
    assert.equal(progress(state).verified, false);
  }
});

test('오답마다 오해한 개념과 확인할 근거를 안내하며 상태를 바꾸지 않음', async () => {
  const completed = initialState(); await tutorial(completed); await services(completed); await login(completed); await integrity(completed);
  for (const [index, answer, concept] of [[0, 1, /조사 권한/], [0, 2, /승인이 먼저/], [1, 0, /열린 포트만으로/], [1, 2, /HTTPS 서비스의 존재/], [2, 0, /password!/], [2, 1, /반복 로그인/], [3, 0, /악성 여부/], [3, 2, /신원을 인증/]]) {
    const state = structuredClone(completed); state.active = index; applyAnswer(state, answer);
    const before = structuredClone(state), feedback = answerFeedback(state);
    assert.equal(feedback.status, 'reconsider'); assert.match(feedback.text, concept);
    assert.deepEqual(state, before);
    assert.equal(await runCommand(state, 'verify'), feedback.text);
    assert.equal(progress(state).verified, false); assert.equal(nextMission(state), false);
  }
});

test('관찰 기록만으로 조사·정상 기능·해시 재검증 조건을 생략할 수 없음', async () => {
  const state = initialState(); await tutorial(state);
  applyPort(state, 8080, false); applyAnswer(state, 1);
  progress(state).observations = { changed: true, before: { 443: true, 8080: true }, after: { 443: true, 8080: false } };
  await runCommand(state, 'verify');
  assert.equal(progress(state).verified, false);
  assert.ok(progress(state).checks.some(check => check.label === '서비스 단서 조사' && !check.passed));
  assert.ok(progress(state).checks.some(check => check.label === '방어 후 다시 scan' && !check.passed));
});

test('완료한 미션의 피드백은 재작업 대신 완료 결과를 안내함', async () => {
  const state = initialState(); await tutorial(state); await services(state); await login(state); await integrity(state);
  for (let index = 0; index < MISSIONS.length; index++) {
    state.active = index;
    const before = structuredClone(state), feedback = answerFeedback(state);
    assert.equal(feedback.status, 'supported'); assert.match(feedback.text, /미션을 완료했습니다/);
    assert.deepEqual(state, before);
  }
});
