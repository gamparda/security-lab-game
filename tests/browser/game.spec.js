import { test, expect } from '@playwright/test';
import { initialState, progress, runCommand, applyAnswer, applyPort, applyLogin, restoreFile, nextMission } from '../../src/engine.js';
import { saveGame, SAVE_KEY } from '../../src/storage.js';
import { ORIGINAL_FILES } from '../../src/missions.js';

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
async function seedGame(page, state) {
  let saved;
  saveGame(state, { setItem: (_key, value) => { saved = value; } });
  await page.goto('/');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SAVE_KEY, value: saved });
  await page.reload();
  await expect(page.locator('#mission-title')).toHaveText(['조사 준비', '노출된 서비스', '약한 로그인 정책', '변조된 자료'][state.active]);
  return saved;
}

async function command(page, text) {
  const count = await page.locator('#terminal pre').count();
  await page.getByRole('textbox', { name: '게임 명령어' }).fill(text);
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
  await page.reload(); await expect(page.locator('#stage')).toHaveText('검증 완료');
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
  await page.reload(); await expect(page.locator('#results')).toBeVisible();
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
  await page.locator('#hint').click();
  await page.reload();
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
  await page.reload();
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
