import { MISSIONS, ORIGINAL_FILES, TAMPERED_BUDGET, COMMON_PASSWORDS, NORMAL_PASSWORD } from './missions.js';
import {DEVICES,deviceCommands,requiredDevices,revisitDevice,deviceTool,deviceTask} from './devices.js';

export function initialState() {
  return {
    version: 2, active: 0,
    missions: MISSIONS.map(() => ({ clues: [], answer: null, hint: 0, verified: false, checks: [], hashes: [], hashPending: false, selectedFile: null, observations: { changed: false, before: null, after: null } })),
    ports: { 443: true, 8080: true },
    login: { minLength: 6, blockCommon: false, limitAttempts: false },
    files: { ...ORIGINAL_FILES, 'budget.csv': TAMPERED_BUDGET },
  };
}
export function missionId(state, index = state.active) { return MISSIONS[index].id; }
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
function observe(state, snapshot) {
  const observations = progress(state).observations;
  observations[observations.changed ? 'after' : 'before'] = snapshot;
}
function changeEnvironment(state) {
  progress(state).observations.changed = true;
  progress(state).observations.after = null;
  invalidateVerification(state);
  if(progress(state).spatial)progress(state).spatial.rechecked=false;
}
export function answerFeedback(state) {
  const p = progress(state), mission = MISSIONS[state.active];
  if (p.answer === null) return null;
  if (p.verified) return { status: 'supported', text: '선택한 설명의 근거와 재검증 결과를 확인했습니다. 이 미션을 완료했습니다.' };
  if (!mission.evidence.every(key => p.clues.includes(key))) return { status: 'investigate', text: '아직 조사 근거가 충분하지 않습니다. ' + mission.investigation };
  return { status: explained(state) ? 'supported' : 'reconsider', text: mission.answerFeedback[p.answer] };
}
export function explained(state, index = state.active) { return state.missions[index].answer === MISSIONS[index].correct; }
const DEFENDERS = {
  tutorial: (state, index) => explained(state, index),
  services: state => state.ports[443] && !state.ports[8080],
  login: state => state.login.minLength >= 15 && state.login.blockCommon && state.login.limitAttempts,
  integrity: state => Object.keys(ORIGINAL_FILES).every(name => state.files[name] === ORIGINAL_FILES[name]),
};
export function defended(state, index = state.active) {
  return DEFENDERS[missionId(state, index)](state, index);
}
export function score(state, index = state.active) {
  const p = state.missions[index];
  const evidence=MISSIONS[index].evidence,found=evidence.filter(key=>p.clues.includes(key)).length;
  const investigated=found===evidence.length;
  return Math.floor(30*found/evidence.length) + (investigated&&explained(state,index) ? 20 : 0) + (investigated&&explained(state,index)&&defended(state,index) ? 30 : 0) + (p.verified ? 20 : 0);
}
export function stage(state) {
  const p = progress(state);
  if (p.verified) return '검증 완료';
  const investigated=MISSIONS[state.active].evidence.every(key=>p.clues.includes(key));
  if(p.spatial&&p.observations.changed&&!p.spatial.rechecked&&revisitDevice(missionId(state)))return '장비 재확인 필요';
  if (investigated&&explained(state)&&defended(state)) return '방어 적용';
  if (investigated&&explained(state)) return '취약 상태 확인';
  if (p.clues.length) return '조사';
  return '준비';
}
export function applyAnswer(state, answer) {
  if (!Number.isInteger(answer) || answer < 0 || answer >= MISSIONS[state.active].answers.length) throw new Error('유효하지 않은 설명입니다.');
  progress(state).answer = answer;
  invalidateVerification(state);
}
export function applyPort(state, port, allowed) {
  if (missionId(state) !== 'services' || ![443, 8080].includes(port) || typeof allowed !== 'boolean') throw new Error('설정할 수 없는 포트입니다.');
  state.ports[port] = allowed;
  changeEnvironment(state);
  progress(state).clues = progress(state).clues.filter(key => key !== 'rescan');
}
export function applyLogin(state, policy) {
  if (missionId(state) !== 'login' || ![6, 12, 15].includes(policy.minLength) || typeof policy.blockCommon !== 'boolean' || typeof policy.limitAttempts !== 'boolean') throw new Error('유효하지 않은 정책입니다.');
  state.login = { ...policy };
  changeEnvironment(state);
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
  return missionId(state) === 'integrity' && ['baseline', 'hash', 'mismatch'].every(key => progress(state).clues.includes(key));
}
export function restoreFile(state, name) {
  if (missionId(state) !== 'integrity' || !Object.hasOwn(ORIGINAL_FILES, name)) throw new Error('내장 파일만 복구할 수 있습니다.');
  if (!canRestoreFiles(state)) throw new Error('먼저 inspect baseline으로 기준을 확인하고 hash files로 변경을 조사하세요.');
  progress(state).selectedFile = name;
  state.files[name] = ORIGINAL_FILES[name];
  changeEnvironment(state);
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
  for (let i = state.active; i < MISSIONS.length; i++) state.missions[i] = fresh.missions[i];
  if (MISSIONS.slice(state.active).some(m => m.id === 'services')) state.ports = fresh.ports;
  if (MISSIONS.slice(state.active).some(m => m.id === 'login')) state.login = fresh.login;
  if (MISSIONS.slice(state.active).some(m => m.id === 'integrity')) state.files = fresh.files;
}
export async function runCommand(state, input) {
  if (typeof input !== 'string' || !input.trim()) return '명령어를 입력하세요. help로 사용법을 확인할 수 있습니다.';
  if (input.length > 200) return '입력은 200자 이하여야 합니다.';
  const parts = input.trim().split(/\s+/);
  const [cmd, target, detail] = parts;
  const mission = MISSIONS[state.active];
  if (!mission.commands.includes(cmd)) return '알 수 없거나 이 미션에서 허용되지 않은 명령입니다. help를 확인하세요.';
  if (cmd === 'help' && parts.length === 1) {
    if (missionId(state) === 'tutorial') clue(state, 'help');
    return ['help', ...mission.quickCommands.filter(command => command !== 'help')].join(' / ');
  }
  if (cmd === 'inspect' && missionId(state) === 'tutorial' && target === 'approval' && parts.length === 2) {
    clue(state, 'approval');
    return '조사 승인서: club-server의 가상 서비스·더미 로그인·내장 파일만 조사합니다. 실제 IP·URL·외부 서버는 범위에 포함되지 않습니다.';
  }
  if (cmd === 'scan' && missionId(state) === 'services' && target === 'club-server' && parts.length === 2) {
    observe(state, { ...state.ports });
    clue(state, 'scan');
    if (defended(state)) clue(state, 'rescan');
    return [443, 8080].map(port => `${port} ${state.ports[port] ? 'OPEN' : 'FILTERED'} / ${port === 443 ? '필수 HTTPS 자료 서비스' : '사용하지 않는 관리 서비스'}`).join('\n');
  }
  if (cmd === 'inspect' && missionId(state) === 'services' && target === 'club-server' && ['443', '8080'].includes(detail) && parts.length === 3) {
    clue(state, `port-${detail}`);
    return detail === '443' ? '443: 동아리 자료를 제공하는 필수 웹 서비스. 운영 조건: 자료 열람을 유지하세요.' : '8080: 이전 관리용 서비스. 현재 사용하지 않으며 접근이 불필요합니다. 방화벽에서 접근을 차단해도 프로세스를 종료하는 것은 아닙니다.';
  }
  if (cmd === 'inspect' && missionId(state) === 'login' && target === 'login' && parts.length === 2) {
    clue(state, 'login');
    const result = loginSimulation(state.login);
    observe(state, { ...state.login });
    return `더미 후보 정책 검사:\n${COMMON_PASSWORDS.map(value => `${value}: ${accepted(value, state.login) ? '허용' : '거부'}`).join('\n')}\n연속 실패 기록:\n${result.attempts.map(a => `${a.attempt}회: ${a.result}`).join('\n')}\n모든 후보·로그인은 게임 데이터입니다.`;
  }
  if (cmd === 'inspect' && missionId(state) === 'integrity' && target === 'baseline' && parts.length === 2) {
    clue(state, 'baseline');
    return '기준 출처: 조사 승인 이전에 담당 교사가 보관한 오프라인 원본. 게임에서 이 기준은 변경할 수 없습니다. hash files로 내장 파일의 SHA-256과 비교하세요.';
  }
  if (cmd === 'hash' && missionId(state) === 'integrity' && target === 'files' && parts.length === 2) {
    const targetProgress = progress(state);
    const snapshot = { ...state.files };
    const hashes = await Promise.all(Object.keys(ORIGINAL_FILES).map(async name => {
      const [actual, expected] = await Promise.all([sha256(snapshot[name]), sha256(ORIGINAL_FILES[name])]);
      return { name, actual, expected, matches: actual === expected };
    }));
    if (progress(state) !== targetProgress || Object.keys(snapshot).some(name => snapshot[name] !== state.files[name])) return '계산 중 파일이 바뀌었습니다. hash files를 다시 실행하세요.';
    progress(state).hashes = hashes;
    progress(state).hashPending = false;
    observe(state, { matches: Object.fromEntries(hashes.map(row => [row.name, row.matches])) });
    if (!progress(state).verified) progress(state).checks = [];
    clue(state, 'hash');
    if (hashes.some(row => !row.matches)) clue(state, 'mismatch');
    return hashes.map(row => `${row.name}: ${row.matches ? '일치' : '변경 감지'}\n현재 ${row.actual}\n기준 ${row.expected}`).join('\n\n');
  }
  if (cmd === 'verify' && parts.length === 1) {
    const p = progress(state);
    if (!explained(state)) return answerFeedback(state)?.text ?? '먼저 관찰한 근거에 맞는 원인 설명을 선택하세요.';
    const checks = VERIFIERS[mission.id](state);
    if(p.spatial) {
      checks.push(['3D 조사 장비 확인',requiredDevices(mission.id).every(id=>p.spatial.inspected.includes(id))]);
      if(revisitDevice(mission.id))checks.push(['방어 후 현장 장비 재확인',p.observations.changed&&p.spatial.rechecked]);
    }
    p.checks = checks.map(([label, passed]) => ({ label, passed }));
    p.verified = checks.every(([, passed]) => passed);
    return `${p.checks.map(check => `${check.passed ? '통과' : '미충족'}: ${check.label}`).join('\n')}\n\n${p.verified ? '검증 완료! ' + mission.explanation : '아직 완료되지 않았습니다. 미충족 항목을 확인하고 다시 검증하세요.'}`;
  }
  return '게임 전용 문법과 대상만 허용됩니다. 실제 IP·URL은 사용할 수 없습니다. help를 확인하세요.';
}

