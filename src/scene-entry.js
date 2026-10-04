// Small view controller. The 2D game never waits for WebGL or its assets.
const $ = id => document.getElementById(id);
const VIEW_KEY = 'security-lab-view';
let sceneModule, transaction, attempt = 0, mode = '2d', initialized = false;
let retryGraph = false, graphAttempt = 0;
function preference() { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } }
function remember(value) { try { localStorage.setItem(VIEW_KEY, value); } catch { /* View choice is optional. */ } }
function address(value) {
  const url = new URL(location.href); url.searchParams.set('view', value);
  history.replaceState(null, '', url);
}
function notice(text = '') {
  $('view-notice').textContent = text; $('view-notice').hidden = !text;
}
function display(value) {
  mode = value;
  document.body.classList.toggle('lab-3d', value === '3d');
  $('lab-world').hidden = value !== '3d';
  $('lab-world').inert = false;
  $('lab-tools').hidden = value === '3d';
  $('lab-tools').removeAttribute('role'); $('lab-tools').removeAttribute('aria-modal');
  $('tool-toolbar').hidden = true;
  $('view-switch').disabled = false;
  $('view-switch').textContent = value === '3d' ? '2D 도구 화면' : '3D 실습실';
}
function loadStyles(signal, prefix = '') {
  if (getComputedStyle(document.documentElement).getPropertyValue('--scene-styles-ready').trim() === '1') return Promise.resolve();
  $('scene-styles')?.remove();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.id = 'scene-styles'; link.rel = 'stylesheet';
    link.href = prefix + 'src/scene3d.css';
    const cleanup = () => { signal.removeEventListener('abort', aborted); link.onload = null; link.onerror = null; };
    const aborted = () => { cleanup(); link.remove(); reject(new Error('3D 준비를 취소했습니다.')); };
    link.onload = () => {
      cleanup();
      if (getComputedStyle(document.documentElement).getPropertyValue('--scene-styles-ready').trim() === '1') resolve();
      else reject(new Error('3D 화면 스타일을 적용하지 못했습니다.'));
    };
    link.onerror = () => { cleanup(); link.remove(); reject(new Error('3D 화면 스타일을 불러오지 못했습니다.')); };
    signal.addEventListener('abort', aborted, { once: true });
    document.head.append(link);
  });
}
export function show2D({ save = true } = {}) {
  attempt++; transaction?.abort(); sceneModule?.setMode('2d');
  display('2d');
  if (save) { remember('2d'); address('2d'); }
  $('view-switch').focus({ preventScroll: true });
}
export async function show3D() {
  if (document.querySelector('dialog[open]')) return;
  transaction?.abort(); const token = ++attempt;
  const current = transaction = new AbortController();
  remember('3d'); address('3d'); display('3d'); notice();
  $('lab-world').dataset.state = 'loading'; $('scene-cover').hidden = false;
  $('scene-title').textContent = '실습실 준비 중';
  $('scene-message').textContent = '공간과 조사 장비를 불러오고 있습니다.';
  $('scene-start').hidden = true; $('scene-retry').hidden = true;
  $('scene-progress').hidden = false; $('scene-progress').value = 0;
  let timer;
  // Give every module in a failed graph a fresh URL, while the working game
  // and its save session stay in this document.
  const prefix = retryGraph ? `__scene__/${Date.now().toString(36)}-${++graphAttempt}/` : '';
  try {
    await Promise.race([
      (async () => {
        const [module] = await Promise.all([
          sceneModule ? Promise.resolve(sceneModule) : prefix ? import('/' + prefix + 'src/scene3d.js') : import('./scene3d.js'),
          loadStyles(current.signal, prefix),
        ]);
        if (token !== attempt || current.signal.aborted) return;
        sceneModule = module; retryGraph = false;
        await module.init3D();
        if (token !== attempt || current.signal.aborted) return;
        const ready = module.get3DDiagnostics();
        if (!ready.ready || !ready.firstFrameReady) throw new Error('3D 화면 준비를 완료하지 못했습니다.');
        $('lab-world').dataset.state = 'ready'; $('lab-world').setAttribute('aria-busy', 'false');
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('3D 준비 시간이 초과되었습니다.')), 20000); }),
    ]);
  } catch (error) {
    if (token !== attempt || mode !== '3d') return;
    current.abort();
    retryGraph = !sceneModule;
    sceneModule?.cancelPreparation(error);
    $('lab-world').dataset.state = 'error';
    $('scene-title').textContent = '실습실을 열지 못했습니다.';
    $('scene-message').textContent = error.message + ' 2D 도구 화면에서 이어갈 수 있습니다.';
    $('scene-progress').hidden = true; $('scene-start').hidden = true; $('scene-retry').hidden = false;
    notice('3D 화면을 준비하지 못했습니다. 2D 도구 화면으로 이어갈 수 있습니다.');
  } finally { clearTimeout(timer); }
}
export function initSceneView() {
  if (initialized) return;
  initialized = true;
  $('view-switch').addEventListener('click', () => { if (mode === '3d') show2D(); else void show3D(); });
  $('world-2d').addEventListener('click', () => show2D());
  $('scene-fallback').addEventListener('click', () => show2D());
  document.addEventListener('scene3d-retry', () => {
    void show3D();
  });
  // A graph load failure can occur before the heavy module installs its events.
  $('scene-retry').addEventListener('click', () => {
    if (!sceneModule) void show3D();
  });
  const query = new URLSearchParams(location.search).get('view');
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (query === '2d') remember('2d');
  if (query === '3d' || query !== '2d' && !coarse && preference() === '3d') void show3D();
}
export function get3DDiagnostics() {
  return sceneModule?.get3DDiagnostics() || { mode, ready: false, firstFrameReady: false };
}
