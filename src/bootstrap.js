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
      guard.fail(phase, phase === 'styles' ? 'src/style.css' : 'src/app.js', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