const VERIFIERS = {
  tutorial: state => {
    const p = progress(state);
    return [['help 확인', p.clues.includes('help')], ['승인서 확인', p.clues.includes('approval')], ['조사 범위 선택', explained(state)]];
  },
  services: state => {
    const p = progress(state); observe(state, { ...state.ports });
    return [['서비스 단서 조사', p.clues.includes('scan') && p.clues.includes('port-8080')], ['8080 접근 차단', !state.ports[8080]], ['443 자료 서비스 정상', state.ports[443]], ['방어 후 다시 scan', p.clues.includes('rescan')]];
  },
  login: state => {
    const p = progress(state), result = loginSimulation(state.login); observe(state, { ...state.login });
    return [['더미 기록 조사', p.clues.includes('login')], ['최소 길이 15 이상', state.login.minLength >= 15], ['흔한 값 차단 정책', state.login.blockCommon && result.commonBlocked], ['정상 사용자 첫 로그인 성공', result.normal], ['연속 실패 3회 후 제한', state.login.limitAttempts && result.repeatedBlocked]];
  },
  integrity: state => {
    const p = progress(state);
    return [['신뢰 기준 확인', p.clues.includes('baseline')], ['변경 감지 기록', p.clues.includes('mismatch')], ['변경 파일 선택', p.selectedFile === 'budget.csv'], ['원본 파일 복구', defended(state)], ['복구 후 해시 재계산', p.hashes.length === Object.keys(ORIGINAL_FILES).length && p.hashes.every(row => row.matches)]];
  },
};

