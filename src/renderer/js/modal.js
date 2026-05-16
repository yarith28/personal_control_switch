const overlay   = document.getElementById('confirm-modal');
const messageEl = document.getElementById('modal-message');
const detailEl  = document.getElementById('modal-detail');
const inputEl   = document.getElementById('modal-input');
const optionEl = document.getElementById('modal-option');
const optionInput = document.getElementById('modal-option-input');
const optionLabel = document.getElementById('modal-option-label');
const cancelBtn = document.getElementById('modal-cancel');
const confirmBtn = document.getElementById('modal-confirm');

export function confirmDialog({ message, detail, confirmText = 'Remove', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = true;
    optionEl.hidden = true;
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

export function promptDialog({
  message,
  detail,
  defaultValue = '',
  placeholder,
  confirmText = 'Commit',
  cancelText = 'Cancel',
  checkbox = null,
} = {}) {
  return new Promise((resolve) => {
    let regularDraft = defaultValue;
    let checkedDraft = checkbox?.inputValue ?? defaultValue;
    let checkboxWasChecked = Boolean(checkbox?.checked);
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = false;
    inputEl.value = checkboxWasChecked ? checkedDraft : regularDraft;
    inputEl.placeholder = placeholder;
    optionEl.hidden = !checkbox;
    optionInput.checked = Boolean(checkbox?.checked);
    optionLabel.textContent = checkbox?.label || '';
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
    const syncInputDraft = () => {
      if (optionInput.checked) checkedDraft = inputEl.value;
      else regularDraft = inputEl.value;
      syncConfirmEnabled();
    };
    const syncCheckboxState = () => {
      const checked = Boolean(checkbox && optionInput.checked);
      if (checked !== checkboxWasChecked) {
        inputEl.value = checked ? checkedDraft : regularDraft;
        checkboxWasChecked = checked;
      }
      confirmBtn.textContent = checked ? (checkbox.confirmText || confirmText) : confirmText;
      detailEl.textContent = checked ? (checkbox.detail || detail || '') : (detail || '');
      detailEl.hidden = !detailEl.textContent;
      syncConfirmEnabled();
      inputEl.focus();
      inputEl.select();
    };
    syncConfirmEnabled();
    syncCheckboxState();

    const cleanup = (result) => {
      overlay.classList.remove('open');
      setTimeout(() => {
        overlay.hidden = true;
        inputEl.hidden = true;
        optionEl.hidden = true;
        confirmBtn.disabled = false;
      }, 180);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      inputEl.removeEventListener('input', syncInputDraft);
      optionInput.removeEventListener('change', syncCheckboxState);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onConfirm = () => {
      const v = inputEl.value.trim();
      if (!v) return; // never allow empty
      cleanup(checkbox ? { value: v, checked: optionInput.checked } : v);
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
    inputEl.addEventListener('input', syncInputDraft);
    optionInput.addEventListener('change', syncCheckboxState);
    document.addEventListener('keydown', onKey);
  });
}
