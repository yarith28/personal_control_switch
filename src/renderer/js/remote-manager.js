import {
  normalizeAppRemotes,
  selectedAppRemote,
  validateAppRemoteDraft,
} from './app-remotes.mjs';
import { persist } from './persist.js';
import { confirmDialog } from './modal.js';
import { iconElement } from './icons.js';
import { basename } from './util.js';

function makeRemoteId(remotes) {
  const existing = new Set(remotes.map((remote) => remote.id));
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
    id = `remote_${Date.now().toString(36)}_${random}`;
  } while (existing.has(id));
  return id;
}

function buttonWithIcon(className, icon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(iconElement(icon, { size: 12, strokeWidth: 1.9 }));
  return button;
}

export function createRemoteTag(project, { disabled = () => false, onChange } = {}) {
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'name-remote';

  const sync = () => {
    const remote = selectedAppRemote(project);
    tag.textContent = remote?.name || 'Remote';
    tag.classList.toggle('unset', !remote);
    tag.title = remote
      ? `App remote: ${remote.name}\n${remote.url}`
      : 'Choose an app-managed remote';
    tag.setAttribute(
      'aria-label',
      remote ? `Remote ${remote.name}. Open remote manager.` : 'No app remote selected. Open remote manager.'
    );
  };

  tag.addEventListener('click', (event) => {
    event.stopPropagation();
    if (disabled()) return;
    openRemoteManager(project, {
      onChange: async () => {
        sync();
        await onChange?.();
      },
    });
  });
  sync();
  return tag;
}

