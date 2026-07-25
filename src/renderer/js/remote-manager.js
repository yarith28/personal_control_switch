import { normalizeAppRemotes } from './app-remotes.mjs';
import {
  mergeConfiguredRemoteUrls,
  normalizeRemoteUrlOptions,
  validateRemoteUrl,
} from './remote-url-options.mjs';
import { persist } from './persist.js';
import { confirmDialog } from './modal.js';
import { iconElement } from './icons.js';
import { basename } from './util.js';

function makeRemoteId(options) {
  const existing = new Set(options.map((option) => option.id));
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
    id = `remote_${Date.now().toString(36)}_${random}`;
  } while (existing.has(id));
  return id;
}

function iconButton(className, icon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(iconElement(icon, { size: 12, strokeWidth: 1.9 }));
  return button;
}

function textButton(className, icon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.append(
    iconElement(icon, { size: 12, strokeWidth: 1.9 }),
    document.createTextNode(label)
  );
  return button;
}

function remoteFromUpstream(project, names = []) {
  const upstream = String(project?.upstream || '');
  const matched = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((name) => upstream.startsWith(`${name}/`));
  if (matched) return matched;
  return names.length ? '' : upstream.split('/')[0] || '';
}

function primaryRemoteName(project, remotes) {
  const names = remotes.map((remote) => remote.name);
  if (names.includes(project.selectedRemoteName)) return project.selectedRemoteName;
  const upstreamRemote = remoteFromUpstream(project, names);
  if (upstreamRemote) return upstreamRemote;
  if (names.includes('origin')) return 'origin';
  return names[0] || '';
}

