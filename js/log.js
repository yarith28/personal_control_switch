import { output } from './dom.js';

export function log(text, append = false) {
  const current = output.textContent;
  if (append) {
    output.textContent = current ? current + '\n' + text : text;
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${time}] ${text}`;
    output.textContent = current ? current + '\n\n' + line : line;
  }
  output.scrollTop = output.scrollHeight;
}

window.addEventListener('error', (e) => {
  log(`[app error] ${e.message}${e.filename ? ` — ${e.filename.split('/').pop()}:${e.lineno}` : ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
  log(`[app error] ${e.reason?.message || e.reason}`);
});
