const TOAST_DURATION_MS = 4600;
const TOAST_REMOVE_DELAY_MS = 180;
const MAX_TOASTS = 4;

function toastStack() {
  return document.getElementById('toast-stack');
}

function dismissToast(toast) {
  if (!toast?.isConnected) return;
  toast.classList.remove('open');
  window.setTimeout(() => {
    toast.remove();
  }, TOAST_REMOVE_DELAY_MS);
}

export function showToast(title, body = '', { tone = 'default', duration = TOAST_DURATION_MS } = {}) {
  const stack = toastStack();
  if (!stack || !title) return;

  while (stack.children.length >= MAX_TOASTS) {
    stack.firstElementChild?.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${tone}`;

  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;
  toast.appendChild(titleEl);

  if (body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'toast-body';
    bodyEl.textContent = body;
    toast.appendChild(bodyEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => dismissToast(toast));
  toast.appendChild(closeBtn);

  stack.appendChild(toast);
  window.requestAnimationFrame(() => {
    toast.classList.add('open');
  });

  window.setTimeout(() => {
    dismissToast(toast);
  }, duration);
}
