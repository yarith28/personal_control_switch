// Append a 3-dot jumping loader element to a button (idempotent).
// Pair with the `.btn-loading` class to overlay the button content while async work runs.
function ensureDotsLoader(btn) {
  if (btn.querySelector(':scope > .dots-loader')) return;
  const loader = document.createElement('span');
  loader.className = 'dots-loader';
  loader.innerHTML = '<span></span><span></span><span></span>';
  btn.appendChild(loader);
}

export async function withButtonLoading(btn, fn) {
  if (!btn) return fn();
  if (btn.classList.contains('btn-loading')) return;
  ensureDotsLoader(btn);
  btn.classList.add('btn-loading');
  try {
    return await fn();
  } finally {
    btn.classList.remove('btn-loading');
  }
}

export function basename(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function displayPath(p, homedir) {
  if (!homedir || !p) return p;
  const sep = homedir.includes('\\') ? '\\' : '/';
  const pl = p.toLowerCase();
  const hl = homedir.toLowerCase();
  if (pl === hl) return '~';
  if (pl.startsWith(hl + sep)) return '~' + p.slice(homedir.length);
  return p;
}

// Position a `position: fixed` dropdown next to an anchor rect, flipping
// above when there's no room below and clamping inside the window.
// `align`: which edge of the anchor to line the dropdown up with — 'left' (default) or 'right'.
export function positionDropdown(el, anchorRect, { align = 'left', gap = 6, margin = 8 } = {}) {
  const elHeight = el.offsetHeight;
  const elWidth = el.offsetWidth;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical: prefer below; flip above if there's more room there
  const spaceBelow = vh - anchorRect.bottom - gap - margin;
  const spaceAbove = anchorRect.top - gap - margin;
  let top;
  if (elHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    top = anchorRect.bottom + gap;
    if (top + elHeight > vh - margin) top = Math.max(margin, vh - elHeight - margin);
  } else {
    top = anchorRect.top - gap - elHeight;
    if (top < margin) top = margin;
  }

  // Horizontal: align to requested edge, then clamp inside the viewport
  let left = align === 'right' ? anchorRect.right - elWidth : anchorRect.left;
  if (left + elWidth > vw - margin) left = vw - elWidth - margin;
  if (left < margin) left = margin;

  el.style.top = top + 'px';
  el.style.left = left + 'px';
}
