(() => {
  const timeoutMs = 8000;
  const stylesReady = () => getComputedStyle(document.documentElement)
    .getPropertyValue('--game-styles-ready').trim() === '1';

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
      await Promise.race([
        import('./app.js'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Game startup timed out')), 30000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function start() {
    const screen = document.getElementById('loading-screen');
    const message = document.getElementById('loading-message');
    let phase = 'styles';
    try {
      try { await loadStyles(); }
      catch {
        message.textContent = '화면을 다시 불러오는 중입니다.';
        await loadStyles(true);
      }
      phase = 'game';
      message.textContent = '게임과 저장된 진행을 준비하고 있습니다.';
      await loadGame();
      if (!stylesReady() || !document.getElementById('mission-title').textContent.trim()) throw new Error('Game is not ready');
      document.getElementById('game').hidden = false;
      screen.hidden = true;
      const address = new URL(location.href);
      if (address.searchParams.has('startup-retry')) {
        address.searchParams.delete('startup-retry');
        history.replaceState(null, '', address);
      }
    } catch (error) {
      console.error('Security Lab startup failed:', phase, error);
      const address = new URL(location.href);
      if (phase === 'game' && error.message !== 'Game startup timed out' && !address.searchParams.has('startup-retry')) {
        message.textContent = '게임 연결을 다시 확인하고 있습니다.';
        address.searchParams.set('startup-retry', '1');
        location.replace(address.href);
        return;
      }
      screen.setAttribute('aria-busy', 'false');
      message.textContent = phase === 'styles'
        ? '화면을 불러오지 못했습니다. 실행 창을 열어둔 채 다시 불러오기를 눌러주세요.'
        : error.message === 'Game startup timed out'
          ? '게임 준비 시간이 오래 걸리고 있습니다. 실행 창을 열어둔 채 다시 불러오기를 눌러주세요.'
          : '게임을 준비하지 못했습니다. 실행 창을 열어둔 채 다시 불러오기를 눌러주세요.';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
