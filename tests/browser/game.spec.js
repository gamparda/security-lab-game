import { test, expect } from '@playwright/test';
import { initialState, progress, runCommand, applyAnswer, applyPort, applyLogin, restoreFile, nextMission } from '../../src/engine.js';
import { saveGame, SAVE_KEY, CURRENT_SAVE_KEY, BACKUP_KEY, exportGame } from '../../src/storage.js';
import { ORIGINAL_FILES } from '../../src/missions.js';

test('두 탭의 오래된 진행은 전체 초기화 뒤에도 자동 저장을 덮어쓰지 않음', async ({ page, context }) => {
  await seedGame(page, await missionState(1));
  const other = await context.newPage(); await other.goto('/');
  await expect(other.locator('#mission-title')).toHaveText('노출된 서비스');
  await page.locator('#reset-all').click();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(other.locator('#notice')).toContainText('다른 탭');
  await other.locator('#hint').click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).game.active, CURRENT_SAVE_KEY)).toBe(0);
  await other.locator('#reload-progress').click();
  await expect(other.locator('#mission-title')).toHaveText('조사 준비');
});

test('저장 실패 후 정상 저장은 실패 안내를 해제함', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#game')).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      Storage.prototype.setItem = original;
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await page.locator('#hint').click();
  await expect(page.locator('#notice')).toContainText('저장에 실패');
  await page.locator('#hint').click();
  await expect(page.locator('#notice')).toBeEmpty();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).game.missions[0].hint, CURRENT_SAVE_KEY)).toBe(2);
});

test('시작 스크립트가 차단돼도 오류 정보와 복사·재시도 수단이 표시됨', async ({ page }) => {
  let requests = 0;
  await page.route('**/src/bootstrap.js*', route => { requests++; return route.abort(); });
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#loading-retry')).toBeVisible();
  await page.locator('#loading-error summary').click();
  await expect(page.locator('#loading-detail')).toHaveValue(/src\/bootstrap.js/);
  await expect(page.locator('#copy-startup-error')).toBeVisible();
  expect(requests).toBe(2);
  await page.unroute('**/src/bootstrap.js*');
  await page.locator('#loading-retry').click();
  await expect(page.locator('#game')).toBeVisible();
});

test('시작 스크립트 무응답은 두 번의 제한 시간 뒤 끝나고 늦은 파일은 실행하지 않음', async ({ page }) => {
  let release, first, second, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const firstRequest = new Promise(resolve => { first = resolve; });
  const secondRequest = new Promise(resolve => { second = resolve; });
  await page.clock.install();
  await page.route('**/src/bootstrap.js*', async route => {
    if (++requests === 1) first(); else second();
    await gate; await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' }); await firstRequest;
    await page.clock.fastForward(8001); await secondRequest;
    await page.clock.fastForward(8001);
    await expect(page.locator('#loading-screen')).toHaveAttribute('aria-busy', 'false');
    release();
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#loading-retry')).toBeVisible();
  } finally { release(); }
});

test('클립보드가 막혀도 오류 텍스트를 선택해 복사할 수 있음', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await page.route('**/src/style.css*', route => route.abort());
  await page.goto('/');
  await page.locator('#loading-error summary').click();
  await page.locator('#copy-startup-error').click();
  await expect(page.locator('#loading-detail')).toBeFocused();
  await expect(page.locator('#copy-startup-error')).toContainText('텍스트 선택됨');
  expect(await page.locator('#loading-detail').evaluate(field => field.selectionEnd - field.selectionStart)).toBeGreaterThan(10);
});

test('진행 내보내기·가져오기는 검증과 백업 후 다른 저장 위치에서도 복원함', async ({ page }) => {
  const state = await missionState(1);
  await seedGame(page, state);
  const download = page.waitForEvent('download');
  await page.locator('#export-progress').click();
  expect((await download).suggestedFilename()).toBe('SecurityLab-progress.json');
  await page.locator('#reset-all').click(); await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.locator('#save-status')).not.toHaveText('저장 중…');
  const before = await page.evaluate(key => localStorage.getItem(key), CURRENT_SAVE_KEY);
  await page.locator('#import-progress').click();
  await page.locator('#progress-file').setInputFiles({ name: 'SecurityLab-progress.json', mimeType: 'application/json', buffer: Buffer.from(exportGame(state)) });
  await expect(page.locator('#confirm-import')).toBeEnabled(); await page.locator('#confirm-import').click();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(before);
  await reloadGame(page); await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
});

