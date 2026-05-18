import { output } from './dom.js';

function hasSelectionInside(el) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return el.contains(selection.anchorNode) || el.contains(selection.focusNode);
}

function isNearBottom(el, threshold = 24) {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}

function appendEntry(entry) {
  const shouldStickToBottom = isNearBottom(output) && !hasSelectionInside(output);
  output.appendChild(entry);
  if (shouldStickToBottom) output.scrollTop = output.scrollHeight;
}

function buildLogPrefix(includeTimestamp) {
  if (!includeTimestamp) return '';
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `[${time}] `;
}

export function log(text, append = false) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${append ? 'append' : 'event'}`;
  entry.textContent = buildLogPrefix(!append) + text;
  appendEntry(entry);
}

export function logDetails(summary, details, {
  append = true,
  detailsLabel = 'Show raw Git output',
} = {}) {
  if (!details) {
    log(summary, append);
    return;
  }

  const entry = document.createElement('div');
  entry.className = `log-entry log-entry-detailed ${append ? 'append' : 'event'}`;

  const summaryLine = document.createElement('div');
  summaryLine.className = 'log-summary';
  summaryLine.textContent = buildLogPrefix(!append) + summary;

  const detailsEl = document.createElement('details');
  detailsEl.className = 'log-details';

  const summaryEl = document.createElement('summary');
  summaryEl.textContent = detailsLabel;

  const raw = document.createElement('pre');
  raw.className = 'log-raw';
  raw.textContent = details;

  detailsEl.appendChild(summaryEl);
  detailsEl.appendChild(raw);
  entry.appendChild(summaryLine);
  entry.appendChild(detailsEl);
  appendEntry(entry);
}

window.addEventListener('error', (e) => {
  log(`[app error] ${e.message}${e.filename ? ` — ${e.filename.split('/').pop()}:${e.lineno}` : ''}`);
});
window.addEventListener('unhandledrejection', (e) => {
  log(`[app error] ${e.reason?.message || e.reason}`);
});
