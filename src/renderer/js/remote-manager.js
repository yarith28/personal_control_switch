import {
  normalizeAppRemotes,
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

function remoteFromUpstream(project) {
  const upstream = String(project?.upstream || '');
  const names = Array.isArray(project?.gitRemoteNames) ? project.gitRemoteNames : [];
  const matched = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((name) => upstream.startsWith(`${name}/`));
  if (matched) return matched;
  return names.length ? '' : upstream.split('/')[0] || '';
}

function preferredRemoteName(project, remotes) {
  const names = remotes.map((remote) => remote.name);
  if (names.includes(project.selectedRemoteName)) return project.selectedRemoteName;
  const upstreamRemote = remoteFromUpstream({ ...project, gitRemoteNames: names });
  if (upstreamRemote) return upstreamRemote;
  if (names.includes('origin')) return 'origin';
  return names[0] || '';
}

export function createRemoteTag(project, { disabled = () => false, onChange } = {}) {
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'name-remote';

  const sync = () => {
    const name = project.selectedRemoteName || remoteFromUpstream(project) || 'Remote';
    tag.textContent = name;
    tag.classList.toggle('unset', name === 'Remote');
    tag.title = name === 'Remote'
      ? 'Open remote manager'
      : `Manage the URL for ${name}`;
    tag.setAttribute('aria-label', `${tag.title}.`);
  };

  tag.addEventListener('click', (event) => {
    event.stopPropagation();
    if (disabled()) return;
    openRemoteManager(project, {
      onChange: async ({ refresh = false } = {}) => {
        sync();
        if (refresh) await onChange?.();
      },
    });
  });
  sync();
  return tag;
}

export function openRemoteManager(project, { onChange } = {}) {
  document.querySelector('.remote-manager-overlay')?.remove();
  project.appRemotes = normalizeAppRemotes(project.appRemotes);
  project.selectedRemoteId = null;

  let editingId = null;
  let gitRemotes = [];
  let selectedRemoteName = '';
  let closed = false;
  let swapping = false;

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
  intro.textContent = 'Choose a repository remote, then swap its Git URL to one of your saved targets.';
  headingWrap.append(eyebrow, title, intro);
  const closeButton = buttonWithIcon('remote-manager-close', 'x', 'Close remote manager');
  header.append(headingWrap, closeButton);

  const targetPanel = document.createElement('div');
  targetPanel.className = 'remote-target-panel';
  const targetLabel = document.createElement('label');
  targetLabel.className = 'remote-target-field';
  const targetCaption = document.createElement('span');
  targetCaption.textContent = 'Repository remote';
  const targetSelect = document.createElement('select');
  targetSelect.setAttribute('aria-label', 'Repository remote to update');
  targetLabel.append(targetCaption, targetSelect);
  const currentWrap = document.createElement('div');
  currentWrap.className = 'remote-current';
  const currentCaption = document.createElement('span');
  currentCaption.className = 'remote-current-caption';
  currentCaption.textContent = 'Current URL';
  const currentUrl = document.createElement('span');
  currentUrl.className = 'remote-current-url';
  currentUrl.textContent = 'Reading Git configuration...';
  const pushUrlNote = document.createElement('span');
  pushUrlNote.className = 'remote-push-url-note';
  pushUrlNote.hidden = true;
  currentWrap.append(currentCaption, currentUrl, pushUrlNote);
  targetPanel.append(targetLabel, currentWrap);

  const list = document.createElement('div');
  list.className = 'remote-manager-list';

  const form = document.createElement('form');
  form.className = 'remote-manager-form';
  const formTitle = document.createElement('div');
  formTitle.className = 'remote-form-title';
  formTitle.textContent = 'Add URL target';
  const fields = document.createElement('div');
  fields.className = 'remote-form-fields';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'remote-form-field';
  const nameCaption = document.createElement('span');
  nameCaption.textContent = 'Target name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Work';
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
  saveButton.textContent = 'Add & use';
  formActions.append(cancelEditButton, testButton, saveButton);
  form.append(formTitle, fields, formStatus, formActions);

  const footer = document.createElement('div');
  footer.className = 'modal-actions remote-manager-footer';
  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'btn modal-confirm';
  doneButton.textContent = 'Done';
  footer.appendChild(doneButton);

  card.append(header, targetPanel, list, form, footer);
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

  const currentRemote = () => (
    gitRemotes.find((remote) => remote.name === selectedRemoteName) || null
  );

  const renderCurrentRemote = () => {
    const remote = currentRemote();
    currentUrl.textContent = remote?.url || (gitRemotes.length ? 'URL unavailable' : 'No Git remotes');
    currentUrl.title = remote?.url || '';
    const hasSeparatePushUrl = !!remote?.pushUrl && remote.pushUrl !== remote.url;
    pushUrlNote.hidden = !hasSeparatePushUrl;
    pushUrlNote.textContent = hasSeparatePushUrl
      ? `Push URL is separate and will stay unchanged: ${remote.pushUrl}`
      : '';
    pushUrlNote.title = hasSeparatePushUrl ? remote.pushUrl : '';
  };

  const resetForm = () => {
    editingId = null;
    nameInput.value = '';
    urlInput.value = '';
    formTitle.textContent = 'Add URL target';
    saveButton.textContent = 'Add & use';
    cancelEditButton.hidden = true;
    setStatus();
  };

  const notifyChange = async ({ refresh = false } = {}) => {
    await persist();
    await onChange?.({ refresh });
  };

  const setSwapping = (busy) => {
    swapping = busy;
    targetSelect.disabled = busy || !gitRemotes.length;
    saveButton.disabled = busy;
    testButton.disabled = busy;
    list.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
  };

  const useTarget = async (target) => {
    if (swapping) return false;
    const remote = currentRemote();
    if (!remote) {
      setStatus('Choose an existing repository remote first.', 'error');
      return false;
    }
    if (remote.url === target.url) {
      setStatus(`${remote.name} already uses ${target.name}.`, 'success');
      renderList();
      return true;
    }

    setSwapping(true);
    setStatus(`Updating ${remote.name}...`);
    try {
      const result = await window.api.setGitRemoteUrl(
        project.path,
        remote.name,
        target.url
      );
      if (!result.ok) {
        setStatus(result.errorSummary || `Could not update ${remote.name}.`, 'error');
        return false;
      }
      const index = gitRemotes.findIndex((entry) => entry.name === remote.name);
      if (index !== -1) gitRemotes[index] = result.remote;
      project.selectedRemoteName = remote.name;
      project.selectedRemoteId = null;
      renderCurrentRemote();
      renderList();
      setStatus(
        result.unchanged
          ? `${remote.name} already uses ${target.name}.`
          : `${remote.name} changed from ${result.previousUrl} to ${result.remote.url}.`,
        'success'
      );
      await notifyChange({ refresh: true });
      return true;
    } catch (error) {
      setStatus(error?.message || `Could not update ${remote.name}.`, 'error');
      return false;
    } finally {
      setSwapping(false);
    }
  };

  const renderList = () => {
    list.replaceChildren();
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'remote-list-title';
    sectionTitle.textContent = 'Saved URL targets';
    list.appendChild(sectionTitle);

    const activeUrl = currentRemote()?.url || '';
    for (const target of project.appRemotes) {
      const active = !!activeUrl && target.url === activeUrl;
      const row = document.createElement('div');
      row.className = `remote-manager-row${active ? ' active' : ''}`;
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'remote-row-choice';
      choice.setAttribute('aria-pressed', String(active));
      choice.setAttribute(
        'aria-label',
        active ? `${target.name} is currently used` : `Use ${target.name}`
      );
      const radio = document.createElement('span');
      radio.className = 'remote-radio';
      const copy = document.createElement('span');
      copy.className = 'remote-row-copy';
      const targetName = document.createElement('span');
      targetName.className = 'remote-row-name';
      targetName.textContent = target.name;
      const targetUrl = document.createElement('span');
      targetUrl.className = 'remote-row-url';
      targetUrl.textContent = target.url;
      targetUrl.title = target.url;
      copy.append(targetName, targetUrl);
      choice.append(radio, copy);
      choice.addEventListener('click', () => useTarget(target));

      const actions = document.createElement('div');
      actions.className = 'remote-row-actions';
      const editButton = buttonWithIcon('remote-row-action', 'pencil', `Edit ${target.name}`);
      editButton.addEventListener('click', () => {
        editingId = target.id;
        nameInput.value = target.name;
        urlInput.value = target.url;
        formTitle.textContent = `Edit ${target.name}`;
        saveButton.textContent = 'Save & use';
        cancelEditButton.hidden = false;
        setStatus();
        nameInput.focus();
        nameInput.select();
      });
      const deleteButton = buttonWithIcon('remote-row-action danger', 'trash2', `Delete ${target.name}`);
      deleteButton.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          message: `Delete “${target.name}”?`,
          detail: 'This removes the saved URL target. It does not change the repository remote.',
          confirmText: 'Delete',
        });
        if (!confirmed) return;
        project.appRemotes = project.appRemotes.filter((entry) => entry.id !== target.id);
        if (editingId === target.id) resetForm();
        renderList();
        await window.api.clearAppRemote(project.path, target.id);
        await notifyChange();
      });
      actions.append(editButton, deleteButton);
      row.append(choice, actions);
      list.appendChild(row);
    }

    if (!project.appRemotes.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-manager-empty';
      empty.textContent = 'No saved URL targets yet.';
      list.appendChild(empty);
    }
  };

  const renderRemoteOptions = () => {
    targetSelect.replaceChildren();
    if (!gitRemotes.length) {
      const option = document.createElement('option');
      option.textContent = 'No Git remotes';
      option.value = '';
      targetSelect.appendChild(option);
      targetSelect.disabled = true;
      selectedRemoteName = '';
      renderCurrentRemote();
      renderList();
      return;
    }

    for (const remote of gitRemotes) {
      const option = document.createElement('option');
      option.value = remote.name;
      option.textContent = remote.name;
      targetSelect.appendChild(option);
    }
    selectedRemoteName = preferredRemoteName(project, gitRemotes);
    targetSelect.value = selectedRemoteName;
    targetSelect.disabled = false;
    project.selectedRemoteName = selectedRemoteName;
    renderCurrentRemote();
    renderList();
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
      setStatus('A target with this name already exists.', 'error');
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
    resetForm();
    renderList();
    await notifyChange();
    await useTarget({ id, ...draft });
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

  targetSelect.addEventListener('change', async () => {
    selectedRemoteName = targetSelect.value;
    project.selectedRemoteName = selectedRemoteName;
    renderCurrentRemote();
    renderList();
    setStatus();
    await notifyChange();
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
    doneButton.focus();
  });

  window.api.getGitRemotes(project.path)
    .then(async (result) => {
      if (closed) return;
      if (!result.ok) {
        currentUrl.textContent = 'Could not read Git remotes';
        setStatus(result.errorSummary || 'Could not read repository remotes.', 'error');
        return;
      }
      gitRemotes = result.remotes;
      renderRemoteOptions();
      await notifyChange();
      if (!gitRemotes.length) {
        setStatus('This repository has no remotes. Add one with Git before using a URL target.', 'error');
      }
    })
    .catch((error) => {
      if (closed) return;
      currentUrl.textContent = 'Could not read Git remotes';
      setStatus(error?.message || 'Could not read repository remotes.', 'error');
    });
}
