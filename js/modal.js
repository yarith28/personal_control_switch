const overlay   = document.getElementById('confirm-modal');
const messageEl = document.getElementById('modal-message');
const detailEl  = document.getElementById('modal-detail');
const cancelBtn = document.getElementById('modal-cancel');
const confirmBtn = document.getElementById('modal-confirm');

export function confirmDialog({ message, detail, confirmText = 'Remove', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.toggle('danger', !!danger);
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
    confirmBtn.focus();

    const cleanup = (result) => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.hidden = true; }, 180);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}