export function createRemoteTag(project, { disabled = () => false, onChange } = {}) {
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'name-remote';

  const sync = () => {
    const names = Array.isArray(project.gitRemoteNames) ? project.gitRemoteNames : [];
    const fallback = remoteFromUpstream(project);
    const label = names.length > 1 ? 'Remotes' : (names[0] || fallback || 'Remote');
    tag.textContent = label;
    tag.classList.toggle('unset', label === 'Remote');
    tag.title = 'Open remote manager';
    tag.setAttribute('aria-label', 'Open remote manager.');
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
  project.remoteUrls = normalizeRemoteUrlOptions(project.remoteUrls);
  project.appRemotes = normalizeAppRemotes(project.appRemotes);
  project.selectedRemoteId = null;

  let gitRemotes = [];
  let closed = false;
  let busy = false;

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
  intro.textContent = 'Select the URL each repository remote should use.';
  headingWrap.append(eyebrow, title, intro);
  const closeButton = iconButton('remote-manager-close', 'x', 'Close remote manager');
  header.append(headingWrap, closeButton);

  const list = document.createElement('div');
  list.className = 'remote-manager-list remote-group-list';

  const addRemotePanel = document.createElement('div');
  addRemotePanel.className = 'remote-add-panel';
  const addRemoteButton = textButton('remote-add-remote', 'plus', 'Add remote');
  const addRemoteForm = document.createElement('form');
  addRemoteForm.className = 'remote-add-form';
  addRemoteForm.hidden = true;
  const addRemoteName = document.createElement('input');
  addRemoteName.type = 'text';
  addRemoteName.placeholder = 'Remote name';
  addRemoteName.autocomplete = 'off';
  addRemoteName.spellcheck = false;
  addRemoteName.setAttribute('aria-label', 'New remote name');
  const addRemoteUrl = document.createElement('input');
  addRemoteUrl.type = 'text';
  addRemoteUrl.placeholder = 'Remote URL or local path';
  addRemoteUrl.autocomplete = 'off';
  addRemoteUrl.spellcheck = false;
  addRemoteUrl.setAttribute('aria-label', 'New remote URL');
  const addRemoteActions = document.createElement('div');
  addRemoteActions.className = 'remote-add-form-actions';
  const cancelAddRemote = document.createElement('button');
  cancelAddRemote.type = 'button';
  cancelAddRemote.className = 'btn remote-form-cancel';
  cancelAddRemote.textContent = 'Cancel';
  const testAddRemote = document.createElement('button');
  testAddRemote.type = 'button';
  testAddRemote.className = 'btn remote-form-test';
  testAddRemote.textContent = 'Test';
  const saveAddRemote = document.createElement('button');
  saveAddRemote.type = 'submit';
  saveAddRemote.className = 'btn remote-form-save';
  saveAddRemote.textContent = 'Add';
  addRemoteActions.append(cancelAddRemote, testAddRemote, saveAddRemote);
  addRemoteForm.append(addRemoteName, addRemoteUrl, addRemoteActions);
  addRemotePanel.append(addRemoteButton, addRemoteForm);

  const status = document.createElement('div');
  status.className = 'remote-manager-status';
  status.setAttribute('aria-live', 'polite');

  const footer = document.createElement('div');
  footer.className = 'modal-actions remote-manager-footer';
  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'btn modal-confirm';
  doneButton.textContent = 'Done';
  footer.appendChild(doneButton);

  card.append(header, list, addRemotePanel, status, footer);
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
    status.textContent = message;
    status.classList.toggle('error', tone === 'error');
    status.classList.toggle('success', tone === 'success');
  };

  const notifyChange = async ({ refresh = false } = {}) => {
    await persist();
    await onChange?.({ refresh });
  };

  const setBusy = (value) => {
    busy = value;
    card.querySelectorAll(
      '.remote-manager-list button, .remote-manager-list input, .remote-add-panel button, .remote-add-panel input'
    ).forEach((control) => {
      control.disabled = value;
    });
  };

  const currentRemote = (name) => (
    gitRemotes.find((remote) => remote.name === name) || null
  );

  const importConfiguredUrls = () => {
    const merged = mergeConfiguredRemoteUrls(
      project.remoteUrls,
      gitRemotes,
      makeRemoteId
    );
    project.remoteUrls = merged.options;
    return merged.changed;
  };

  const useOption = async (remoteName, option) => {
    if (busy) return false;
    const remote = currentRemote(remoteName);
    if (!remote) {
      setStatus(`Remote ${remoteName} no longer exists.`, 'error');
      return false;
    }
    if (remote.url === option.url) {
      setStatus(`${remoteName} already uses this URL.`, 'success');
      renderGroups();
      return true;
    }

    setBusy(true);
    setStatus(`Updating ${remoteName}...`);
    try {
      const result = await window.api.setGitRemoteUrl(project.path, remoteName, option.url);
      if (!result.ok) {
        setStatus(result.errorSummary || `Could not update ${remoteName}.`, 'error');
        if (importConfiguredUrls()) await notifyChange();
        renderGroups();
        return false;
      }
      const index = gitRemotes.findIndex((entry) => entry.name === remoteName);
      if (index !== -1) gitRemotes[index] = result.remote;
      setStatus(
        result.unchanged
          ? `${remoteName} already uses this URL.`
          : `${remoteName} changed from ${result.previousUrl} to ${result.remote.url}.`,
        'success'
      );
      renderGroups();
      await notifyChange({ refresh: true });
      return true;
    } catch (error) {
      setStatus(error?.message || `Could not update ${remoteName}.`, 'error');
      if (importConfiguredUrls()) await notifyChange();
      renderGroups();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const buildUrlForm = (remote, group, addButton) => {
    const form = document.createElement('form');
    form.className = 'remote-url-form';
    form.hidden = true;
    let editingId = null;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Remote URL or local path';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `URL for ${remote.name}`);

    const actions = document.createElement('div');
    actions.className = 'remote-url-form-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn remote-form-cancel';
    cancelButton.textContent = 'Cancel';
    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.className = 'btn remote-form-test';
    testButton.textContent = 'Test';
    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'btn remote-form-save';
    saveButton.textContent = 'Add & use';
    actions.append(cancelButton, testButton, saveButton);
    form.append(input, actions);

    const hide = () => {
      editingId = null;
      input.value = '';
      form.hidden = true;
      addButton.hidden = false;
    };

    const show = (option = null) => {
      editingId = option?.id || null;
      input.value = option?.url || '';
      saveButton.textContent = option ? 'Save & use' : 'Add & use';
      form.hidden = false;
      addButton.hidden = true;
      setStatus();
      input.focus();
      if (option) input.select();
    };

    addButton.addEventListener('click', () => show());
    cancelButton.addEventListener('click', hide);

    testButton.addEventListener('click', async () => {
      const validation = validateRemoteUrl(input.value);
      if (!validation.ok) {
        setStatus(validation.error, 'error');
        return;
      }
      testButton.disabled = true;
      saveButton.disabled = true;
      setStatus(`Connecting to ${remote.name}...`);
      try {
        const result = await window.api.testAppRemote(project.path, {
          id: editingId || makeRemoteId(project.remoteUrls),
          name: remote.name,
          url: validation.url,
        });
        setStatus(
          result.ok ? 'Connection successful.' : (result.errorSummary || 'Connection failed.'),
          result.ok ? 'success' : 'error'
        );
      } finally {
        testButton.disabled = false;
        saveButton.disabled = false;
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const validation = validateRemoteUrl(input.value);
      if (!validation.ok) {
        setStatus(validation.error, 'error');
        return;
      }
      const duplicate = project.remoteUrls.find((option) => (
        option.id !== editingId
        && option.remoteName === remote.name
        && option.url === validation.url
      ));
      if (duplicate) {
        hide();
        await useOption(remote.name, duplicate);
        return;
      }

      const existing = project.remoteUrls.find((option) => option.id === editingId);
      const option = existing || {
        id: makeRemoteId(project.remoteUrls),
        remoteName: remote.name,
        url: validation.url,
      };
      if (existing) existing.url = validation.url;
      else project.remoteUrls.push(option);
      hide();
      await notifyChange();
      await useOption(remote.name, option);
    });

    group.appendChild(form);
    return { show };
  };

  const renderGroups = () => {
    list.replaceChildren();
    if (!gitRemotes.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-manager-empty';
      empty.textContent = 'This repository has no Git remotes.';
      list.appendChild(empty);
      return;
    }

    gitRemotes.forEach((remote, groupIndex) => {
      const group = document.createElement('section');
      group.className = 'remote-group';
      const groupHeader = document.createElement('div');
      groupHeader.className = 'remote-group-header';
      const groupName = document.createElement('h3');
      groupName.className = 'remote-group-name';
      groupName.textContent = remote.name;
      groupHeader.appendChild(groupName);
      group.appendChild(groupHeader);

      if (remote.pushUrl && remote.pushUrl !== remote.url) {
        const pushNote = document.createElement('div');
        pushNote.className = 'remote-push-url-note';
        pushNote.textContent = `Separate push URL stays unchanged: ${remote.pushUrl}`;
        pushNote.title = remote.pushUrl;
        group.appendChild(pushNote);
      }

      const options = project.remoteUrls.filter((option) => option.remoteName === remote.name);
      const optionList = document.createElement('div');
      optionList.className = 'remote-url-list';
      const radioName = `remote-url-${groupIndex}`;
      let formControl;

      for (const option of options) {
        const active = option.url === remote.url;
        const row = document.createElement('div');
        row.className = `remote-url-row${active ? ' active' : ''}`;
        const choice = document.createElement('label');
        choice.className = 'remote-url-choice';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = radioName;
        radio.value = option.id;
        radio.checked = active;
        radio.setAttribute('aria-label', `Use ${option.url} for ${remote.name}`);
        const url = document.createElement('span');
        url.className = 'remote-row-url';
        url.textContent = option.url;
        url.title = option.url;
        choice.append(radio, url);
        radio.addEventListener('change', () => {
          if (radio.checked) useOption(remote.name, option);
        });

        const actions = document.createElement('div');
        actions.className = 'remote-row-actions';
        const editButton = iconButton('remote-row-action', 'pencil', `Edit ${option.url}`);
        editButton.addEventListener('click', () => formControl.show(option));
        const deleteButton = iconButton('remote-row-action danger', 'trash2', `Delete ${option.url}`);
        deleteButton.disabled = active;
        if (active) {
          deleteButton.title = 'Select another URL before deleting this one';
          deleteButton.setAttribute('aria-label', deleteButton.title);
        }
        deleteButton.addEventListener('click', async () => {
          if (active) return;
          const confirmed = await confirmDialog({
            message: 'Delete this URL?',
            detail: option.url,
            confirmText: 'Delete',
          });
          if (!confirmed) return;
          project.remoteUrls = project.remoteUrls.filter((entry) => entry.id !== option.id);
          renderGroups();
          await notifyChange();
        });
        actions.append(editButton, deleteButton);
        row.append(choice, actions);
        optionList.appendChild(row);
      }
      group.appendChild(optionList);

      const addButton = textButton('remote-add-url', 'plus', 'Add URL');
      group.appendChild(addButton);
      formControl = buildUrlForm(remote, group, addButton);
      list.appendChild(group);
    });
  };

  const migrateAndImport = () => {
    const primaryName = primaryRemoteName(project, gitRemotes);
    if (primaryName && project.appRemotes.length) {
      for (const legacy of project.appRemotes) {
        const duplicate = project.remoteUrls.some((option) => (
          option.remoteName === primaryName && option.url === legacy.url
        ));
        if (!duplicate) {
          project.remoteUrls.push({
            id: makeRemoteId(project.remoteUrls),
            remoteName: primaryName,
            url: legacy.url,
          });
        }
      }
      project.appRemotes = [];
    }

    importConfiguredUrls();
    project.gitRemoteNames = gitRemotes.map((remote) => remote.name);
    delete project.selectedRemoteName;
  };

  const hideAddRemote = () => {
    addRemoteName.value = '';
    addRemoteUrl.value = '';
    addRemoteForm.hidden = true;
    addRemoteButton.hidden = false;
  };

  const validateAddRemote = () => {
    const name = addRemoteName.value.trim();
    if (!name) {
      setStatus('Enter a remote name.', 'error');
      return null;
    }
    if (name.length > 255 || /\p{Cc}/u.test(name)) {
      setStatus('Enter a valid Git remote name.', 'error');
      return null;
    }
    const url = validateRemoteUrl(addRemoteUrl.value);
    if (!url.ok) {
      setStatus(url.error, 'error');
      return null;
    }
    return { name, url: url.url };
  };

  addRemoteButton.addEventListener('click', () => {
    addRemoteForm.hidden = false;
    addRemoteButton.hidden = true;
    setStatus();
    addRemoteName.focus();
  });
  cancelAddRemote.addEventListener('click', hideAddRemote);

  testAddRemote.addEventListener('click', async () => {
    const draft = validateAddRemote();
    if (!draft) return;
    testAddRemote.disabled = true;
    saveAddRemote.disabled = true;
    setStatus(`Connecting to ${draft.name}...`);
    try {
      const result = await window.api.testAppRemote(project.path, {
        id: makeRemoteId(project.remoteUrls),
        name: draft.name,
        url: draft.url,
      });
      setStatus(
        result.ok ? 'Connection successful.' : (result.errorSummary || 'Connection failed.'),
        result.ok ? 'success' : 'error'
      );
    } finally {
      testAddRemote.disabled = false;
      saveAddRemote.disabled = false;
    }
  });

  addRemoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const draft = validateAddRemote();
    if (!draft) return;
    if (gitRemotes.some((remote) => remote.name === draft.name)) {
      setStatus(`Remote ${draft.name} already exists.`, 'error');
      return;
    }

    setBusy(true);
    setStatus(`Adding ${draft.name}...`);
    try {
      const result = await window.api.addGitRemote(
        project.path,
        draft.name,
        draft.url
      );
      if (!result.ok) {
        setStatus(result.errorSummary || `Could not add ${draft.name}.`, 'error');
        return;
      }
      gitRemotes.push(result.remote);
      project.gitRemoteNames = gitRemotes.map((remote) => remote.name);
      importConfiguredUrls();
      hideAddRemote();
      renderGroups();
      setStatus(`Added remote ${draft.name}.`, 'success');
      await notifyChange({ refresh: true });
    } catch (error) {
      setStatus(error?.message || `Could not add ${draft.name}.`, 'error');
    } finally {
      setBusy(false);
    }
  });

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

  renderGroups();
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    doneButton.focus();
  });

  window.api.getGitRemotes(project.path)
    .then(async (result) => {
      if (closed) return;
      if (!result.ok) {
        setStatus(result.errorSummary || 'Could not read repository remotes.', 'error');
        return;
      }
      gitRemotes = result.remotes;
      migrateAndImport();
      renderGroups();
      await notifyChange();
      if (!gitRemotes.length) {
        setStatus('Add a Git remote before managing its URLs.', 'error');
      }
    })
    .catch((error) => {
      if (closed) return;
      setStatus(error?.message || 'Could not read repository remotes.', 'error');
    });
}