test('손상·큰 진행 파일은 가져오지 않고 현재 저장을 유지함', async ({ page }) => {
  await seedGame(page, await missionState(1)); await page.locator('#hint').click();
  await expect(page.locator('#save-status')).not.toHaveText('저장 중…');
  const before = await page.evaluate(key => localStorage.getItem(key), CURRENT_SAVE_KEY);
  await page.locator('#import-progress').click();
  for (const [text, message] of [['{broken', '형식'], ['x'.repeat(128 * 1024 + 1), '크기']]) {
    await page.locator('#progress-file').setInputFiles({ name: 'SecurityLab-progress.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('#import-message')).toContainText(message);
    await expect(page.locator('#confirm-import')).toBeDisabled();
    expect(await page.evaluate(key => localStorage.getItem(key), CURRENT_SAVE_KEY)).toBe(before);
  }
});

test('화면 진입·새로고침 시 CSS와 게임 모듈이 실제로 적용됨', async ({ page }) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stylesheet = page.waitForResponse(response => new URL(response.url()).pathname === '/src/style.css');
    if (attempt === 0) await page.goto('/');
    else await reloadGame(page);
    const response = await stylesheet;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/css\b/);
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
    await expect(page.locator('.workspace')).toHaveCSS('display', 'grid');
    await expect(page.locator('#mission-title')).toHaveText('조사 준비');
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#loading-screen')).toBeHidden();
    await expect(page.locator('#loading-retry')).toBeHidden();
  }
});

test('시작 스크립트가 늦어도 첫 화면은 스타일이 적용되고 재시도 안내는 숨김', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/src/bootstrap.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading-screen')).toBeVisible();
    await expect(page.locator('#loading-screen')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
    await expect(page.locator('#loading-retry')).toBeHidden();
    await expect(page.locator('#game')).toBeHidden();
    release();
    await expect(page.locator('#game')).toBeVisible();
  } finally { release(); }
});

test('로딩 화면 스타일 요청이 실패해도 게임 스타일과 초기화가 끝나면 실행함', async ({ page }) => {
  await page.route('**/src/loading.css', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#loading-retry')).toBeHidden();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
});

test('HTML 응답에 주석이 추가되어도 실제 CSS와 게임 준비가 완료되면 표시함', async ({ page }) => {
  await page.route('**/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\n<!-- response annotation -->' });
  });
  await page.goto('/');
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
  await expect(page.locator('.workspace')).toHaveCSS('display', 'grid');
  await expect(page.locator('#mission-title')).not.toBeEmpty();
});

