import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronsDown,
  ChevronsUp,
  Folder,
  FolderInput,
  GitCommitVertical,
  GripVertical,
  ListChecks,
  Logs,
  Minus,
  Pencil,
  Pin,
  Settings2,
  Square,
  X,
} from 'lucide';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  arrowDown: ArrowDown,
  arrowDownUp: ArrowDownUp,
  arrowUp: ArrowUp,
  check: Check,
  chevronsDown: ChevronsDown,
  chevronsUp: ChevronsUp,
  folder: Folder,
  folderInput: FolderInput,
  gitCommitVertical: GitCommitVertical,
  gripVertical: GripVertical,
  listChecks: ListChecks,
  logs: Logs,
  minus: Minus,
  pencil: Pencil,
  pin: Pin,
  settings2: Settings2,
  square: Square,
  x: X,
};

function toSvgAttrName(name) {
  if (name === 'viewBox') return 'viewBox';
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attrsToString(attrs) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => {
      if (value === true) return ` ${toSvgAttrName(name)}`;
      return ` ${toSvgAttrName(name)}="${escapeAttr(value)}"`;
    })
    .join('');
}

function renderIconNode(node) {
  return node.map(([tag, attrs]) => `<${tag}${attrsToString(attrs)} />`).join('');
}

export function iconHtml(name, {
  size = 14,
  strokeWidth = 1.9,
  className = '',
  attrs = {},
} = {}) {
  const node = ICONS[name];
  if (!node) throw new Error(`Unknown icon: ${name}`);

  return `<svg${attrsToString({
    xmlns: SVG_NS,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ariaHidden: 'true',
    class: className || undefined,
    ...attrs,
  })}>${renderIconNode(node)}</svg>`;
}

export function iconElement(name, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = iconHtml(name, options);
  return template.content.firstElementChild;
}

export function setIcon(target, name, options = {}) {
  if (!target) return;
  target.replaceChildren(iconElement(name, options));
}

export function hydrateStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const size = Number(el.dataset.iconSize) || undefined;
    const strokeWidth = Number(el.dataset.iconStroke) || undefined;
    const className = el.dataset.iconClass || '';
    setIcon(el, el.dataset.icon, { size, strokeWidth, className });
  });
}

export function checkboxIconMarkup() {
  return [
    iconHtml('check', { size: 9, strokeWidth: 2.1, className: 'checkbox-check' }),
    iconHtml('minus', { size: 8, strokeWidth: 2.1, className: 'checkbox-dash' }),
  ].join('');
}

export function dragHandleIconMarkup() {
  return iconHtml('gripVertical', { size: 12, strokeWidth: 1.8 });
}
