import { MISSIONS, ORIGINAL_FILES } from './missions.js';
import { initialState, progress, stage, score, runCommand, applyAnswer, applyPort, applyLogin, restoreFile, nextMission, resetMission } from './engine.js';
import { loadGame, saveGame } from './storage.js';

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
try { storage = window.localStorage; } catch { /* 저장 불가 환경에서도 플레이 가능 */ }
if (storage) {
  try {
    const loaded = await loadGame(storage);
    state = loaded.state;
    if (loaded.recovered) $('notice').textContent = '저장 데이터가 손상되었거나 버전이 달라 진행을 초기화했습니다.';
  } catch { storage = null; }
}
if (!storage) $('notice').textContent = '이 브라우저에서는 저장을 사용할 수 없습니다. 현재 화면에서 계속 플레이할 수 있습니다.';
function persist() {
  if (!storage) return;
  try { saveGame(state, storage); } catch { $('notice').textContent = '저장에 실패했습니다. 현재 플레이는 유지되지만 새로고침하면 진행을 잃을 수 있습니다.'; }
}
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
    radio.type = 'radio'; radio.name = 'answer'; radio.value = i; radio.checked = p.answer === i;
    radio.disabled = busy;
    radio.addEventListener('change', () => { applyAnswer(state, i); persist(); render(); });
    label.append(radio, el('span', answer));
    return label;
  }));
  $('hint').textContent = `힌트 보기 (${p.hint}/3)`;
  $('hint-copy').textContent = p.hint ? m.hints[p.hint - 1] : '개념 → 확인할 위치 → 다음 행동 순서로 안내합니다.';
  $('next').hidden = !p.verified || state.active === 3;
  $('verify').disabled = busy;
  $('next').disabled = busy;
  $('hint').disabled = busy || p.hint === 3;
  $('reset-mission').disabled = busy;
  $('reset-all').disabled = busy;
  renderSettings(); renderFiles(); renderResults();
  const commands = [ ['help', 'inspect approval', 'verify'], ['scan club-server', 'inspect club-server 443', 'inspect club-server 8080', 'verify'], ['inspect login', 'verify'], ['inspect baseline', 'hash files', 'verify'] ][state.active];
  $('quick-commands').replaceChildren(...commands.map(command => {
    const button = el('button', command); button.disabled = busy;
    button.addEventListener('click', () => execute(command)); return button;
  }));
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
    container.append(el('h3', '신뢰 가능한 원본으로 복구'), el('p', '먼저 hash files로 변경을 확인하세요. 파일을 선택하고 원본으로 복구한 다음 다시 해시를 계산하세요.', 'muted'));
    for (const name of Object.keys(ORIGINAL_FILES)) {
      const button = el('button', name + ' 선택 및 복구'); button.disabled = busy; button.dataset.restore = name;
      button.addEventListener('click', () => { restoreFile(state, name); log(name + '를 승인된 원본으로 복구했습니다. hash files로 다시 비교하세요.'); persist(); render(); });
      container.append(button);
    }
    if (progress(state).selectedFile) container.append(el('p', '선택한 파일: ' + progress(state).selectedFile));
  } else container.append(el('p', '튜토리얼에서는 승인서를 조사하고 옆 패널에서 허용된 범위를 선택하세요.'));
  if (progress(state).checks.length) {
    container.append(el('h3', '최근 재검증 결과'));
    for (const check of progress(state).checks) container.append(el('p', `${check.passed ? '✓ 통과' : '△ 미충족'} · ${check.label}`, check.passed ? 'success' : 'warning'));
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
  try { log(await runCommand(state, input)); persist(); }
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
  $('reset-dialog').showModal();
});
$('reset-dialog').addEventListener('close', () => {
  if ($('reset-dialog').returnValue !== 'confirm') return;
  if (resetKind === 'all') state = initialState(); else resetMission(state);
  $('terminal').replaceChildren(); log('초기화했습니다. help로 다시 시작하세요.'); persist(); render(); switchTab('terminal');
});
render();
log('SECURITY LAB / 가상 조사 환경에 오신 것을 환영합니다.\n' + MISSIONS[state.active].objective + '\nhelp로 게임 명령을 확인하세요.');