test('느린 CSS는 로딩 화면에서 기다리고 적용 후에만 게임을 표시함', async ({ page }) => {
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route('**/src/style.css', async route => { requested(); await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await started;
    await expect(page.locator('#loading-screen')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#loading-retry')).toBeHidden();
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
    // Game initialization can finish while its stylesheet is still pending.
    await expect(page.locator('#mission-title')).toHaveText('조사 준비');
    release();
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
  } finally { release(); }
});

test('첫 CSS 요청 실패는 한 번 자동 재시도하고 저장된 진행을 복원함', async ({ page }) => {
  const saved = await seedGame(page, await missionState(1));
  let requests = 0;
  await page.route('**/src/style.css*', route => ++requests === 1 ? route.abort() : route.continue());
  await reloadGame(page);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#loading-screen')).toBeHidden();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(requests).toBe(2);
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(saved);
});

test('CSS 재시도도 실패하면 게임을 숨기고 수동 재시도로 진행을 유지함', async ({ page }) => {
  const saved = await seedGame(page, await missionState(1));
  let requests = 0;
  await page.route('**/src/style.css*', route => { requests++; return route.abort(); });
  await reloadGame(page);
  await expect(page.locator('#loading-message')).toContainText('화면을 불러오지 못했습니다');
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#loading-screen')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#loading-retry')).toBeVisible();
  expect(requests).toBe(2);
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(saved);
  await page.unroute('**/src/style.css*');
  await page.getByRole('link', { name: '다시 불러오기', exact: true }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
});

test('200 응답이어도 CSS가 적용되지 않았으면 게임을 표시하지 않음', async ({ page }) => {
  await page.route('**/src/style.css*', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* missing game styles */' }));
  await page.goto('/');
  await expect(page.locator('#loading-message')).toContainText('화면을 불러오지 못했습니다');
  await expect(page.locator('#game')).toBeHidden();
});

test('응답하지 않는 CSS는 재시도 제한 시간 후 안내하고 늦게 도착해도 게임을 열지 않음', async ({ page }) => {
  let release, first, second, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const firstRequest = new Promise(resolve => { first = resolve; });
  const secondRequest = new Promise(resolve => { second = resolve; });
  await page.clock.install();
  await page.route('**/src/style.css*', async route => {
    const attempt = ++requests;
    if (attempt === 1) first(); else second();
    await gate;
    if (attempt === 1) await route.abort(); else await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await firstRequest;
    await page.clock.fastForward(8001);
    await secondRequest;
    await page.clock.fastForward(8001);
    await expect(page.locator('#loading-message')).toContainText('화면을 불러오지 못했습니다');
    release();
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 18, 28)');
    await expect(page.locator('#game')).toBeHidden();
    expect(requests).toBe(2);
  } finally { release(); }
});

test('게임 모듈이 느리면 초기화와 진행 복원 완료까지 기다림', async ({ page }) => {
  await seedGame(page, await missionState(2));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/src/app.js', async route => { await gate; await route.continue(); });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading-message')).toContainText('저장된 진행을 준비');
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#loading-retry')).toBeHidden();
    release();
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#mission-title')).toHaveText('약한 로그인 정책');
  } finally { release(); }
});

test('의존 모듈 로딩 실패는 재시도 안내를 표시하고 진행을 삭제하지 않음', async ({ page }) => {
  const saved = await seedGame(page, await missionState(2));
  await page.route('**/src/engine.js', route => route.abort());
  await reloadGame(page);
  await expect(page.locator('#loading-message')).toContainText('게임을 준비하지 못했습니다');
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#loading-retry')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(saved);
  await page.unroute('**/src/engine.js');
  await page.getByRole('link', { name: '다시 불러오기', exact: true }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#mission-title')).toHaveText('약한 로그인 정책');
});

test('첫 게임 모듈 요청 실패는 페이지를 한 번 다시 열어 진행을 복원함', async ({ page }) => {
  const saved = await seedGame(page, await missionState(2));
  let requests = 0;
  await page.route('**/src/engine.js', route => ++requests === 1 ? route.abort() : route.continue());
  await reloadGame(page);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#mission-title')).toHaveText('약한 로그인 정책');
  expect(requests).toBe(2);
  expect(new URL(page.url()).searchParams.has('startup-retry')).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(saved);
});

test('게임 준비가 8초를 넘어도 30초 이내 완료되면 정상 표시함', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  await page.route('**/src/app.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading-message')).toContainText('저장된 진행을 준비');
    await page.clock.fastForward(8001);
    await expect(page.locator('#loading-screen')).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page.locator('#game')).toBeVisible();
  } finally { release(); }
});

test('응답하지 않는 게임 모듈은 제한 시간 이후 안내하고 늦게 도착해도 숨김을 유지함', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  await page.route('**/src/app.js', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loading-message')).toContainText('저장된 진행을 준비');
    await page.clock.fastForward(30001);
    await expect(page.locator('#loading-message')).toContainText('게임 준비 시간이 오래 걸리고 있습니다');
    release();
    await expect(page.locator('#mission-title')).toHaveText('조사 준비');
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#loading-screen')).toBeVisible();
  } finally { release(); }
});

async function missionState(index, completed = false) {
  const state = initialState();
  for (let i = 0; i <= index; i++) {
    if (i === index && !completed) break;
    if (i === 0) { await runCommand(state, 'help'); await runCommand(state, 'inspect approval'); applyAnswer(state, 0); }
    if (i === 1) { await runCommand(state, 'scan club-server'); await runCommand(state, 'inspect club-server 8080'); applyAnswer(state, 1); applyPort(state, 8080, false); await runCommand(state, 'scan club-server'); }
    if (i === 2) { await runCommand(state, 'inspect login'); applyAnswer(state, 2); applyLogin(state, { minLength: 15, blockCommon: true, limitAttempts: true }); }
    if (i === 3) { await runCommand(state, 'inspect baseline'); await runCommand(state, 'hash files'); applyAnswer(state, 1); restoreFile(state, 'budget.csv'); await runCommand(state, 'hash files'); }
    await runCommand(state, 'verify');
    if (i < index) nextMission(state);
  }
  return state;
}
async function reloadGame(page) {
  await expect(page.locator('#save-status')).not.toHaveText('저장 중…');
  await page.reload();
}
async function seedGame(page, state) {
  let saved;
  saveGame(state, { setItem: (_key, value) => { saved = value; } });
  await page.goto('/');
  await page.evaluate(({ key, value, current }) => { localStorage.removeItem(current); localStorage.setItem(key, value); }, { current: CURRENT_SAVE_KEY, key: SAVE_KEY, value: saved });
  await reloadGame(page);
  await expect(page.locator('#mission-title')).toHaveText(['조사 준비', '노출된 서비스', '약한 로그인 정책', '변조된 자료'][state.active]);
  return saved;
}

