import { iconElement } from './icons.js';

const overlay   = document.getElementById('confirm-modal');
const cardEl = overlay.querySelector('.modal-card');
const messageEl = document.getElementById('modal-message');
const detailEl  = document.getElementById('modal-detail');
const inputEl   = document.getElementById('modal-input');
const optionEl = document.getElementById('modal-option');
const optionInput = document.getElementById('modal-option-input');
const optionLabel = document.getElementById('modal-option-label');
const selectionEl = document.getElementById('modal-selection');
const cancelBtn = document.getElementById('modal-cancel');
const confirmBtn = document.getElementById('modal-confirm');

function hideSelection() {
  selectionEl.hidden = true;
  selectionEl.replaceChildren();
  cardEl.classList.remove('modal-card-wide');
}

export function confirmDialog({ message, detail, confirmText = 'Remove', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = true;
    optionEl.hidden = true;
    hideSelection();
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
    hideSelection();
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

function selectionCheckbox({ checked = false, disabled = false } = {}) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  const box = document.createElement('span');
  box.className = 'checkbox-box';
  box.appendChild(iconElement('check', {
    size: 9,
    strokeWidth: 2.1,
    className: 'checkbox-check',
  }));
  const dash = document.createElement('span');
  dash.className = 'checkbox-dash';
  dash.textContent = '−';
  box.appendChild(dash);
  return { input, box };
}

export function selectionDialog({
  message,
  detail,
  items = [],
  confirmText = 'Import',
  cancelText = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    messageEl.textContent = message || '';
    detailEl.textContent = detail || '';
    detailEl.hidden = !detail;
    inputEl.hidden = true;
    optionEl.hidden = true;
    selectionEl.hidden = false;
    selectionEl.replaceChildren();
    cardEl.classList.add('modal-card-wide');
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove('danger');

    const enabledItems = items.filter((item) => !item.disabled);
    const selected = new Set(enabledItems.filter((item) => item.checked !== false).map((item) => item.value));
    const itemInputs = new Map();

    const selectAllRow = document.createElement('label');
    selectAllRow.className = 'modal-selection-all';
    const selectAllControl = selectionCheckbox({
      checked: selected.size > 0,
      disabled: enabledItems.length === 0,
    });
    const selectAllText = document.createElement('span');
    selectAllText.textContent = 'Select all available repositories';
    selectAllRow.append(selectAllControl.input, selectAllControl.box, selectAllText);

    const list = document.createElement('div');
    list.className = 'modal-selection-list';
    list.setAttribute('role', 'list');

    for (const item of items) {
      const row = document.createElement('label');
      row.className = `modal-selection-item${item.disabled ? ' disabled' : ''}`;
      row.title = item.description || item.value;
      row.setAttribute('role', 'listitem');
      const control = selectionCheckbox({
        checked: selected.has(item.value),
        disabled: Boolean(item.disabled),
      });
      itemInputs.set(item.value, control.input);

      const copy = document.createElement('span');
      copy.className = 'modal-selection-copy';
      const name = document.createElement('span');
      name.className = 'modal-selection-name';
      name.textContent = item.label || item.value;
      const path = document.createElement('span');
      path.className = 'modal-selection-path';
      path.textContent = item.description || item.value;
      copy.append(name, path);
      row.append(control.input, control.box, copy);

      if (item.disabled) {
        const status = document.createElement('span');
        status.className = 'modal-selection-status';
        status.textContent = item.disabledLabel || 'Already added';
        row.appendChild(status);
      }
      list.appendChild(row);
    }

    selectionEl.append(selectAllRow, list);

    const sync = () => {
      for (const item of enabledItems) {
        const input = itemInputs.get(item.value);
        if (input?.checked) selected.add(item.value);
        else selected.delete(item.value);
      }
      selectAllControl.input.checked = enabledItems.length > 0 && selected.size === enabledItems.length;
      selectAllControl.input.indeterminate = selected.size > 0 && selected.size < enabledItems.length;
      confirmBtn.disabled = selected.size === 0;
      confirmBtn.textContent = selected.size > 0 ? `${confirmText} ${selected.size}` : confirmText;
    };

    selectAllControl.input.addEventListener('change', () => {
      for (const item of enabledItems) {
        itemInputs.get(item.value).checked = selectAllControl.input.checked;
      }
      sync();
    });
    for (const item of enabledItems) itemInputs.get(item.value).addEventListener('change', sync);
    sync();

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
    confirmBtn.focus();

    const cleanup = (result) => {
      overlay.classList.remove('open');
      setTimeout(() => {
        overlay.hidden = true;
        confirmBtn.disabled = false;
        hideSelection();
      }, 180);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onConfirm = () => {
      if (selected.size > 0) cleanup(items.map((item) => item.value).filter((value) => selected.has(value)));
    };
    const onCancel = () => cleanup(null);
    const onBackdrop = (event) => { if (event.target === overlay) cleanup(null); };
    const onKey = (event) => {
      if (event.key === 'Escape') cleanup(null);
      else if (event.key === 'Enter' && document.activeElement === confirmBtn) onConfirm();
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}
