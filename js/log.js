import { output } from './dom.js';

function hasSelectionInside(el) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return el.contains(selection.anchorNode) || el.contains(selection.focusNode);
}

function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}

export function log(text, append = false) {
  const hasContent = output.textContent.length > 0;
  const shouldStickToBottom = isNearBottom(output) && !hasSelectionInside(output);

  let chunk = '';
  if (append) {
    chunk = hasContent ? '\n' + text : text;
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${time}] ${text}`;
    chunk = hasContent ? '\n\n' + line : line;
  }

  output.appendChild(document.createTextNode(chunk));
  if (shouldStickToBottom) output.scrollTop = output.scrollHeight;
}

window.addEventListener('error', (e) => {
  log(`[app error] ${e.message}${e.filename ? ` — ${e.filename.split('/').pop()}:${e.lineno}` : ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
  log(`[app error] ${e.reason?.message || e.reason}`);
});