async function command(page, text) {
  await page.getByRole('textbox', { name: '게임 명령어' }).fill(text);
  const count = await page.locator('#terminal pre').count();
  await page.getByRole('button', { name: '실행 ↵', exact: true }).click();
  await expect(page.locator('#terminal pre')).toHaveCount(count + 2);
  await expect(page.locator('#command')).toBeEnabled();
}
async function tutorial(page) {
  await command(page, 'help'); await command(page, 'inspect approval');
  await page.getByLabel('club-server의 가상 데이터만 조사', { exact: true }).check();
  await page.getByRole('button', { name: '현재 상태 재검증', exact: true }).click();
  await expect(page.locator('#stage')).toHaveText('검증 완료');
  await page.getByRole('button', { name: '다음 미션 →' }).click();
}
test('전체 플레이: 방어와 재검증, 저장, 초기화, 외부 요청 없음', async ({ page }) => {
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#mission-title')).toHaveText('조사 준비');
  await tutorial(page);
  await command(page, 'scan club-server'); await command(page, 'inspect club-server 8080');
  await page.getByLabel('사용하지 않는 관리 서비스의 접근이 허용되어 있음', { exact: true }).check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#port-8080').selectOption('block');
  await page.locator('#port-443').selectOption('block');
  await page.getByRole('button', { name: '현재 상태 재검증', exact: true }).click();
  await expect(page.locator('#stage')).not.toHaveText('검증 완료');
  await expect(page.locator('#terminal')).toContainText('미충족: 443 자료 서비스 정상');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#port-443').selectOption('allow');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'scan club-server'); await command(page, 'verify');
  await page.getByRole('button', { name: '힌트 보기' }).click();
  await reloadGame(page); await expect(page.locator('#stage')).toHaveText('검증 완료');
  await expect(page.locator('#hint')).toHaveText('힌트 보기 (1/3)');
  await page.getByRole('button', { name: '다음 미션 →' }).click();
  await command(page, 'inspect login');
  await page.getByLabel('짧고 흔한 값이 허용되고 반복 시도 제한이 없음', { exact: true }).check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.getByLabel('최소 비밀번호 길이').selectOption('15');
  await page.getByLabel('흔한 값 차단 목록 적용').check();
  await page.getByLabel('연속 실패 3회 후 시도 제한').check();
  await page.getByRole('button', { name: '현재 상태 재검증', exact: true }).click();
  await expect(page.locator('#terminal')).toContainText('통과: 정상 사용자 첫 로그인 성공');
  await expect(page.locator('#stage')).toHaveText('검증 완료');
  await page.getByRole('button', { name: '다음 미션 →' }).click();
  await command(page, 'inspect baseline'); await command(page, 'hash files');
  await page.getByRole('tab', { name: '파일 비교' }).click();
  await expect(page.locator('.file-card').filter({ hasText: 'budget.csv' })).toContainText('변경 감지');
  await page.getByLabel('신뢰 가능한 기준과 다르므로 파일 바이트가 변경됨', { exact: true }).check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.getByRole('button', { name: 'budget.csv 선택 및 복구' }).click();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('100 / 100');
  await reloadGame(page); await expect(page.locator('#results')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '전체 초기화', exact: true }).click();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.locator('#mission-title')).toHaveText('조사 준비');
  await expect(page.locator('#score')).toHaveText('0 / 100');
  await expect(page.locator('#results')).toBeHidden();
  expect(errors).toEqual([]);
  expect(requests.every(url => new URL(url).hostname === 'localhost')).toBe(true);
});
test('입력은 텍스트로 표시되고 외부 URL에 접속하지 않음', async ({ page }) => {
  await page.goto('/'); await tutorial(page);
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  const malicious = '<img src=x onerror="window.hacked=true">';
  await command(page, malicious);
  await expect(page.locator('#terminal')).toContainText(malicious);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  await command(page, 'scan https://example.com'); await command(page, 'scan 8.8.8.8'); await command(page, '');
  expect(requests).toEqual([]);
  expect(await page.locator('#command').getAttribute('maxlength')).toBe('200');
});
test('손상 저장 안내와 키보드 탭 전환', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('security-lab-game:v1', '{broken'));
  await page.goto('/');
  await expect(page.locator('#notice')).toContainText('저장 데이터가 손상');
  await page.getByRole('tab', { name: '가상 터미널' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '방어 설정' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-settings')).toBeVisible();
});

