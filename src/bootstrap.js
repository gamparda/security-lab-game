(() => {
  const guard = window.SecurityLabStartup;
  if (!guard?.claim(document.currentScript?.dataset.attempt)) return;
  const timeoutMs = 8000;
  const stylesReady = () => getComputedStyle(document.documentElement)
    .getPropertyValue('--game-styles-ready').trim() === '1';

  class StartupFailure extends Error {
    constructor(phase, error) {
      super(error.message, { cause: error });
      this.phase = phase;
    }
  }

  function waitForStyles(link) {
    if (link.sheet && stylesReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        link.removeEventListener('load', loaded);
        link.removeEventListener('error', failed);
      };
      const loaded = () => {
        cleanup();
        if (stylesReady()) resolve();
        else reject(new Error('Styles were not applied'));
      };
      const failed = () => { cleanup(); reject(new Error('Styles did not load')); };
      const timer = setTimeout(failed, timeoutMs);
      link.addEventListener('load', loaded);
      link.addEventListener('error', failed);
    });
  }

  function loadStyles(retry = false) {
    document.getElementById('game-styles')?.remove();
    const link = document.createElement('link');
    link.id = 'game-styles'; link.rel = 'stylesheet';
    link.href = retry ? 'src/style.css?retry=1' : 'src/style.css';
    const ready = waitForStyles(link);
    document.head.append(link);
    return ready;
  }

  async function loadGame() {
    let timer;
    try {
      // A rejected module fetch is cached by the browser. A fresh document and
      // entry URL keep an automatic retry from reusing that rejected request.
      const retry = new URL(location.href).searchParams.has('startup-retry');
      await Promise.race([
        retry ? import('./app.js?retry=1') : import('./app.js'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Game startup timed out')), 30000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function diagnoseGame(error) {
    const files = ['src/app.js', 'src/engine.js', 'src/missions.js', 'src/storage.js', 'src/labbridge.js', 'src/scene-entry.js'];
    const controller = new AbortController();
    const completed = new Map();
    let finishDeadline;
    const deadline = new Promise(resolve => { finishDeadline = resolve; });
    const timer = setTimeout(() => {
      controller.abort();
      finishDeadline(files.map(file => completed.get(file) || { file, failure: '파일 진단 시간 초과' }));
    }, 3500);
    try {
      const checks = files.map(async file => {
        try {
          const response = await fetch(file, { cache: 'reload', signal: controller.signal, redirect: 'error' });
          if (!response.ok) return { file, failure: `HTTP ${response.status}` };
          const type = response.headers.get('Content-Type') || '(없음)';
          if (!/(?:java|ecma)script/i.test(type)) return { file, failure: `JavaScript가 아닌 응답 (${type})` };
          const body = await response.arrayBuffer();
          if (!body.byteLength) return { file, failure: '빈 파일 응답' };
          if (/^\s*</.test(new TextDecoder().decode(body).slice(0, 120))) return { file, failure: '코드 대신 HTML 응답' };
          const expected = response.headers.get('X-Security-Lab-SHA256');
          if (expected && crypto.subtle) {
            const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
              .map(byte => byte.toString(16).padStart(2, '0')).join('');
            if (actual !== expected) return { file, failure: '서버 원본과 응답 내용이 다름' };
          }
          return { file, version: response.headers.get('X-Security-Lab-Version') || '(확인 불가)' };
        } catch (failure) {
          return { file, failure: controller.signal.aborted ? '파일 응답 시간 초과' : `파일 요청 실패 (${failure.message})` };
        }
      });
      const results = await Promise.race([Promise.all(checks.map(async check => {
        const result = await check; completed.set(result.file, result); return result;
      })), deadline]);
      const failed = results.filter(result => result.failure);
      const details = failed.length
        ? failed.map(result => result.file + ': ' + result.failure).join('\n')
        : '필수 모듈 HTTP 응답 정상 · 버전 ' + [...new Set(results.map(result => result.version))].join(', ');
      let worker = '';
      try { if (navigator.serviceWorker?.controller) worker = '\n로컬 주소에 서비스 워커 연결됨'; }
      catch { /* Browser policy can disable access to service workers. */ }
      return {
        file: failed[0]?.file || 'src/app.js',
        error: new Error(error.message + '\n' + details + worker + '\n브라우저: ' + navigator.userAgent),
      };
    } finally { clearTimeout(timer); }
  }

  async function start() {
    const screen = document.getElementById('loading-screen');
    const message = document.getElementById('loading-message');
    const actions = document.getElementById('loading-actions');
    const address = new URL(location.href);
    // Clear an automatic-retry marker on a manual retry, keeping the save origin.
    address.searchParams.delete('startup-retry');
    document.getElementById('loading-retry').href = address.href;
    try {
      message.textContent = '게임과 저장된 진행을 준비하고 있습니다.';
      const styles = (async () => {
        try { await loadStyles(); }
        catch { await loadStyles(true); }
      })().catch(error => { throw new StartupFailure('styles', error); });
      const game = loadGame().catch(error => { throw new StartupFailure('game', error); });
      await Promise.all([styles, game]);
      if (!stylesReady() || !document.getElementById('mission-title').textContent.trim()) {
        throw new StartupFailure('game', new Error('Game is not ready'));
      }
      if (!guard.ready()) return;
      document.getElementById('game').hidden = false;
      screen.hidden = true;
      const address = new URL(location.href);
      if (address.searchParams.has('startup-retry')) {
        address.searchParams.delete('startup-retry');
        history.replaceState(null, '', address);
      }
    } catch (error) {
      const phase = error.phase || 'game';
      console.error('Security Lab startup failed:', phase, error);
      const address = new URL(location.href);
      if (phase === 'game' && error.message !== 'Game startup timed out' && !address.searchParams.has('startup-retry')) {
        address.searchParams.set('startup-retry', '1');
        location.replace(address.href);
        return;
      }
      if (phase === 'game' && error.message !== 'Game startup timed out') {
        const diagnosis = await diagnoseGame(error);
        guard.fail(phase, diagnosis.file, diagnosis.error);
      } else guard.fail(phase, phase === 'styles' ? 'src/style.css' : 'src/app.js', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
