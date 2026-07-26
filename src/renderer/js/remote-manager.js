import { normalizeAppRemotes } from './app-remotes.mjs';
import {
  mergeConfiguredRemoteUrls,
  normalizeRemoteUrlOptions,
  selectedRemoteUrlOption,
  validateRemoteUrl,
} from './remote-url-options.mjs';
import { persist } from './persist.js';
import { confirmDialog } from './modal.js';
import { iconElement } from './icons.js';
import { log } from './log.js';
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
    const selected = selectedRemoteUrlOption(project);
    const fallback = project.defaultRemote || remoteFromUpstream(project);
    const label = selected?.remoteName || fallback || 'Remote';
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
  let addRemoteDialog = null;
  let listResizeObserver = null;
  let configuredActiveRemote = '';

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
  const headerActions = document.createElement('div');
  headerActions.className = 'remote-manager-header-actions';
  const addRemoteButton = iconButton('remote-manager-add', 'plus', 'Add Git remote');
  const closeButton = iconButton('remote-manager-close', 'x', 'Close remote manager');
  headerActions.append(addRemoteButton, closeButton);
  header.append(headingWrap, headerActions);

  const list = document.createElement('div');
  list.className = 'remote-manager-list remote-group-list';

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

  card.append(header, list, status, footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    if (closed) return;
    closed = true;
    addRemoteDialog?.close(true);
    listResizeObserver?.disconnect();
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKeydown);
    setTimeout(() => overlay.remove(), 180);
  };

  const setStatus = (message = '', tone = '') => {
    status.textContent = message;
    status.classList.toggle('error', tone === 'error');
    status.classList.toggle('success', tone === 'success');
    if (tone === 'error' && message) {
      log(`[${basename(project.path)}] Remote manager: ${message}`);
    }
  };

  const syncListOverflow = () => {
    if (closed) return;
    list.classList.toggle('scrollable', list.scrollHeight > list.clientHeight + 2);
  };

  const notifyChange = async ({ refresh = false } = {}) => {
    await persist();
    await onChange?.({ refresh });
  };

  const setBusy = (value) => {
    busy = value;
    addRemoteButton.disabled = value;
    card.querySelectorAll('.remote-manager-list button, .remote-manager-list input').forEach((control) => {
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

  const ensureSelectedOption = () => {
    const selected = selectedRemoteUrlOption(project);
    const activeName = gitRemotes.some((remote) => remote.name === configuredActiveRemote)
      ? configuredActiveRemote
      : '';
    if (activeName) {
      const activeRemote = currentRemote(activeName);
      const activeOption = project.remoteUrls.find((option) => (
        option.remoteName === activeName && option.url === activeRemote?.url
      )) || project.remoteUrls.find((option) => option.remoteName === activeName)
        || null;
      project.selectedRemoteUrlId = activeOption?.id || '';
      return activeOption;
    }
    if (selected && gitRemotes.some((remote) => remote.name === selected.remoteName)) {
      return selected;
    }
    const primaryName = primaryRemoteName(project, gitRemotes);
    const primary = currentRemote(primaryName);
    const preferred = project.remoteUrls.find((option) => (
      option.remoteName === primaryName && option.url === primary?.url
    )) || project.remoteUrls.find((option) => option.remoteName === primaryName)
      || project.remoteUrls[0]
      || null;
    project.selectedRemoteUrlId = preferred?.id || '';
    return preferred;
  };

  const useOption = async (remoteName, option) => {
    if (busy) return false;
    const remote = currentRemote(remoteName);
    if (!remote) {
      setStatus(`Remote ${remoteName} no longer exists.`, 'error');
      return false;
    }

    setBusy(true);
    const previousSelectedId = project.selectedRemoteUrlId;
    const previousUrl = remote.url;
    let urlChanged = false;
    setStatus(`Making ${remoteName} active...`);
    try {
      if (previousUrl !== option.url) {
        const urlResult = await window.api.setGitRemoteUrl(
          project.path,
          remoteName,
          option.url
        );
        if (!urlResult.ok) {
          setStatus(urlResult.errorSummary || `Could not update ${remoteName}.`, 'error');
          if (importConfiguredUrls()) await notifyChange();
          renderGroups();
          return false;
        }
        const index = gitRemotes.findIndex((entry) => entry.name === remoteName);
        if (index !== -1) gitRemotes[index] = urlResult.remote;
        urlChanged = !urlResult.unchanged;
      }

      const activeResult = await window.api.setActiveGitRemote(project.path, remoteName);
      if (!activeResult.ok) {
        let rollbackFailed = false;
        if (urlChanged) {
          const rollback = await window.api.setGitRemoteUrl(
            project.path,
            remoteName,
            previousUrl
          );
          rollbackFailed = !rollback.ok;
          if (rollback.ok) {
            const index = gitRemotes.findIndex((entry) => entry.name === remoteName);
            if (index !== -1) gitRemotes[index] = rollback.remote;
          }
        }
        project.selectedRemoteUrlId = previousSelectedId;
        importConfiguredUrls();
        setStatus(
          rollbackFailed
            ? `${activeResult.errorSummary || `Could not make ${remoteName} active.`} The URL could not be restored.`
            : (activeResult.errorSummary || `Could not make ${remoteName} active.`),
          'error'
        );
        renderGroups();
        await notifyChange();
        return false;
      }

      configuredActiveRemote = remoteName;
      project.selectedRemoteUrlId = option.id;
      project.upstream = activeResult.upstream || project.upstream;
      project.hasUpstream = true;
      setStatus(
        activeResult.unchanged && !urlChanged
          ? `${remoteName} is already active for ${activeResult.branch}.`
          : `${activeResult.branch} now uses ${remoteName}.`,
        'success'
      );
      renderGroups();
      await notifyChange({ refresh: true });
      return true;
    } catch (error) {
      let rollbackFailed = false;
      if (urlChanged) {
        try {
          const rollback = await window.api.setGitRemoteUrl(
            project.path,
            remoteName,
            previousUrl
          );
          rollbackFailed = !rollback.ok;
          if (rollback.ok) {
            const index = gitRemotes.findIndex((entry) => entry.name === remoteName);
            if (index !== -1) gitRemotes[index] = rollback.remote;
          }
        } catch {
          rollbackFailed = true;
        }
      }
      project.selectedRemoteUrlId = previousSelectedId;
      importConfiguredUrls();
      const message = error?.message || `Could not make ${remoteName} active.`;
      setStatus(
        rollbackFailed ? `${message} The URL could not be restored.` : message,
        'error'
      );
      await notifyChange();
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
      const previousUrl = existing?.url || '';
      const option = existing || {
        id: makeRemoteId(project.remoteUrls),
        remoteName: remote.name,
        url: validation.url,
      };
      if (existing) existing.url = validation.url;
      else project.remoteUrls.push(option);
      hide();
      const applied = await useOption(remote.name, option);
      if (!applied && existing) {
        existing.url = previousUrl;
        importConfiguredUrls();
        renderGroups();
        await notifyChange();
      } else if (!applied) {
        await notifyChange();
      }
    });

    group.appendChild(form);
    return { show };
  };

  const renderGroups = () => {
    list.replaceChildren();
    list.classList.remove('scrollable');
    if (!gitRemotes.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-manager-empty';
      empty.textContent = 'This repository has no Git remotes.';
      list.appendChild(empty);
      return;
    }

    gitRemotes.forEach((remote) => {
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
      let formControl;

      for (const option of options) {
        const active = option.id === project.selectedRemoteUrlId;
        const configured = option.url === remote.url;
        const row = document.createElement('div');
        row.className = `remote-url-row${active ? ' active' : ''}`;
        const choice = document.createElement('label');
        choice.className = 'remote-url-choice';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'active-remote-url';
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
        deleteButton.disabled = active || configured;
        if (active) {
          deleteButton.title = 'Select another URL before deleting this one';
          deleteButton.setAttribute('aria-label', deleteButton.title);
        } else if (configured) {
          deleteButton.title = 'This URL is currently configured in Git';
          deleteButton.setAttribute('aria-label', deleteButton.title);
        }
        deleteButton.addEventListener('click', async () => {
          if (active || configured) return;
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
        row.addEventListener('click', (event) => {
          if (
            event.target.closest('.remote-url-choice')
            || event.target.closest('.remote-row-actions')
          ) return;
          radio.checked = true;
          useOption(remote.name, option);
        });
        row.append(choice, actions);
        optionList.appendChild(row);
      }
      group.appendChild(optionList);

      const addButton = textButton('remote-add-url', 'plus', 'Add URL');
      group.appendChild(addButton);
      formControl = buildUrlForm(remote, group, addButton);
      list.appendChild(group);
    });
    requestAnimationFrame(syncListOverflow);
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
    ensureSelectedOption();
    delete project.selectedRemoteName;
  };

  const openAddRemoteDialog = () => {
    if (closed || busy || addRemoteDialog) return;
    setStatus();

    const dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'modal-overlay remote-add-dialog-overlay';
    const dialogCard = document.createElement('div');
    dialogCard.className = 'modal-card remote-add-dialog-card';
    dialogCard.setAttribute('role', 'dialog');
    dialogCard.setAttribute('aria-modal', 'true');
    dialogCard.setAttribute('aria-labelledby', 'remote-add-dialog-title');
    dialogCard.setAttribute('aria-describedby', 'remote-add-dialog-intro');

    const dialogHeader = document.createElement('div');
    dialogHeader.className = 'remote-add-dialog-header';
    const dialogHeading = document.createElement('div');
    const dialogTitle = document.createElement('div');
    dialogTitle.className = 'modal-message';
    dialogTitle.id = 'remote-add-dialog-title';
    dialogTitle.textContent = 'Add Git remote';
    const dialogIntro = document.createElement('div');
    dialogIntro.className = 'remote-add-dialog-intro';
    dialogIntro.id = 'remote-add-dialog-intro';
    dialogIntro.textContent = 'Add a named remote to this repository.';
    dialogHeading.append(dialogTitle, dialogIntro);
    const dialogCloseButton = iconButton(
      'remote-add-dialog-close',
      'x',
      'Close add remote dialog'
    );
    dialogHeader.append(dialogHeading, dialogCloseButton);

    const form = document.createElement('form');
    form.className = 'remote-add-dialog-form';
    const nameField = document.createElement('label');
    nameField.className = 'remote-add-dialog-field';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Remote name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'origin';
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameField.append(nameLabel, nameInput);

    const urlField = document.createElement('label');
    urlField.className = 'remote-add-dialog-field';
    const urlLabel = document.createElement('span');
    urlLabel.textContent = 'Remote URL or local path';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'git@host:owner/repository.git';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlField.append(urlLabel, urlInput);

    const dialogStatus = document.createElement('div');
    dialogStatus.className = 'remote-add-dialog-status';
    dialogStatus.setAttribute('aria-live', 'polite');

    const dialogActions = document.createElement('div');
    dialogActions.className = 'modal-actions remote-add-dialog-actions';
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
    saveButton.textContent = 'Add';
    dialogActions.append(cancelButton, testButton, saveButton);
    form.append(nameField, urlField, dialogStatus, dialogActions);
    dialogCard.append(dialogHeader, form);
    dialogOverlay.appendChild(dialogCard);
    document.body.appendChild(dialogOverlay);

    let dialogClosed = false;
    let dialogBusy = false;

    const setDialogStatus = (message = '', tone = '') => {
      dialogStatus.textContent = message;
      dialogStatus.classList.toggle('error', tone === 'error');
      dialogStatus.classList.toggle('success', tone === 'success');
      if (tone === 'error' && message) {
        log(`[${basename(project.path)}] Remote manager: ${message}`);
      }
    };

    const setDialogBusy = (value) => {
      dialogBusy = value;
      dialogCard.querySelectorAll('button, input').forEach((control) => {
        control.disabled = value;
      });
    };

    const closeDialog = (force = false) => {
      if (dialogClosed || (dialogBusy && !force)) return;
      dialogClosed = true;
      document.removeEventListener('keydown', onDialogKeydown);
      dialogOverlay.classList.remove('open');
      addRemoteDialog = null;
      if (force) dialogOverlay.remove();
      else setTimeout(() => dialogOverlay.remove(), 180);
      if (!closed) addRemoteButton.focus();
    };

    const validateDraft = () => {
      const name = nameInput.value.trim();
      if (!name) {
        setDialogStatus('Enter a remote name.', 'error');
        nameInput.focus();
        return null;
      }
      if (name.length > 255 || /\p{Cc}/u.test(name)) {
        setDialogStatus('Enter a valid Git remote name.', 'error');
        nameInput.focus();
        return null;
      }
      const url = validateRemoteUrl(urlInput.value);
      if (!url.ok) {
        setDialogStatus(url.error, 'error');
        urlInput.focus();
        return null;
      }
      return { name, url: url.url };
    };

    const onDialogKeydown = (event) => {
      if (event.key === 'Escape') closeDialog();
    };

    addRemoteDialog = { close: closeDialog };
    dialogCloseButton.addEventListener('click', () => closeDialog());
    cancelButton.addEventListener('click', () => closeDialog());
    dialogOverlay.addEventListener('click', (event) => {
      if (event.target === dialogOverlay) closeDialog();
    });
    document.addEventListener('keydown', onDialogKeydown);

    testButton.addEventListener('click', async () => {
      const draft = validateDraft();
      if (!draft) return;
      setDialogBusy(true);
      setDialogStatus(`Connecting to ${draft.name}...`);
      try {
        const result = await window.api.testAppRemote(project.path, {
          id: makeRemoteId(project.remoteUrls),
          name: draft.name,
          url: draft.url,
        });
        if (dialogClosed) return;
        setDialogStatus(
          result.ok ? 'Connection successful.' : (result.errorSummary || 'Connection failed.'),
          result.ok ? 'success' : 'error'
        );
      } catch (error) {
        if (!dialogClosed) {
          setDialogStatus(error?.message || 'Connection failed.', 'error');
        }
      } finally {
        if (!dialogClosed) setDialogBusy(false);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const draft = validateDraft();
      if (!draft) return;
      if (gitRemotes.some((remote) => remote.name === draft.name)) {
        setDialogStatus(`Remote ${draft.name} already exists.`, 'error');
        nameInput.focus();
        return;
      }

      setDialogBusy(true);
      setDialogStatus(`Adding ${draft.name}...`);
      try {
        const result = await window.api.addGitRemote(
          project.path,
          draft.name,
          draft.url
        );
        if (dialogClosed) return;
        if (!result.ok) {
          setDialogStatus(result.errorSummary || `Could not add ${draft.name}.`, 'error');
          return;
        }
        gitRemotes.push(result.remote);
        project.gitRemoteNames = gitRemotes.map((remote) => remote.name);
        importConfiguredUrls();
        const addedOption = project.remoteUrls.find((option) => (
          option.remoteName === draft.name && option.url === draft.url
        ));
        project.selectedRemoteUrlId = addedOption?.id || project.selectedRemoteUrlId;
        renderGroups();
        await notifyChange({ refresh: true });
        if (dialogClosed) return;
        setDialogBusy(false);
        closeDialog();
      } catch (error) {
        if (!dialogClosed) {
          setDialogStatus(error?.message || `Could not add ${draft.name}.`, 'error');
        }
      } finally {
        if (!dialogClosed) setDialogBusy(false);
      }
    });

    requestAnimationFrame(() => {
      dialogOverlay.classList.add('open');
      nameInput.focus();
    });
  };

  addRemoteButton.addEventListener('click', openAddRemoteDialog);

  closeButton.addEventListener('click', close);
  doneButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('confirm-modal')?.hidden) return;
    if (addRemoteDialog) return;
    close();
  };
  document.addEventListener('keydown', onKeydown);

  renderGroups();
  listResizeObserver = new ResizeObserver(syncListOverflow);
  listResizeObserver.observe(list);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    syncListOverflow();
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
      configuredActiveRemote = result.activeRemote || '';
      migrateAndImport();
      renderGroups();
      await notifyChange();
    })
    .catch((error) => {
      if (closed) return;
      setStatus(error?.message || 'Could not read repository remotes.', 'error');
    });
}
