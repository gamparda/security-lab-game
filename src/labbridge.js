// A read-only snapshot and tool request bus. Mission mutations stay in app.js/engine.js.
const bus = new EventTarget();
let latest = null;
export function publishMission(status) {
  latest = Object.freeze({ ...status });
  bus.dispatchEvent(new CustomEvent('status', { detail: latest }));
}
export function observeMission(listener) {
  const receive = event => listener(event.detail);
  bus.addEventListener('status', receive);
  if (latest) listener(latest);
  return () => bus.removeEventListener('status', receive);
}
export function requestTool(tab) {
  if (['terminal', 'settings', 'files', 'comparison', 'brief'].includes(tab)) bus.dispatchEvent(new CustomEvent('tool', { detail: tab }));
}
export function onToolRequest(listener) { bus.addEventListener('tool', event => listener(event.detail)); }