test('해시 복원 실패 안내 후 저장을 유지하고 재계산·재검증할 수 있음', async ({ page }) => {
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    window.failHash = true;
    crypto.subtle.digest = (...args) => window.failHash ? Promise.reject(new Error('Temporary digest failure')) : digest(...args);
  });
  const state = await missionState(3, true);
  progress(state).hint = 2;
  const saved = await seedGame(page, state);
  await expect(page.locator('#notice')).toContainText('진행은 복원');
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(saved);
  await expect(page.locator('.mission-step.complete')).toHaveCount(3);
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#hint')).toHaveText('힌트 보기 (2/3)');
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(page.locator('#comparison').getByRole('row', { name: /budget.csv/ }).locator('td').nth(0)).toHaveText('변경 감지');
  await expect(page.locator('#comparison').getByRole('row', { name: /budget.csv/ }).locator('td').nth(1)).toHaveText('다시 조사 필요');
  await page.locator('#hint').click();
  await reloadGame(page);
  await expect(page.locator('#notice')).toContainText('해시 계산을 완료하지 못했습니다');
  await expect(page.locator('#hint')).toHaveText('힌트 보기 (3/3)');
  await page.evaluate(() => { window.failHash = false; });
  await command(page, 'hash files');
  await expect(page.locator('#notice')).toBeEmpty();
  await expect(page.locator('#results')).toBeHidden();
  await command(page, 'verify');
  await expect(page.locator('#results')).toBeVisible();
});

test('키보드로 정답·포트·로그인 정책을 바꿔도 포커스를 유지함', async ({ page }) => {
  await seedGame(page, await missionState(1));
  const answer = page.locator('#answer-1');
  await answer.focus(); await page.keyboard.press('Space');
  await expect(answer).toBeChecked(); await expect(answer).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#answer-0')).toBeChecked(); await expect(page.locator('#answer-0')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(answer).toBeChecked(); await expect(answer).toBeFocused();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  const port = page.locator('#port-8080');
  await port.focus(); await page.keyboard.press('ArrowDown');
  await expect(port).toHaveValue('block'); await expect(port).toBeFocused();

  await seedGame(page, await missionState(2));
  await page.getByRole('tab', { name: '방어 설정' }).click();
  const length = page.locator('#min-length');
  await length.focus(); await page.keyboard.press('End');
  await expect(length).toHaveValue('15'); await expect(length).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#blockCommon')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#blockCommon')).toBeChecked(); await expect(page.locator('#blockCommon')).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Space');
  await expect(page.locator('#limitAttempts')).toBeChecked(); await expect(page.locator('#limitAttempts')).toBeFocused();
});

test('파일 복구는 기준·변경 조사 후 열리고 잘못 고른 파일에서도 계속 진행됨', async ({ page }) => {
  await seedGame(page, await missionState(3));
  const budget = page.locator('[data-restore="budget.csv"]');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(budget).toBeDisabled();
  await expect(page.locator('#restore-guidance')).toContainText('기준 출처를 확인');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'inspect baseline');
  await expect(budget).toBeDisabled();
  await command(page, 'hash files');
  await page.getByLabel('신뢰 가능한 기준과 다르므로 파일 바이트가 변경됨', { exact: true }).check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(budget).toBeEnabled();
  await page.getByRole('button', { name: 'notice.txt 선택 및 복구', exact: true }).click();
  await expect(budget).toBeEnabled();
  await budget.click();
  await expect(budget).toBeFocused();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await expect(page.locator('#results')).toBeVisible();
});

