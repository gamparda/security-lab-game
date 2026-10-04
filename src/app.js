import { MISSIONS, ORIGINAL_FILES } from './missions.js';
import { initialState, progress, stage, score, runCommand, answerFeedback, accepted, loginSimulation, applyAnswer, applyPort, applyLogin, canRestoreFiles, restoreFile, nextMission, resetMission } from './engine.js';
import { createSaveSession, CURRENT_SAVE_KEY, SAVE_KEY, exportGame, importGame, MAX_IMPORT_BYTES } from './storage.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
let state = initialState();
let busy = false;
let resetKind = null;
let storage = null;
let session = null;
let hashRetryNeeded = false;
let saveNotice = '';
let pendingSaves = 0;
const hashRetryNotice = '진행은 복원했지만 해시 계산을 완료하지 못했습니다. hash files를 다시 실행한 뒤 현재 상태를 재검증하세요.';
const blockedNotices = {
  preserved: '저장 데이터가 손상되었거나 지원하지 않는 형식입니다. 원본을 보존했습니다. 자동 저장을 중단합니다.',
  unavailable: '이 브라우저에서는 안전한 자동 저장을 사용할 수 없습니다. 진행 내보내기로 보관하세요.',
  conflict: '다른 탭에서 진행이 변경됐습니다. 최신 진행 불러오기를 눌러주세요. 현재 탭은 저장하지 않습니다.',
};
function renderNotice() {
  $('notice').textContent = [saveNotice, hashRetryNeeded ? hashRetryNotice : ''].filter(Boolean).join('\n');
  $('reload-progress').hidden = session?.blocked !== 'conflict';
  $('save-status').textContent = pendingSaves ? '저장 중…' : saveNotice ? '자동 저장 확인 필요' : '이 브라우저에 자동 저장';
}
try {
  storage = window.localStorage;
  session = await createSaveSession(storage);
  state = session.state;
  hashRetryNeeded = session.hashRetryNeeded === true;
  saveNotice = blockedNotices[session.blocked] ?? '';
} catch { storage = null; saveNotice = blockedNotices.unavailable; }
function clearHashRetryNotice() {
  hashRetryNeeded = false;
  renderNotice();
}
async function persist() {
  if (!session) return;
  pendingSaves++; renderNotice();
  try { await session.save(state); saveNotice = ''; }
  catch (error) {
    saveNotice = blockedNotices[error.code] ?? '저장에 실패했습니다. 현재 플레이는 유지됩니다. 진행 내보내기로 보관하세요.';
  }
  pendingSaves--; renderNotice();
}
window.addEventListener('storage', event => {
  if (!session || ![CURRENT_SAVE_KEY, SAVE_KEY].includes(event.key) && event.key !== null) return;
  if (session.changed()) { saveNotice = blockedNotices.conflict; renderNotice(); }
});
$('reload-progress').addEventListener('click', () => location.reload());
$('export-progress').addEventListener('click', () => {
  const address = URL.createObjectURL(new Blob([exportGame(state)], { type: 'application/json' }));
  const link = el('a'); link.href = address; link.download = 'SecurityLab-progress.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
});
let importPending = null, importAttempt = 0;
$('import-progress').addEventListener('click', () => {
  if (busy) return;
  importPending = null; importAttempt++;
  $('progress-file').value = ''; $('progress-file').disabled = false;
  $('import-message').textContent = ''; $('confirm-import').disabled = true;
  $('import-dialog').returnValue = '';
  $('import-dialog').showModal();
});
$('progress-file').addEventListener('change', async () => {
  const attempt = ++importAttempt;
  importPending = null; $('confirm-import').disabled = true;
  const file = $('progress-file').files[0];
  if (!file) return;
  $('import-message').textContent = '진행을 확인하고 있습니다.';
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('진행 파일 크기는 128KiB 이하여야 합니다.');
    let timer;
    const loaded = await Promise.race([
      importGame(await file.text()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('진행 확인 시간이 초과됐습니다. 다시 선택해 주세요.')), 10000); }),
    ]).finally(() => clearTimeout(timer));
    if (attempt !== importAttempt || !$('import-dialog').open) return;
    importPending = loaded;
    $('import-message').textContent = MISSIONS[loaded.state.active].title + ' · 진행 확인 완료';
    $('confirm-import').disabled = false;
  } catch (error) { if (attempt === importAttempt) $('import-message').textContent = error.message; }
});
$('import-dialog').addEventListener('close', async () => {
  importAttempt++;
  if ($('import-dialog').returnValue !== 'confirm' || !importPending) return;
  busy = true; pendingSaves++; render(); renderNotice();
  try {
    if (!session) throw new Error('안전한 저장을 사용할 수 없어 가져오기를 중단했습니다.');
    await session.save(importPending.state, { backup: true, replacePreserved: true });
    state = importPending.state; hashRetryNeeded = importPending.hashRetryNeeded === true;
    saveNotice = ''; $('transfer-status').textContent = '진행을 가져왔습니다. 이전 저장은 백업했습니다.';
    $('terminal').replaceChildren(); log(MISSIONS[state.active].objective); switchTab('terminal');
  } catch (error) {
    $('transfer-status').textContent = blockedNotices[error.code] ?? '가져오기에 실패했습니다. 현재 진행을 유지합니다. ' + error.message;
  } finally { busy = false; pendingSaves--; render(); renderNotice(); $('command').focus(); }
});
renderNotice();
function log(text, type = 'output') {
  const row = el('pre', text, type);
  $('terminal').append(row);
  while ($('terminal').children.length > 100) $('terminal').firstChild.remove();
  $('terminal').scrollTop = $('terminal').scrollHeight;
}
function switchTab(name) {
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $('panel-' + tab.dataset.tab).hidden = !selected;
  }
}
const clueNames = { help: '게임 명령 사용법', approval: '승인된 조사 범위', scan: '서비스 포트 목록', 'port-443': '자료 서비스 운영 조건', 'port-8080': '관리 서비스가 불필요함', rescan: '방어 후 포트 재조회', login: '더미 후보와 시도 기록', baseline: '승인된 오프라인 기준', hash: 'SHA-256 비교 결과', mismatch: 'budget.csv 변경 감지' };
function render() {
  const focused = document.activeElement;
  const m = MISSIONS[state.active], p = progress(state);
  $('mission-nav').replaceChildren(...MISSIONS.map((mission, i) => {
    const item = el('div', undefined, `mission-step ${i === state.active ? 'active' : ''} ${state.missions[i].verified ? 'complete' : ''}`);
    item.append(el('span', state.missions[i].verified ? '✓' : String(i).padStart(2, '0')), el('strong', mission.title), el('small', state.missions[i].verified ? '검증 완료' : i === state.active ? '진행 중' : '대기'));
    if (i === state.active) item.setAttribute('aria-current', 'step');
    return item;
  }));
  $('mission-number').textContent = `${state.active === 0 ? 'TUTORIAL' : 'MISSION 0' + state.active} / ${m.duration}`;
  $('mission-title').textContent = m.title;
  $('mission-subtitle').textContent = m.subtitle;
  $('boundary').textContent = m.boundary;
  $('objective').textContent = m.objective;
  $('stage').textContent = stage(state);
  $('score').textContent = score(state) + ' / 100';
  $('clues').replaceChildren(...(p.clues.length ? p.clues.map(key => el('li', '✓ ' + clueNames[key])) : [el('li', '아직 확보한 단서가 없습니다.', 'muted')]));
  $('answer-label').textContent = state.active === 0 ? '허용된 조사 범위 선택' : '근거에 맞는 원인 설명 선택';
  $('answers').replaceChildren($('answer-label'), ...m.answers.map((answer, i) => {
    const label = el('label');
    const radio = el('input');
    radio.type = 'radio'; radio.name = 'answer'; radio.id = 'answer-' + i; radio.value = i; radio.checked = p.answer === i;
    radio.disabled = busy;
    radio.addEventListener('change', () => { applyAnswer(state, i); persist(); render(); });
    label.append(radio, el('span', answer));
    return label;
  }));
  const feedback = answerFeedback(state);
  $('answer-feedback').hidden = !feedback;
  $('answer-feedback').textContent = feedback?.text ?? '';
  $('answer-feedback').className = 'answer-feedback ' + (feedback?.status === 'supported' ? 'success' : 'warning');
  $('hint').textContent = `힌트 보기 (${p.hint}/3)`;
  $('hint-copy').textContent = p.hint ? m.hints[p.hint - 1] : '개념 → 확인할 위치 → 다음 행동 순서로 안내합니다.';
  $('next').hidden = !p.verified || state.active === 3;
  $('verify').disabled = busy;
  $('next').disabled = busy;
  $('hint').disabled = busy || p.hint === 3;
  $('reset-mission').disabled = busy;
  $('reset-all').disabled = busy;
  renderSettings(); renderFiles(); renderComparison(); renderResults();
  const commands = [ ['help', 'inspect approval', 'verify'], ['scan club-server', 'inspect club-server 443', 'inspect club-server 8080', 'verify'], ['inspect login', 'verify'], ['inspect baseline', 'hash files', 'verify'] ][state.active];
  $('quick-commands').replaceChildren(...commands.map(command => {
    const button = el('button', command); button.disabled = busy;
    button.addEventListener('click', () => execute(command)); return button;
  }));
  if (!focused.isConnected && focused.id) {
    const replacement = $(focused.id);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  }
}
function renderSettings() {
  const container = $('settings'); container.replaceChildren();
  if (state.active === 1) {
    container.append(el('h3', '가상 방화벽 정책'), el('p', '자료 서비스(443)를 유지하면서 불필요한 관리 접근만 제한하세요. 설정 변경 후 다시 scan하고 재검증하세요.', 'muted'));
    for (const port of [443, 8080]) {
      const row = el('div', undefined, 'setting-row');
      const label = el('label', `${port} / ${port === 443 ? 'HTTPS 자료 서비스 · 필수' : '이전 관리 서비스 · 사용 안 함'}`);
      const select = el('select'); select.id = 'port-' + port; label.htmlFor = select.id; select.disabled = busy;
      for (const [value, text] of [['allow', '접근 허용'], ['block', '접근 차단']]) { const option = el('option', text); option.value = value; select.append(option); }
      select.value = state.ports[port] ? 'allow' : 'block';
      select.addEventListener('change', () => { applyPort(state, port, select.value === 'allow'); persist(); render(); });
      row.append(label, select); container.append(row);
    }
    container.append(el('p', '이 설정은 실제 방화벽을 변경하지 않습니다.', 'muted'));
  } else if (state.active === 2) {
    container.append(el('h3', '더미 로그인 정책'), el('p', '후보는 내장된 가상 값입니다. 실제 계정이나 비밀번호는 입력하지 마세요.', 'muted'));
    const row = el('div', undefined, 'setting-row');
    const label = el('label', '최소 비밀번호 길이'); label.htmlFor = 'min-length';
    const select = el('select'); select.id = 'min-length'; select.disabled = busy;
    for (const n of [6, 12, 15]) { const option = el('option', n + '자'); option.value = n; select.append(option); }
    select.value = state.login.minLength;
    select.addEventListener('change', () => { applyLogin(state, { ...state.login, minLength: Number(select.value) }); persist(); render(); });
    row.append(label, select); container.append(row);
    for (const [key, title] of [['blockCommon', '흔한 값 차단 목록 적용'], ['limitAttempts', '연속 실패 3회 후 시도 제한']]) {
      const row = el('label', undefined, 'checkbox-row'); const input = el('input');
      input.type = 'checkbox'; input.id = key; input.checked = state.login[key]; input.disabled = busy;
      input.addEventListener('change', () => { applyLogin(state, { ...state.login, [key]: input.checked }); persist(); render(); });
      row.append(input, el('span', title)); container.append(row);
    }
    container.append(el('p', '숫자·기호의 혼합을 일률적으로 강제하지 않습니다. 시도 제한 수치는 이 게임의 예시이며 실제 서비스에서는 위험에 맞게 설계합니다.', 'muted'));
  } else if (state.active === 3) {
    const ready = canRestoreFiles(state);
    const restoredBeforeInvestigation = state.files['budget.csv'] === ORIGINAL_FILES['budget.csv'] && !progress(state).clues.includes('mismatch');
    const guidance = el('p', restoredBeforeInvestigation
      ? '변경 확인 전에 복구된 저장입니다. 「현재 미션 초기화」로 이 미션을 다시 시작하고 기준과 변경을 조사하세요. 앞 미션의 진행은 유지됩니다.'
      : ready ? '변경을 확인했습니다. 파일을 선택해 원본으로 복구한 다음 hash files로 다시 비교하세요.'
      : '먼저 inspect baseline으로 기준 출처를 확인하고 hash files로 변경된 파일을 찾으세요.', restoredBeforeInvestigation ? 'warning' : 'muted');
    guidance.id = 'restore-guidance'; guidance.setAttribute('role', 'status');
    container.append(el('h3', '신뢰 가능한 원본으로 복구'), guidance);
    for (const name of Object.keys(ORIGINAL_FILES)) {
      const button = el('button', name + ' 선택 및 복구'); button.id = 'restore-' + name; button.disabled = busy || !ready; button.dataset.restore = name;
      button.addEventListener('click', () => { restoreFile(state, name); log(name + '를 승인된 원본으로 복구했습니다. hash files로 다시 비교하세요.'); persist(); render(); });
      container.append(button);
    }
    if (progress(state).selectedFile) container.append(el('p', '선택한 파일: ' + progress(state).selectedFile));
  } else container.append(el('p', '튜토리얼에서는 승인서를 조사하고 옆 패널에서 허용된 범위를 선택하세요.'));
  const p = progress(state);
  const status = el('p', p.checks.length
    ? p.verified ? '현재 상태의 재검증을 통과했습니다.' : '현재 상태에 미충족 항목이 있습니다. 아래 결과를 확인하고 다시 검증하세요.'
    : '현재 상태는 재검증이 필요합니다. 설명과 방어 설정을 확인한 뒤 「현재 상태 재검증」을 실행하세요.', 'muted');
  status.id = 'verification-status'; status.setAttribute('role', 'status');
  container.append(el('h3', p.checks.length ? '현재 상태의 재검증 결과' : '현재 상태 재검증'), status);
  if (p.checks.length) {
    for (const check of p.checks) container.append(el('p', `${check.passed ? '✓ 통과' : '△ 미충족'} · ${check.label}`, check.passed ? 'success' : 'warning'));
  }
}
function renderFiles() {
  $('files').replaceChildren();
  if (state.active !== 3) { $('files').append(el('p', '미션 3에서 내장 파일의 SHA-256을 비교합니다.', 'muted')); return; }
  if (!progress(state).hashes.length) { $('files').append(el('p', '아직 계산 결과가 없습니다. 터미널에서 hash files를 실행하세요.')); return; }
  for (const row of progress(state).hashes) {
    const card = el('article', undefined, 'file-card');
    card.append(el('h3', row.name), el('p', row.matches ? '✓ 일치' : '△ 변경 감지', row.matches ? 'success' : 'warning'), el('p', '현재 SHA-256', 'muted'), el('code', row.actual), el('p', '신뢰 기준 SHA-256', 'muted'), el('code', row.expected));
    $('files').append(card);
  }
}
function renderComparison() {
  const container = $('comparison'), p = progress(state), observations = p.observations;
  container.replaceChildren();
  if (state.active === 0) { container.append(el('p', '다음 미션부터 조사한 결과와 방어 이후의 변화를 비교합니다.', 'muted')); return; }
  const after = state.active === 3 && p.hashPending ? null : observations.after;
  const guidance = [null, 'scan club-server로 접근 상태를 조사하세요. 설정을 바꾼 뒤 다시 scan하고 자료 서비스도 재검증하세요.', 'inspect login으로 후보와 시도 기록을 조사하세요. 정책을 바꾼 뒤 다시 inspect login하거나 현재 상태를 재검증하세요.', 'hash files의 실제 계산 결과를 기록합니다. 복구 후에는 해시를 다시 계산해야 비교할 수 있습니다.'][state.active];
  container.append(el('h3', '방어 전후 관찰 기록'), el('p', guidance, 'muted'));
  const status = el('p', p.verified ? '방어와 정상 기능의 재검증을 모두 통과했습니다.' : '관찰 결과와 미션 완료는 별도로 확인합니다. 원인 설명과 현재 상태 재검증을 마치세요.', 'muted');
  status.id = 'comparison-status'; container.append(status);
  let labels;
  function values(snapshot) {
    if (!snapshot) return null;
    if (state.active === 1) return [snapshot[443] ? '접근 허용 · 정상' : '접근 차단 · 열람 불가', snapshot[8080] ? '접근 허용' : '접근 차단'];
    if (state.active === 2) {
      const result = loginSimulation(snapshot);
      return [snapshot.minLength + '자', snapshot.blockCommon ? '적용' : '미적용', accepted('school-club-password', snapshot) ? '허용' : '거부', result.attempts[3].result, result.normal ? '성공' : '실패'];
    }
    return Object.keys(ORIGINAL_FILES).map(name => snapshot.matches[name] ? '일치' : '변경 감지');
  }
  if (state.active === 1) labels = ['443 자료 서비스', '8080 관리 서비스'];
  if (state.active === 2) labels = ['최소 길이', '흔한 값 차단 목록', '긴 흔한 후보: school-club-password', '반복 실패 4회차', '정상 사용자 첫 로그인'];
  if (state.active === 3) labels = Object.keys(ORIGINAL_FILES);
  const beforeValues = values(observations.before), afterValues = values(after);
  const table = el('table');
  const caption = el('caption', '조사 당시 기록 비교'); table.append(caption);
  const head = el('thead'), heading = el('tr');
  for (const label of ['확인 항목', '방어 전 조사', '변경 후 확인']) { const cell = el('th', label); cell.scope = 'col'; heading.append(cell); }
  head.append(heading); table.append(head);
  const body = el('tbody');
  labels.forEach((label, i) => {
    const row = el('tr'), title = el('th', label); title.scope = 'row';
    row.append(title, el('td', beforeValues?.[i] ?? '조사 기록 없음'), el('td', afterValues?.[i] ?? (observations.changed ? '다시 조사 필요' : '방어 적용 전')));
    body.append(row);
  });
  table.append(body); container.append(table);
  if (!observations.before) container.append(el('p', '설정을 바꾸기 전에 조사하면 방어 전 기록도 남습니다.', 'muted'));
  if (state.active === 3) container.append(el('p', '해시 불일치는 변경을 뜻합니다. 악성 여부나 작성자의 신원을 판정하지 않습니다.', 'muted'));
}
function renderResults() {
  $('results').hidden = !state.missions.every(p => p.verified);
  if ($('results').hidden) return;
  $('result-list').replaceChildren(...MISSIONS.map((m, i) => {
    const card = el('article');
    card.append(el('h3', `${m.title} · ${score(state, i)}/100`), el('p', m.explanation), el('p', `사용한 힌트: ${state.missions[i].hint}/3 단계`, 'muted'));
    return card;
  }));
}
async function execute(input) {
  if (busy) return;
  switchTab('terminal');
  busy = true; $('command').disabled = true; $('command-form').querySelector('button').disabled = true; render();
  log('❯ ' + input, 'input-line');
  try {
    log(await runCommand(state, input));
    if (hashRetryNeeded && progress(state).hashes.length) clearHashRetryNotice();
    await persist();
  }
  catch (error) { log('처리 안내: ' + error.message); }
  finally { busy = false; $('command').disabled = false; $('command-form').querySelector('button').disabled = false; render(); $('command').focus(); }
}
$('command-form').addEventListener('submit', event => { event.preventDefault(); const input = $('command').value; $('command').value = ''; execute(input); });
$('verify').addEventListener('click', () => execute('verify'));
$('next').addEventListener('click', () => {
  if (busy || !nextMission(state)) return;
  $('terminal').replaceChildren(); log('새 미션: ' + MISSIONS[state.active].objective); switchTab('terminal'); persist(); render(); $('command').focus();
});
$('hint').addEventListener('click', () => { if (progress(state).hint < 3) progress(state).hint++; persist(); render(); });
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[data-tab]')], i = tabs.indexOf(tab);
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(i + direction + tabs.length) % tabs.length];
    switchTab(next.dataset.tab); next.focus();
  });
}
for (const kind of ['mission', 'all']) $('reset-' + kind).addEventListener('click', () => {
  if (busy) return;
  resetKind = kind;
  $('reset-title').textContent = kind === 'all' ? '전체 진행을 초기화할까요?' : '현재 미션을 초기화할까요?';
  $('reset-description').textContent = kind === 'all' ? '모든 미션의 정책, 단서, 점수, 힌트 사용 기록이 처음으로 돌아갑니다.' : '현재와 이후 미션의 정책, 단서, 점수, 힌트 사용 기록이 원본으로 돌아갑니다.';
  $('reset-dialog').returnValue = '';
  $('reset-dialog').showModal();
});
$('reset-dialog').addEventListener('close', () => {
  if ($('reset-dialog').returnValue !== 'confirm') return;
  if (resetKind === 'all') state = initialState(); else resetMission(state);
  clearHashRetryNotice();
  $('terminal').replaceChildren(); log('초기화했습니다. help로 다시 시작하세요.'); persist(); render(); switchTab('terminal');
});
render();
log('SECURITY LAB / 가상 조사 환경에 오신 것을 환영합니다.\n' + MISSIONS[state.active].objective + '\nhelp로 게임 명령을 확인하세요.');