export function validateMissionDefinitions(missions) {
  const seen = new Set();
  for (const m of missions) {
    if (seen.has(m.id) || !Object.hasOwn(DEFENDERS, m.id) || !Object.hasOwn(VERIFIERS, m.id) || !m.clues || !m.quickCommands?.length || !m.hints?.length || m.answerFeedback?.length !== m.answers?.length || !Number.isInteger(m.correct) || m.correct < 0 || m.correct >= m.answers.length || !Array.isArray(m.evidence) || m.evidence.some(key => !m.clues[key]) || Object.values(m.clues).some(clue => !clue.label || !m.commands.includes(clue.command?.split(' ')[0])) || m.quickCommands.some(command => !m.commands.includes(command.split(' ')[0]))) throw new Error('Invalid mission definition: ' + m.id);
    seen.add(m.id);
  }
}
validateMissionDefinitions(MISSIONS);

export function nextAction(state) {
  const p = progress(state), m = MISSIONS[state.active];
  if (p.verified) return state.active < MISSIONS.length - 1
    ? { text: '검증을 통과했습니다. 다음 미션으로 이동하세요.', focus: 'next', label: '다음 미션으로' }
    : { text: '모든 미션을 완료했습니다. 아래 결과를 확인하세요.', focus: 'results', label: '완료 결과 보기' };
  if (m.id === 'integrity' && state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'] && !p.clues.includes('mismatch')) return { text: '현재 미션을 초기화한 뒤 기준과 변경을 다시 조사하세요.', focus: 'reset-mission', label: '초기화 위치로' };
  if(p.spatial) {
    const missingDevice=requiredDevices(m.id).find(id=>!p.spatial.inspected.includes(id));
    if(missingDevice)return {text:`현장 조사: ${DEVICES[missingDevice].label}에 접근해 E를 누르세요.`,device:missingDevice,label:'3D 현장으로'};
  }
  if(p.spatial&&p.observations.changed&&!p.spatial.rechecked&&revisitDevice(m.id))return {text:worldAction(state).text,device:revisitDevice(m.id),label:'3D 재확인으로'};
  const missing = m.evidence.find(key => !p.clues.includes(key));
  if (missing) return { text: '다음 조사: ' + m.clues[missing].label, command: m.clues[missing].command, label: m.clues[missing].command };
  if (!explained(state)) return { text: '조사 노트에서 근거에 맞는 원인 설명을 선택하세요.', focus: 'answer-0', label: '원인 설명으로' };
  if (!defended(state)) return { text: m.defenseGuidance, tab: 'settings', label: '방어 설정 열기' };
  if (m.id === 'services' && !p.clues.includes('rescan')) return { text: '변경한 접근 상태를 다시 조사하세요.', command: 'scan club-server', label: 'scan club-server' };
  if (m.id === 'integrity' && (p.hashes.length !== Object.keys(ORIGINAL_FILES).length || !p.hashes.every(row => row.matches))) return { text: '복구한 파일의 해시를 다시 계산하세요.', command: 'hash files', label: 'hash files' };
  return { text: '방어와 정상 기능을 함께 재검증하세요.', command: 'verify', label: '재검증 실행' };
}

// Read-only UX projections: no additional saved fields or mission rules.
export function worldAction(state) {
  const p=progress(state),id=missionId(state),devices=requiredDevices(id);
  if(p.verified)return {mode:'complete',device:null,text:'검증 완료 · 조사 노트에서 결과와 다음 미션을 확인하세요.'};
  if(!devices.length)return {mode:'tool',device:null,text:'조사 노트에서 현재 목표와 다음 행동을 확인하세요.'};
  const missing=devices.find(device=>!p.spatial?.inspected.includes(device));
  if(missing)return {mode:'inspect',device:missing,text:`${DEVICES[missing].label}에서 E로 ${id==='tutorial'?'승인서':'현장 근거'}를 확인하세요.`,reason:id==='tutorial'?'조사하기 전에 승인된 범위를 확인합니다.':id==='services'?'서버에서 노출 상태와 서비스 용도를 확인합니다.':id==='login'?'관제석에서 정상 로그인과 반복 실패를 함께 확인합니다.':missing==='INTERACT_FileCabinet'?'보관함의 승인 원본이 파일 비교의 기준입니다.':'분석 PC에서 현재 파일을 승인 원본과 비교합니다.'};
  const revisit=revisitDevice(id);
  if(p.observations.changed&&!p.spatial.rechecked&&revisit)return {mode:'recheck',device:revisit,text:`설정 변경으로 이전 관찰이 만료됐습니다. ${DEVICES[revisit].label}에서 E로 재확인하세요.`,reason:'F는 설정 도구입니다. 변경 결과는 현장에서 E로 확인합니다.'};
  const device=id==='services'?'INTERACT_Router':'INTERACT_AdminPC';
  const reason=id==='services'?'서버는 상태 확인, 방화벽은 접근 정책 변경을 담당합니다.':id==='integrity'?'보관함은 비교 기준, 분석 PC는 현재 파일의 검사·복구를 담당합니다.':id==='login'?'로그인 기록을 근거로 정책을 판단하고 변경합니다.':'E로 확보한 승인서를 조사 노트에서 읽고 판단합니다.';
  if(!explained(state))return {mode:'tool',device,text:`${DEVICES[device].label}에서 F · 조사 노트의 근거를 읽고 ${id==='tutorial'?'허용 범위를':'원인 설명을'} 선택하세요.`,reason};
  if(!defended(state))return {mode:'tool',device,text:`${DEVICES[device].label}에서 F · ${id==='integrity'?'파일 비교와 방어 설정':'방어 설정'}을 검토하세요.`,reason};
  return {mode:'verify',device,text:`${DEVICES[device].label}에서 F · 「현재 상태 재검증」으로 방어와 정상 기능을 함께 확인하세요.`,reason:id==='tutorial'?'승인된 조사 범위와 선택한 설명을 최종 검증합니다.':'현장 확인만으로 완료되지 않습니다. 정상 기능 유지도 검증합니다.'};
}
function fieldFindings(state,device) {
  const p=progress(state),id=missionId(state),before=p.observations.before,changed=p.observations.changed;
  const transition=(previous,current)=>changed&&previous!=null&&previous!==current?`${previous} → ${current}`:current;
  if(id==='tutorial')return ['조사 승인서 · club-server의 내장 가상 데이터만 조사','E로 근거를 확보하고 F로 판단·설정 도구를 엽니다.'];
  if(id==='services')return [443,8080].map(port=>`${port} ${transition(before?.[port]===undefined?null:before[port]?'OPEN':'FILTERED',state.ports[port]?'OPEN':'FILTERED')} · ${port===443?(state.ports[port]?'자료 열람 가능':'자료 열람 불가'):(state.ports[port]?'사용하지 않는 관리 접근 허용':'관리 접근 차단')}`);
  if(id==='login') {
    const r=loginSimulation(state.login),old=before?loginSimulation(before):null;
    const allowed=COMMON_PASSWORDS.filter(value=>accepted(value,state.login)).length;
    return [`정상 더미 로그인 · ${transition(old?old.normal?'성공':'거부':null,r.normal?'성공':'거부')}`,`반복 실패 · ${transition(old?old.repeatedBlocked?'제한됨':'무제한':null,r.repeatedBlocked?'제한됨':'무제한')}`,`흔한 더미 후보 ${allowed}/${COMMON_PASSWORDS.length}개 허용 · 최소 길이 ${state.login.minLength}자`];
  }
  if(device==='INTERACT_FileCabinet')return ['승인된 오프라인 원본이 비교 기준입니다.','관제 / 분석 PC에서 현재 파일을 이 기준과 비교하세요.'];
  return p.hashes.map(row=>`${row.name} · ${transition(before?.matches?.[row.name]===undefined?null:before.matches[row.name]?'승인 기준과 일치':'승인 기준과 불일치',row.matches?'승인 기준과 일치':'승인 기준과 불일치')}`);
}
export async function inspectDevice(state,device) {
  if(!Object.hasOwn(DEVICES,device))throw new Error('알 수 없는 실습 장비입니다.');
  const p=progress(state),id=missionId(state),commands=deviceCommands(id,device);
  if(!commands.length) {
    const next=worldAction(state).text,status='현재 사건 조사 대상 아님',findings=[device==='INTERACT_Router'&&id==='services'?'이 장비는 F로 접근 정책을 편집하는 곳입니다.':'이 장비에서는 현재 사건의 단서를 얻지 않습니다.'];
    return {device,label:DEVICES[device].label,status,findings,next,recorded:false,text:[status,...findings,'다음: '+next].join('\n'),tone:'neutral'};
  }
  // Old completed saves stay completed. New field is opt-in on actual inspection.
  if(!p.verified)p.spatial??={inspected:[],rechecked:false};
  for(const command of commands)await runCommand(state,command);
  if(progress(state)!==p)throw new Error('미션이 변경되었습니다. 다시 조사하세요.');
  if(p.spatial) {
    if(!p.spatial.inspected.includes(device))p.spatial.inspected.push(device);
    if(p.observations.changed&&device===revisitDevice(id))p.spatial.rechecked=true;
  }
  const informational=id==='tutorial'||id==='integrity'&&device==='INTERACT_FileCabinet';
  const ok=defended(state),rechecked=p.observations.changed&&device===revisitDevice(id);
  const status=rechecked?'변경 후 현장 재확인 · '+(ok?'정상 동작 확인':'문제 남음'):'현장 조사 완료';
  const findings=fieldFindings(state,device),next=worldAction(state).text;
  const evidence=MISSIONS[state.active].evidence;
  return {device,label:DEVICES[device].label,status,findings,next,recorded:true,evidenceFound:evidence.filter(key=>p.clues.includes(key)).length,evidenceTotal:evidence.length,text:[status,...findings,'현장 단서가 조사 노트에 기록되었습니다.','다음: '+next].join('\n'),tone:informational?'neutral':ok?'normal':'warning'};
}

export function continueWithout3D(state) {
  const p=progress(state);if(!p.spatial||p.verified)return false;
  delete p.spatial;p.checks=[];
  return true;
}

export function worldDevices(state) {
  const id=missionId(state),p=progress(state),action=worldAction(state);
  return Object.fromEntries(Object.keys(DEVICES).map(device=>{
    const relevant=deviceCommands(id,device).length>0,inspected=p.spatial?.inspected.includes(device);
    let text='현재 사건 조사 대상 아님',tone='neutral';
    if(relevant) {
      text='E · 현장 조사 필요';
      if(p.verified&&!p.spatial){text='기존 완료 기록 유지\nE · 현재 상태 관찰';tone='normal';}
      if(inspected) {
        const pending=p.observations.changed&&!p.spatial.rechecked&&device===revisitDevice(id);
        const informational=id==='tutorial'||id==='integrity'&&device==='INTERACT_FileCabinet';
        text=pending?'이전 관찰 만료\n설정 변경됨 · E 재확인':p.spatial.rechecked?'현장 재확인 완료':'현장 단서 확보';
        tone=pending?'pending':informational?'neutral':defended(state)?'normal':'warning';
        if(!pending&&id==='services')text+=`\n443 ${state.ports[443]?'OPEN':'FILTERED'} / 8080 ${state.ports[8080]?'OPEN':'FILTERED'}`;
        if(!pending&&id==='login'){const r=loginSimulation(state.login);text+=`\n정상 로그인 ${r.normal?'성공':'거부'}\n반복 실패 ${r.repeatedBlocked?'제한됨':'무제한'}`;}
        if(!pending&&id==='integrity'&&device==='INTERACT_AdminPC')text+=`\n해시 ${p.hashes.length?p.hashes.filter(row=>!row.matches).length+'개 불일치':'재계산 필요'}`;
      }
    } else if(device==='INTERACT_Router'&&id==='services')text='서비스 접근 정책\nF · 접근 정책 편집';
    return [device,{label:DEVICES[device].label,text,tone,objective:action.device===device,action:action.device===device?`${['tool','verify'].includes(action.mode)?'F':'E'} · ${action.mode==='recheck'?'변경 결과 재확인':action.mode==='verify'?'최종 검증':action.mode==='tool'?deviceTool(id,device).label:deviceTask(id,device)}`:'',zone:DEVICES[device].zone}];
  }));
}


export function equipmentStatus(state) {
 const p=progress(state),m=MISSIONS[state.active],r=loginSimulation(state.login);
 return {mission:m.id,title:m.title,active:state.active,ports:{...state.ports},login:{minLength:state.login.minLength,normal:r.normal,limited:r.repeatedBlocked,commonAllowed:COMMON_PASSWORDS.filter(v=>accepted(v,state.login)).length,adequate:state.login.minLength>=15&&state.login.blockCommon&&state.login.limitAttempts},hashes:p.hashes.map(({name,matches})=>({name,matches})),restored:state.files['budget.csv']===ORIGINAL_FILES['budget.csv'],changed:p.observations.changed,inspected:Boolean(p.spatial?.inspected.length),rechecked:Boolean(p.spatial?.rechecked),verified:p.verified};
}