test('조사 전 복구한 이전 저장은 현재 미션만 초기화해 다시 진행할 수 있음', async ({ page }) => {
  const state = await missionState(3);
  state.files['budget.csv'] = ORIGINAL_FILES['budget.csv'];
  progress(state).selectedFile = 'budget.csv';
  await seedGame(page, state);
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(page.locator('#restore-guidance')).toContainText('현재 미션 초기화');
  await expect(page.getByRole('button', { name: 'budget.csv 선택 및 복구', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '현재 미션 초기화', exact: true }).click();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.locator('.mission-step.complete')).toHaveCount(3);
  await expect(page.locator('#mission-title')).toHaveText('변조된 자료');
  await command(page, 'inspect baseline'); await command(page, 'hash files');
  await page.getByLabel('신뢰 가능한 기준과 다르므로 파일 바이트가 변경됨', { exact: true }).check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.getByRole('button', { name: 'budget.csv 선택 및 복구', exact: true }).click();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await expect(page.locator('#results')).toBeVisible();
});

test('설명·포트·파일 변경 후 이전 통과 결과를 지우고 재검증을 안내함', async ({ page }) => {
  await seedGame(page, await missionState(1, true));
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(page.locator('#settings')).toContainText('✓ 통과');
  await expect(page.locator('#verification-status')).toContainText('재검증을 통과');
  await page.locator('#answer-0').check();
  await expect(page.locator('#settings')).not.toContainText('✓ 통과');
  await expect(page.locator('#verification-status')).toContainText('재검증이 필요');
  await expect(page.locator('#next')).toBeHidden();
  await page.locator('#answer-1').check();
  await page.getByRole('button', { name: '현재 상태 재검증', exact: true }).click();
  await expect(page.locator('#stage')).toHaveText('검증 완료');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#port-8080').selectOption('allow');
  await expect(page.locator('#settings')).not.toContainText('✓ 통과');
  await expect(page.locator('#verification-status')).toContainText('재검증이 필요');
  await reloadGame(page);
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(page.locator('#verification-status')).toContainText('재검증이 필요');
  await expect(page.locator('#next')).toBeHidden();

  await seedGame(page, await missionState(3, true));
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await expect(page.locator('#settings')).toContainText('✓ 통과');
  await page.getByRole('button', { name: 'notice.txt 선택 및 복구', exact: true }).click();
  await expect(page.locator('#settings')).not.toContainText('✓ 통과');
  await expect(page.locator('#verification-status')).toContainText('재검증이 필요');
  await expect(page.locator('#results')).toBeHidden();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#terminal')).toContainText('미충족: 변경 파일 선택');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.getByRole('button', { name: 'budget.csv 선택 및 복구', exact: true }).click();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await expect(page.locator('#results')).toBeVisible();
});

test('포트 전후 비교는 정상 서비스와 과도한 차단을 구분하고 저장·초기화됨', async ({ page }) => {
  await seedGame(page, await missionState(1));
  await page.getByRole('tab', { name: '전후 비교' }).click();
  const service = page.locator('#comparison').getByRole('row', { name: /443 자료 서비스/ });
  const admin = page.locator('#comparison').getByRole('row', { name: /8080 관리 서비스/ });
  await expect(service.locator('td').nth(0)).toHaveText('조사 기록 없음');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'scan club-server'); await command(page, 'inspect club-server 8080');
  await page.locator('#answer-1').check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#port-8080').selectOption('block');
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(admin.locator('td').nth(0)).toHaveText('접근 허용');
  await expect(admin.locator('td').nth(1)).toHaveText('다시 조사 필요');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'scan club-server'); await command(page, 'verify');
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(admin.locator('td').nth(1)).toHaveText('접근 차단');
  await expect(service.locator('td').nth(1)).toHaveText('접근 허용 · 정상');
  await expect(page.locator('#comparison-status')).toContainText('재검증을 모두 통과');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#port-443').selectOption('block');
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(service.locator('td').nth(1)).toHaveText('다시 조사 필요');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'scan club-server'); await command(page, 'verify');
  await reloadGame(page); await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(service.locator('td').nth(0)).toHaveText('접근 허용 · 정상');
  await expect(service.locator('td').nth(1)).toHaveText('접근 차단 · 열람 불가');
  await expect(page.locator('#next')).toBeHidden();
  await page.getByRole('button', { name: '현재 미션 초기화', exact: true }).click();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(service.locator('td').nth(0)).toHaveText('조사 기록 없음');
});

