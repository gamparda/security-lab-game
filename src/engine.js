import { MISSIONS, ORIGINAL_FILES, TAMPERED_BUDGET, COMMON_PASSWORDS, NORMAL_PASSWORD } from './missions.js';

export function initialState() {
  return {
    version: 1, active: 0,
    missions: MISSIONS.map(() => ({ clues: [], answer: null, hint: 0, verified: false, checks: [], hashes: [], hashPending: false, selectedFile: null })),
    ports: { 443: true, 8080: true },
    login: { minLength: 6, blockCommon: false, limitAttempts: false },
    files: { ...ORIGINAL_FILES, 'budget.csv': TAMPERED_BUDGET },
  };
}
export function progress(state) { return state.missions[state.active]; }
function clue(state, key) {
  const p = progress(state);
  if (!p.clues.includes(key)) {
    p.clues.push(key);
    if (!p.verified) p.checks = [];
  }
}
function invalidateVerification(state) {
  progress(state).verified = false;
  progress(state).checks = [];
}
export function explained(state, index = state.active) { return state.missions[index].answer === MISSIONS[index].correct; }
export function defended(state, index = state.active) {
  if (index === 0) return explained(state, 0);
  if (index === 1) return state.ports[443] && !state.ports[8080];
  if (index === 2) return state.login.minLength >= 15 && state.login.blockCommon && state.login.limitAttempts;
  return Object.keys(ORIGINAL_FILES).every(name => state.files[name] === ORIGINAL_FILES[name]);
}
export function score(state, index = state.active) {
  const p = state.missions[index];
  return (p.clues.length ? 30 : 0) + (explained(state, index) ? 20 : 0) + (defended(state, index) ? 30 : 0) + (p.verified ? 20 : 0);
}
export function stage(state) {
  const p = progress(state);
  if (p.verified) return '검증 완료';
  if (defended(state)) return '방어 적용';
  if (explained(state)) return '취약 상태 확인';
  if (p.clues.length) return '조사';
  return '준비';
}
export function applyAnswer(state, answer) {
  if (!Number.isInteger(answer) || answer < 0 || answer >= MISSIONS[state.active].answers.length) throw new Error('유효하지 않은 설명입니다.');
  progress(state).answer = answer;
  invalidateVerification(state);
}
export function applyPort(state, port, allowed) {
  if (state.active !== 1 || ![443, 8080].includes(port) || typeof allowed !== 'boolean') throw new Error('설정할 수 없는 포트입니다.');
  state.ports[port] = allowed;
  invalidateVerification(state);
  progress(state).clues = progress(state).clues.filter(key => key !== 'rescan');
}
export function applyLogin(state, policy) {
  if (state.active !== 2 || ![6, 12, 15].includes(policy.minLength) || typeof policy.blockCommon !== 'boolean' || typeof policy.limitAttempts !== 'boolean') throw new Error('유효하지 않은 정책입니다.');
  state.login = { ...policy };
  invalidateVerification(state);
}
export function accepted(password, policy) {
  return password.length >= policy.minLength && (!policy.blockCommon || !COMMON_PASSWORDS.includes(password.toLowerCase()));
}
export function loginSimulation(policy) {
  // 가상 계정에 대한 서로 독립적인 정상 로그인 / 연속 실패 시나리오.
  const normal = accepted(NORMAL_PASSWORD, policy);
  const attempts = Array.from({ length: 5 }, (_, i) => ({ attempt: i + 1, result: policy.limitAttempts && i >= 3 ? '제한됨' : '실패' }));
  const commonBlocked = COMMON_PASSWORDS.every(value => !accepted(value, policy));
  return { normal, commonBlocked, attempts, repeatedBlocked: attempts[3].result === '제한됨' };
}
export async function sha256(content) {
  if (!globalThis.crypto?.subtle) throw new Error('해시 계산에는 HTTPS 또는 http://localhost 환경이 필요합니다.');
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function canRestoreFiles(state) {
  return state.active === 3 && ['baseline', 'hash', 'mismatch'].every(key => progress(state).clues.includes(key));
}
export function restoreFile(state, name) {
  if (state.active !== 3 || !Object.hasOwn(ORIGINAL_FILES, name)) throw new Error('내장 파일만 복구할 수 있습니다.');
  if (!canRestoreFiles(state)) throw new Error('먼저 inspect baseline으로 기준을 확인하고 hash files로 변경을 조사하세요.');
  progress(state).selectedFile = name;
  state.files[name] = ORIGINAL_FILES[name];
  invalidateVerification(state);
  progress(state).hashes = [];
  progress(state).hashPending = false;
}
export function nextMission(state) {
  if (!progress(state).verified || state.active >= MISSIONS.length - 1) return false;
  state.active++;
  return true;
}
export function resetMission(state) {
  const fresh = initialState();
  // 앞 미션은 유지하고 현재와 이후의 기록·환경을 원본으로 돌린다.
  for (let i = state.active; i < 4; i++) state.missions[i] = fresh.missions[i];
  if (state.active <= 1) state.ports = fresh.ports;
  if (state.active <= 2) state.login = fresh.login;
  state.files = fresh.files;
}
export async function runCommand(state, input) {
  if (typeof input !== 'string' || !input.trim()) return '명령어를 입력하세요. help로 사용법을 확인할 수 있습니다.';
  if (input.length > 200) return '입력은 200자 이하여야 합니다.';
  const parts = input.trim().split(/\s+/);
  const [cmd, target, detail] = parts;
  const mission = MISSIONS[state.active];
  if (!mission.commands.includes(cmd)) return '알 수 없거나 이 미션에서 허용되지 않은 명령입니다. help를 확인하세요.';
  if (cmd === 'help' && parts.length === 1) {
    if (state.active === 0) clue(state, 'help');
    return [
      'help / inspect approval / verify',
      'help / scan club-server / inspect club-server 443 / inspect club-server 8080 / verify',
      'help / inspect login / verify',
      'help / inspect baseline / hash files / verify',
    ][state.active];
  }
  if (cmd === 'inspect' && state.active === 0 && target === 'approval' && parts.length === 2) {
    clue(state, 'approval');
    return '조사 승인서: club-server의 가상 서비스·더미 로그인·내장 파일만 조사합니다. 실제 IP·URL·외부 서버는 범위에 포함되지 않습니다.';
  }
  if (cmd === 'scan' && state.active === 1 && target === 'club-server' && parts.length === 2) {
    clue(state, 'scan');
    if (defended(state)) clue(state, 'rescan');
    return [443, 8080].map(port => `${port} ${state.ports[port] ? 'OPEN' : 'FILTERED'} / ${port === 443 ? '필수 HTTPS 자료 서비스' : '사용하지 않는 관리 서비스'}`).join('\n');
  }
  if (cmd === 'inspect' && state.active === 1 && target === 'club-server' && ['443', '8080'].includes(detail) && parts.length === 3) {
    clue(state, `port-${detail}`);
    return detail === '443' ? '443: 동아리 자료를 제공하는 필수 웹 서비스. 운영 조건: 자료 열람을 유지하세요.' : '8080: 이전 관리용 서비스. 현재 사용하지 않으며 접근이 불필요합니다. 방화벽에서 접근을 차단해도 프로세스를 종료하는 것은 아닙니다.';
  }
  if (cmd === 'inspect' && state.active === 2 && target === 'login' && parts.length === 2) {
    clue(state, 'login');
    const result = loginSimulation(state.login);
    return `더미 후보 정책 검사:\n${COMMON_PASSWORDS.map(value => `${value}: ${accepted(value, state.login) ? '허용' : '거부'}`).join('\n')}\n연속 실패 기록:\n${result.attempts.map(a => `${a.attempt}회: ${a.result}`).join('\n')}\n모든 후보·로그인은 게임 데이터입니다.`;
  }
  if (cmd === 'inspect' && state.active === 3 && target === 'baseline' && parts.length === 2) {
    clue(state, 'baseline');
    return '기준 출처: 조사 승인 이전에 담당 교사가 보관한 오프라인 원본. 게임에서 이 기준은 변경할 수 없습니다. hash files로 내장 파일의 SHA-256과 비교하세요.';
  }
  if (cmd === 'hash' && state.active === 3 && target === 'files' && parts.length === 2) {
    const snapshot = { ...state.files };
    const hashes = await Promise.all(Object.keys(ORIGINAL_FILES).map(async name => {
      const [actual, expected] = await Promise.all([sha256(snapshot[name]), sha256(ORIGINAL_FILES[name])]);
      return { name, actual, expected, matches: actual === expected };
    }));
    if (Object.keys(snapshot).some(name => snapshot[name] !== state.files[name])) return '계산 중 파일이 바뀌었습니다. hash files를 다시 실행하세요.';
    progress(state).hashes = hashes;
    progress(state).hashPending = false;
    if (!progress(state).verified) progress(state).checks = [];
    clue(state, 'hash');
    if (hashes.some(row => !row.matches)) clue(state, 'mismatch');
    return hashes.map(row => `${row.name}: ${row.matches ? '일치' : '변경 감지'}\n현재 ${row.actual}\n기준 ${row.expected}`).join('\n\n');
  }
  if (cmd === 'verify' && parts.length === 1) {
    const p = progress(state);
    if (!explained(state)) return '먼저 관찰한 근거에 맞는 원인 설명을 선택하세요.';
    let checks;
    if (state.active === 0) checks = [['help 확인', p.clues.includes('help')], ['승인서 확인', p.clues.includes('approval')], ['조사 범위 선택', explained(state)]];
    if (state.active === 1) checks = [['서비스 단서 조사', p.clues.includes('scan') && p.clues.includes('port-8080')], ['8080 접근 차단', !state.ports[8080]], ['443 자료 서비스 정상', state.ports[443]], ['방어 후 다시 scan', p.clues.includes('rescan')]];
    if (state.active === 2) {
      const result = loginSimulation(state.login);
      checks = [['더미 기록 조사', p.clues.includes('login')], ['최소 길이 15 이상', state.login.minLength >= 15], ['흔한 값 차단 정책', state.login.blockCommon && result.commonBlocked], ['정상 사용자 첫 로그인 성공', result.normal], ['연속 실패 3회 후 제한', state.login.limitAttempts && result.repeatedBlocked]];
    }
    if (state.active === 3) checks = [['신뢰 기준 확인', p.clues.includes('baseline')], ['변경 감지 기록', p.clues.includes('mismatch')], ['변경 파일 선택', p.selectedFile === 'budget.csv'], ['원본 파일 복구', defended(state)], ['복구 후 해시 재계산', p.hashes.length === 3 && p.hashes.every(row => row.matches)]];
    p.checks = checks.map(([label, passed]) => ({ label, passed }));
    p.verified = checks.every(([, passed]) => passed);
    return `${p.checks.map(check => `${check.passed ? '통과' : '미충족'}: ${check.label}`).join('\n')}\n\n${p.verified ? '검증 완료! ' + mission.explanation : '아직 완료되지 않았습니다. 미충족 항목을 확인하고 다시 검증하세요.'}`;
  }
  return '게임 전용 문법과 대상만 허용됩니다. 실제 IP·URL은 사용할 수 없습니다. help를 확인하세요.';
}
