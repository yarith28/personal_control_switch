import { indexHistoryDiff, diffViewportRange } from './history-diff.mjs';

const VIRTUAL_THRESHOLD = 200;

function element(className, text = '') {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

export function createHistoryDiffView(container) {
  let current = null;
  let model = null;
  let canvas = null;
  let viewport = null;
  let frame = null;
  let context = null;
  let renderedRange = '';
  let active = true;
  let destroyed = false;
  let selectAll = false;

  const row = (index, lineHeight) => {
    const item = model.row(index);
    const line = element(`history-diff-line ${item.className}`);
    const oldNumber = element('history-line-number', item.oldNumber);
    const newNumber = element('history-line-number', item.newNumber);
    oldNumber.setAttribute('aria-hidden', 'true');
    newNumber.setAttribute('aria-hidden', 'true');
    line.append(oldNumber, newNumber, element('history-line-code', item.line || ' '));
    if (lineHeight) line.style.height = `${lineHeight}px`;
    return line;
  };
  const render = (force = false) => {
    if (destroyed || !active || !viewport || !model) return;
    const style = getComputedStyle(container);
    const lineHeight = Number.parseFloat(style.lineHeight) || 17;
    const padding = Number.parseFloat(style.paddingTop) || 0;
    const range = diffViewportRange(model.length, container.scrollTop - padding, container.clientHeight, lineHeight);
    canvas.style.height = `${range.totalHeight}px`;
    const key = `${range.start}:${range.end}:${lineHeight}`;
    if (!force && key === renderedRange) return;
    renderedRange = key;
    const fragment = document.createDocumentFragment();
    for (let index = range.start; index < range.end; index += 1) fragment.appendChild(row(index, lineHeight));
    viewport.style.transform = `translateY(${range.offset}px)`;
    viewport.replaceChildren(fragment);
  };
  const schedule = () => {
    if (destroyed || !active || !viewport || frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; render(); });
  };
  const cancelFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const resetSelection = () => {
    selectAll = false;
    container.classList.remove('history-diff-select-all');
  };
  const onKeydown = (event) => {
    if (!viewport || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    selectAll = true;
    container.classList.add('history-diff-select-all');
    window.getSelection()?.selectAllChildren(container);
  };
  const onCopy = (event) => {
    if (!selectAll || !current || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', current.text);
  };
  container.addEventListener('scroll', schedule, { passive: true });
  container.addEventListener('keydown', onKeydown);
  container.addEventListener('copy', onCopy);
  container.addEventListener('pointerdown', resetSelection);
  const observer = new ResizeObserver(schedule);
  observer.observe(container);

  return {
    show(text, { plainText = true, numbered = false, truncated = false } = {}) {
      if (destroyed) return;
      if (current?.text === text && current.plainText === plainText
        && current.numbered === numbered && current.truncated === truncated) return;
      cancelFrame();
      resetSelection();
      current = { text, plainText, numbered, truncated };
      model = null;
      canvas = null;
      viewport = null;
      renderedRange = '';
      container.replaceChildren();
      container.classList.toggle('history-plain-file', plainText && numbered);
      container.classList.toggle('history-diff-numbered', numbered || !plainText);
      container.dataset.virtualized = 'false';
      container.dataset.lineCount = '0';
      container.removeAttribute('aria-description');
      if (plainText && !numbered) {
        container.textContent = text;
      } else {
        model = indexHistoryDiff(text, plainText);
        container.dataset.lineCount = String(model.length);
        if (model.length > VIRTUAL_THRESHOLD) {
          container.dataset.virtualized = 'true';
          container.setAttribute('aria-description', `${model.length} lines. Select all and copy to copy the entire preview.`);
          canvas = element('history-diff-virtual-content');
          viewport = element('history-diff-virtual-rows');
          canvas.appendChild(viewport);
          container.appendChild(canvas);
          const style = getComputedStyle(container);
          canvas.style.height = `${model.length * (Number.parseFloat(style.lineHeight) || 17)}px`;
          if (!context) {
            const measure = document.createElement('canvas');
            measure.width = 1;
            measure.height = 1;
            context = measure.getContext('2d', { willReadFrequently: true });
          }
          context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          let longestAscii = '';
          const complexLines = new Set();
          for (const line of model.lines) {
            if (/[^\x20-\x7e]/.test(line)) complexLines.add(line);
            else if (line.length > longestAscii.length) longestAscii = line;
          }
          let width = context.measureText(longestAscii).width;
          for (const line of complexLines) width = Math.max(width, context.measureText(line.replace(/\t/g, '    ')).width);
          canvas.style.width = `${Math.ceil(width) + (plainText ? 54 : 88)}px`;
          render(true);
        } else {
          const fragment = document.createDocumentFragment();
          for (let index = 0; index < model.length; index += 1) fragment.appendChild(row(index));
          container.appendChild(fragment);
        }
      }
      if (truncated) container.appendChild(element('history-preview-truncated', '\nPreview limited to 160 KB.'));
    },
    refresh: () => render(true),
    setActive(value) {
      active = value;
      if (active) render(true);
      else cancelFrame();
    },
    destroy() {
      destroyed = true;
      cancelFrame();
      observer.disconnect();
      container.removeEventListener('scroll', schedule);
      container.removeEventListener('keydown', onKeydown);
      container.removeEventListener('copy', onCopy);
      container.removeEventListener('pointerdown', resetSelection);
      current = null;
      model = null;
      canvas = null;
      viewport = null;
      context = null;
      container.replaceChildren();
    },
  };
}
