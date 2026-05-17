const overlay   = document.getElementById('confirm-modal');
const messageEl = document.getElementById('modal-message');
const detailEl  = document.getElementById('modal-detail');
const inputEl   = document.getElementById('modal-input');
const cancelBtn = document.getElementById('modal-cancel');
const confirmBtn = document.getElementById('modal-confirm');

export function confirmDialog({ message, detail, confirmText = 'Remove', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = true;
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

export function promptDialog({ message, detail, defaultValue = '', placeholder = '', confirmText = 'Commit', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = false;
    inputEl.value = defaultValue;
    inputEl.placeholder = placeholder;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove('danger');
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      inputEl.focus();
      inputEl.select();
    });

    // Disable confirm while input is empty
    const syncConfirmEnabled = () => {
      confirmBtn.disabled = !inputEl.value.trim();
    };
    syncConfirmEnabled();

    const cleanup = (result) => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.hidden = true; inputEl.hidden = true; confirmBtn.disabled = false; }, 180);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      inputEl.removeEventListener('input', syncConfirmEnabled);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onConfirm = () => {
      const v = inputEl.value.trim();
      if (!v) return; // never allow empty
      cleanup(v);
    };
    const onCancel  = () => cleanup(null);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(null); };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
      else if (e.key === 'Enter' && document.activeElement === inputEl) onConfirm();
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    inputEl.addEventListener('input', syncConfirmEnabled);
    document.addEventListener('keydown', onKey);
  });
}