test('로그인 전후 비교는 긴 흔한 값과 정상 사용자·시도 제한을 함께 보여줌', async ({ page }) => {
  await seedGame(page, await missionState(2));
  await command(page, 'inspect login');
  await page.locator('#answer-2').check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#min-length').selectOption('15');
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'inspect login');
  await page.getByRole('tab', { name: '전후 비교' }).click();
  const candidate = page.locator('#comparison').getByRole('row', { name: /긴 흔한 후보/ });
  const normal = page.locator('#comparison').getByRole('row', { name: /정상 사용자 첫 로그인/ });
  const attempts = page.locator('#comparison').getByRole('row', { name: /반복 실패 4회차/ });
  await expect(candidate.locator('td').nth(1)).toHaveText('허용');
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.locator('#blockCommon').check(); await page.locator('#limitAttempts').check();
  await page.getByRole('button', { name: '현재 상태 재검증', exact: true }).click();
  await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(candidate.locator('td').nth(0)).toHaveText('허용'); await expect(candidate.locator('td').nth(1)).toHaveText('거부');
  await expect(attempts.locator('td').nth(0)).toHaveText('실패'); await expect(attempts.locator('td').nth(1)).toHaveText('제한됨');
  await expect(normal.locator('td').nth(0)).toHaveText('성공'); await expect(normal.locator('td').nth(1)).toHaveText('성공');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('파일 전후 비교는 복구 전 변경 기록을 유지하고 새 계산을 요구함', async ({ page }, testInfo) => {
  await seedGame(page, await missionState(3));
  await command(page, 'inspect baseline'); await command(page, 'hash files');
  await page.locator('#answer-1').check();
  await page.getByRole('tab', { name: '방어 설정' }).click();
  await page.getByRole('button', { name: 'budget.csv 선택 및 복구', exact: true }).click();
  await reloadGame(page); await page.getByRole('tab', { name: '전후 비교' }).click();
  const budget = page.locator('#comparison').getByRole('row', { name: /budget.csv/ });
  await expect(budget.locator('td').nth(0)).toHaveText('변경 감지');
  await expect(budget.locator('td').nth(1)).toHaveText('다시 조사 필요');
  await expect(page.locator('#results')).toBeHidden();
  await page.getByRole('tab', { name: '가상 터미널' }).click();
  await command(page, 'hash files'); await command(page, 'verify');
  await reloadGame(page); await page.getByRole('tab', { name: '전후 비교' }).click();
  await expect(budget.locator('td').nth(0)).toHaveText('변경 감지'); await expect(budget.locator('td').nth(1)).toHaveText('일치');
  await expect(page.locator('#comparison-status')).toContainText('재검증을 모두 통과');
  await expect(page.locator('#answer-feedback')).toContainText('미션을 완료했습니다');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.workspace').screenshot({ path: testInfo.outputPath('comparison.png') });
});

test('오답 피드백은 조사 전 근거를 요청하고 선택별 오해를 설명함', async ({ page }) => {
  await seedGame(page, await missionState(1));
  await page.locator('#answer-0').check();
  await expect(page.locator('#answer-feedback')).toContainText('아직 조사 근거가 충분하지 않습니다');
  await command(page, 'scan club-server'); await command(page, 'inspect club-server 8080');
  await expect(page.locator('#answer-feedback')).toContainText('열린 포트만으로');
  await expect(page.locator('#next')).toBeHidden();
  for (const [index, options] of [[0, [[1, '조사 권한'], [2, '승인이 먼저']]], [1, [[0, '열린 포트만으로'], [2, 'HTTPS 서비스의 존재']]], [2, [[0, 'password!'], [1, '반복 로그인']]], [3, [[0, '악성 여부'], [2, '신원을 인증']]]]) {
    await seedGame(page, await missionState(index, true));
    for (const [answer, concept] of options) {
      await page.locator('#answer-' + answer).check();
      await expect(page.locator('#answer-feedback')).toContainText(concept);
      await command(page, 'verify');
      await expect(page.locator('#terminal')).toContainText(concept);
      await expect(page.locator('#next')).toBeHidden();
      await expect(page.locator('#results')).toBeHidden();
    }
  }
});