export function openRemoteManager(project, { onChange } = {}) {
  document.querySelector('.remote-manager-overlay')?.remove();
  project.appRemotes = normalizeAppRemotes(project.appRemotes);
  if (!project.appRemotes.some((remote) => remote.id === project.selectedRemoteId)) {
    project.selectedRemoteId = null;
  }

  let editingId = null;
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay remote-manager-overlay';
  const card = document.createElement('div');
  card.className = 'modal-card remote-manager-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'remote-manager-title');

  const header = document.createElement('div');
  header.className = 'remote-manager-header';
  const headingWrap = document.createElement('div');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'remote-manager-eyebrow';
  eyebrow.textContent = basename(project.path);
  const title = document.createElement('div');
  title.className = 'modal-message';
  title.id = 'remote-manager-title';
  title.textContent = 'Remote manager';
  const intro = document.createElement('div');
  intro.className = 'remote-manager-intro';
  intro.textContent = 'The selected URL is used for fetch, pull, and push. Git configuration is not changed.';
  headingWrap.append(eyebrow, title, intro);
  const closeButton = buttonWithIcon('remote-manager-close', 'x', 'Close remote manager');
  header.append(headingWrap, closeButton);

  const list = document.createElement('div');
  list.className = 'remote-manager-list';

  const form = document.createElement('form');
  form.className = 'remote-manager-form';
  const formTitle = document.createElement('div');
  formTitle.className = 'remote-form-title';
  formTitle.textContent = 'Add remote';
  const fields = document.createElement('div');
  fields.className = 'remote-form-fields';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'remote-form-field';
  const nameCaption = document.createElement('span');
  nameCaption.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'origin';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameLabel.append(nameCaption, nameInput);

  const urlLabel = document.createElement('label');
  urlLabel.className = 'remote-form-field remote-url-field';
  const urlCaption = document.createElement('span');
  urlCaption.textContent = 'URL or local path';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'git@github.com:team/project.git';
  urlInput.autocomplete = 'off';
  urlInput.spellcheck = false;
  urlLabel.append(urlCaption, urlInput);
  fields.append(nameLabel, urlLabel);

  const formStatus = document.createElement('div');
  formStatus.className = 'remote-form-status';
  formStatus.setAttribute('aria-live', 'polite');
  const formActions = document.createElement('div');
  formActions.className = 'remote-form-actions';
  const cancelEditButton = document.createElement('button');
  cancelEditButton.type = 'button';
  cancelEditButton.className = 'btn remote-form-cancel';
  cancelEditButton.textContent = 'Cancel edit';
  cancelEditButton.hidden = true;
  const testButton = document.createElement('button');
  testButton.type = 'button';
  testButton.className = 'btn remote-form-test';
  testButton.textContent = 'Test';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'btn remote-form-save';
  saveButton.textContent = 'Add & select';
  formActions.append(cancelEditButton, testButton, saveButton);
  form.append(formTitle, fields, formStatus, formActions);

  const footer = document.createElement('div');
  footer.className = 'modal-actions remote-manager-footer';
  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'btn modal-confirm';
  doneButton.textContent = 'Done';
  footer.appendChild(doneButton);

  card.append(header, list, form, footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKeydown);
    setTimeout(() => overlay.remove(), 180);
  };

  const setStatus = (message = '', tone = '') => {
    formStatus.textContent = message;
    formStatus.classList.toggle('error', tone === 'error');
    formStatus.classList.toggle('success', tone === 'success');
  };

  const resetForm = () => {
    editingId = null;
    nameInput.value = '';
    urlInput.value = '';
    formTitle.textContent = 'Add remote';
    saveButton.textContent = 'Add & select';
    cancelEditButton.hidden = true;
    setStatus();
  };

  const notifyChange = async () => {
    await persist();
    await onChange?.();
  };

  const selectRemote = async (id) => {
    project.selectedRemoteId = id;
    renderList();
    await notifyChange();
  };

  const renderList = () => {
    list.replaceChildren();
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'remote-list-title';
    sectionTitle.textContent = 'Use for this project';
    list.appendChild(sectionTitle);

    const defaultRow = document.createElement('button');
    defaultRow.type = 'button';
    defaultRow.className = `remote-manager-row remote-default-row${project.selectedRemoteId ? '' : ' active'}`;
    defaultRow.setAttribute('aria-pressed', String(!project.selectedRemoteId));
    const defaultRadio = document.createElement('span');
    defaultRadio.className = 'remote-radio';
    const defaultCopy = document.createElement('span');
    defaultCopy.className = 'remote-row-copy';
    const defaultName = document.createElement('span');
    defaultName.className = 'remote-row-name';
    defaultName.textContent = 'Repository default';
    const defaultDetail = document.createElement('span');
    defaultDetail.className = 'remote-row-url';
    defaultDetail.textContent = 'Use the repository’s existing Git remote and upstream';
    defaultCopy.append(defaultName, defaultDetail);
    defaultRow.append(defaultRadio, defaultCopy);
    defaultRow.addEventListener('click', () => selectRemote(null));
    list.appendChild(defaultRow);

    for (const remote of project.appRemotes) {
      const row = document.createElement('div');
      row.className = `remote-manager-row${remote.id === project.selectedRemoteId ? ' active' : ''}`;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'remote-row-choice';
      choice.setAttribute('aria-pressed', String(remote.id === project.selectedRemoteId));
      choice.setAttribute('aria-label', `Use ${remote.name}`);
      const radio = document.createElement('span');
      radio.className = 'remote-radio';
      const copy = document.createElement('span');
      copy.className = 'remote-row-copy';
      const remoteName = document.createElement('span');
      remoteName.className = 'remote-row-name';
      remoteName.textContent = remote.name;
      const remoteUrl = document.createElement('span');
      remoteUrl.className = 'remote-row-url';
      remoteUrl.textContent = remote.url;
      remoteUrl.title = remote.url;
      copy.append(remoteName, remoteUrl);
      choice.append(radio, copy);
      choice.addEventListener('click', () => selectRemote(remote.id));

      const actions = document.createElement('div');
      actions.className = 'remote-row-actions';
      const editButton = buttonWithIcon('remote-row-action', 'pencil', `Edit ${remote.name}`);
      editButton.addEventListener('click', () => {
        editingId = remote.id;
        nameInput.value = remote.name;
        urlInput.value = remote.url;
        formTitle.textContent = `Edit ${remote.name}`;
        saveButton.textContent = 'Save & select';
        cancelEditButton.hidden = false;
        setStatus();
        nameInput.focus();
        nameInput.select();
      });
      const deleteButton = buttonWithIcon('remote-row-action danger', 'trash2', `Delete ${remote.name}`);
      deleteButton.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          message: `Delete “${remote.name}”?`,
          detail: 'This removes the remote from Git Sync only. Git configuration is not changed.',
          confirmText: 'Delete',
        });
        if (!confirmed) return;
        project.appRemotes = project.appRemotes.filter((entry) => entry.id !== remote.id);
        if (project.selectedRemoteId === remote.id) project.selectedRemoteId = null;
        if (editingId === remote.id) resetForm();
        renderList();
        await window.api.clearAppRemote(project.path, remote.id);
        await notifyChange();
      });
      actions.append(editButton, deleteButton);
      row.append(choice, actions);
      list.appendChild(row);
    }

    if (!project.appRemotes.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-manager-empty';
      empty.textContent = 'No app-managed remotes yet.';
      list.appendChild(empty);
    }
  };

  const draftRemote = () => {
    const validation = validateAppRemoteDraft(nameInput.value, urlInput.value);
    if (!validation.ok) {
      setStatus(validation.error, 'error');
      return null;
    }
    const duplicate = project.appRemotes.find((remote) => (
      remote.id !== editingId
      && remote.name.toLocaleLowerCase() === validation.remote.name.toLocaleLowerCase()
    ));
    if (duplicate) {
      setStatus('A remote with this name already exists.', 'error');
      return null;
    }
    return validation.remote;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const draft = draftRemote();
    if (!draft) return;

    const existing = project.appRemotes.find((remote) => remote.id === editingId);
    const id = existing?.id || makeRemoteId(project.appRemotes);
    if (existing) {
      if (existing.url !== draft.url) await window.api.clearAppRemote(project.path, existing.id);
      existing.name = draft.name;
      existing.url = draft.url;
    } else {
      project.appRemotes.push({ id, ...draft });
    }
    project.selectedRemoteId = id;
    resetForm();
    renderList();
    await notifyChange();
  });

  testButton.addEventListener('click', async () => {
    const draft = draftRemote();
    if (!draft) return;
    const id = editingId || makeRemoteId(project.appRemotes);
    testButton.disabled = true;
    saveButton.disabled = true;
    setStatus(`Connecting to ${draft.name}...`);
    try {
      const result = await window.api.testAppRemote(project.path, { id, ...draft });
      setStatus(
        result.ok ? 'Connection successful.' : (result.errorSummary || 'Connection failed.'),
        result.ok ? 'success' : 'error'
      );
    } finally {
      testButton.disabled = false;
      saveButton.disabled = false;
    }
  });

  cancelEditButton.addEventListener('click', resetForm);
  closeButton.addEventListener('click', close);
  doneButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('confirm-modal')?.hidden) return;
    close();
  };
  document.addEventListener('keydown', onKeydown);

  renderList();
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    if (!project.appRemotes.length) nameInput.focus();
    else doneButton.focus();
  });
}
