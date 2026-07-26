import { normalizeAppRemotes } from './app-remotes.mjs';
import {
  mergeConfiguredRemoteUrls,
  normalizeRemoteUrlOptions,
  selectRemoteName,
  validateRemoteUrl,
} from './remote-url-options.mjs';
import { persist } from './persist.js';
import { confirmDialog } from './modal.js';
import { iconElement } from './icons.js';
import { log } from './log.js';
import { basename } from './util.js';

let activeRemoteUrlTooltip = null;

function hideRemoteUrlTooltip() {
  if (!activeRemoteUrlTooltip) return;
  const { element, trigger } = activeRemoteUrlTooltip;
  element.remove();
  trigger.removeAttribute('aria-describedby');
  activeRemoteUrlTooltip = null;
  window.removeEventListener('resize', hideRemoteUrlTooltip);
  document.removeEventListener('scroll', hideRemoteUrlTooltip, true);
}

function showRemoteUrlTooltip(trigger, remoteName, url) {
  hideRemoteUrlTooltip();
  if (!url || !trigger.isConnected) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'remote-url-tooltip';
  tooltip.id = `remote-url-tooltip-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  tooltip.setAttribute('role', 'tooltip');

  const label = document.createElement('div');
  label.className = 'remote-url-tooltip-label';
  label.textContent = `${remoteName} fetch URL`;
  const value = document.createElement('div');
  value.className = 'remote-url-tooltip-value';
  value.textContent = url;
  tooltip.append(label, value);
  document.body.appendChild(tooltip);

  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportPadding = 10;
  const gap = 8;
  const centeredLeft = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
  const left = Math.max(
    viewportPadding,
    Math.min(centeredLeft, window.innerWidth - tooltipRect.width - viewportPadding)
  );
  const fitsAbove = triggerRect.top - tooltipRect.height - gap >= viewportPadding;
  const preferredTop = fitsAbove
    ? triggerRect.top - tooltipRect.height - gap
    : triggerRect.bottom + gap;
  const top = Math.max(
    viewportPadding,
    Math.min(preferredTop, window.innerHeight - tooltipRect.height - viewportPadding)
  );
  const arrowLeft = Math.max(
    12,
    Math.min(
      triggerRect.left + triggerRect.width / 2 - left,
      tooltipRect.width - 12
    )
  );

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.style.setProperty('--remote-tooltip-arrow-left', `${Math.round(arrowLeft)}px`);
  tooltip.classList.toggle('below', !fitsAbove);
  trigger.setAttribute('aria-describedby', tooltip.id);
  activeRemoteUrlTooltip = { element: tooltip, trigger };
  window.addEventListener('resize', hideRemoteUrlTooltip);
  document.addEventListener('scroll', hideRemoteUrlTooltip, true);
}

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

function remoteUrls(remote) {
  return [
    ...(Array.isArray(remote?.urls) ? remote.urls : [remote?.url]),
    ...(Array.isArray(remote?.pushUrls) ? remote.pushUrls : [remote?.pushUrl]),
  ].map((url) => String(url || '').trim()).filter(Boolean);
}

export function createRemoteTag(project, { disabled = () => false, onChange } = {}) {
  hideRemoteUrlTooltip();
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'name-remote';

  const currentTagRemote = () => {
    const name = String(tag.dataset.remoteName || '').trim();
    return (Array.isArray(project.gitRemotes) ? project.gitRemotes : [])
      .find((remote) => remote.name === name) || null;
  };

  const sync = () => {
    const names = Array.isArray(project.gitRemoteNames) ? project.gitRemoteNames : [];
    const selected = String(project.selectedRemoteName || '').trim();
    const label = (names.length && names.includes(selected) ? selected : '')
      || project.configuredRemote
      || project.defaultRemote
      || remoteFromUpstream(project, names)
      || 'Remote';
    const remote = (Array.isArray(project.gitRemotes) ? project.gitRemotes : [])
      .find((entry) => entry.name === label) || null;
    const url = String(remote?.url || '').trim();
    tag.textContent = label;
    tag.dataset.remoteName = remote?.name || '';
    tag.dataset.remoteUrl = url;
    tag.classList.toggle('unset', label === 'Remote');
    tag.setAttribute(
      'aria-label',
      url
        ? `${label} remote, currently using ${url}. Open remote manager.`
        : `${label} remote. Open remote manager.`
    );
  };

  const showTooltip = () => {
    const remote = currentTagRemote();
    showRemoteUrlTooltip(tag, remote?.name || '', String(remote?.url || '').trim());
  };

  tag.addEventListener('mouseenter', showTooltip);
  tag.addEventListener('mouseleave', hideRemoteUrlTooltip);
  tag.addEventListener('focus', showTooltip);
  tag.addEventListener('blur', hideRemoteUrlTooltip);

  tag.addEventListener('click', (event) => {
    event.stopPropagation();
    hideRemoteUrlTooltip();
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
  delete project.selectedRemoteUrlId;
  project.selectedRemoteId = null;

  let gitRemotes = Array.isArray(project.gitRemotes) ? project.gitRemotes : [];
  let closed = false;
  let busy = false;
  let listResizeObserver = null;

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
  intro.textContent = 'Choose a Git remote, then swap its URL from reusable history.';
  headingWrap.append(eyebrow, title, intro);
  const closeButton = iconButton('remote-manager-close', 'x', 'Close remote manager');
  header.append(headingWrap, closeButton);

  const targetPanel = document.createElement('div');
  targetPanel.className = 'remote-target-panel';
  const targetLabel = document.createElement('label');
  targetLabel.className = 'remote-target-label';
  const targetLabelText = document.createElement('span');
  targetLabelText.textContent = 'Swap target';
  const targetSelect = document.createElement('select');
  targetSelect.className = 'remote-target-select';
  targetSelect.setAttribute('aria-label', 'Git remote URL swap target');
  targetLabel.append(targetLabelText, targetSelect);
  const targetCurrent = document.createElement('div');
  targetCurrent.className = 'remote-target-current';
  targetPanel.append(targetLabel, targetCurrent);

  const list = document.createElement('div');
  list.className = 'remote-manager-list';

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

  card.append(header, targetPanel, list, status, footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    if (closed) return;
    closed = true;
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
    targetSelect.disabled = value || !gitRemotes.length;
    card.querySelectorAll('.remote-manager-list button, .remote-manager-list input').forEach((control) => {
      control.disabled = value
        || control.dataset.locked === 'true'
        || (control.dataset.requiresTarget === 'true' && !currentRemote());
    });
  };

  const currentRemote = () => (
    gitRemotes.find((remote) => remote.name === project.selectedRemoteName) || null
  );

  const syncProjectRemotes = () => {
    project.gitRemotes = gitRemotes;
    project.gitRemoteNames = gitRemotes.map((remote) => remote.name);
  };

  const importConfiguredUrls = () => {
    const merged = mergeConfiguredRemoteUrls(project.remoteUrls, gitRemotes, makeRemoteId);
    project.remoteUrls = merged.options;
    return merged.changed;
  };

  const migrateAndImport = () => {
    let changed = false;
    const selectedRemoteName = selectRemoteName(
      project.selectedRemoteName,
      gitRemotes,
      [project.configuredRemote, project.defaultRemote]
    );
    for (const legacy of normalizeAppRemotes(project.appRemotes)) {
      if (project.remoteUrls.some((option) => option.url === legacy.url)) continue;
      project.remoteUrls.push({
        id: makeRemoteId(project.remoteUrls),
        ...(selectedRemoteName ? { remoteName: selectedRemoteName } : {}),
        url: legacy.url,
      });
      changed = true;
    }
    if (project.appRemotes.length) {
      project.appRemotes = [];
      changed = true;
    }
    if (project.selectedRemoteName !== selectedRemoteName) changed = true;
    project.selectedRemoteName = selectedRemoteName;
    syncProjectRemotes();
    return importConfiguredUrls() || changed;
  };

  const configuredUrls = () => new Set(gitRemotes.flatMap(remoteUrls));

  const renderTarget = () => {
    targetSelect.replaceChildren();
    if (!gitRemotes.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No Git remotes';
      targetSelect.appendChild(option);
      targetSelect.disabled = true;
      targetCurrent.textContent = 'Remote Manager changes URLs but does not create Git remotes.';
      return;
    }

    for (const remote of gitRemotes) {
      const option = document.createElement('option');
      option.value = remote.name;
      option.textContent = remote.name;
      option.selected = remote.name === project.selectedRemoteName;
      targetSelect.appendChild(option);
    }
    targetSelect.disabled = busy;
    const remote = currentRemote();
    targetCurrent.textContent = remote?.url
      ? `Current fetch URL: ${remote.url}`
      : 'The selected remote has no fetch URL.';
    targetCurrent.title = remote?.url || '';
  };

  const useOption = async (option) => {
    if (busy) return false;
    const remote = currentRemote();
    if (!remote) {
      setStatus('Select an existing Git remote before using a URL.', 'error');
      return false;
    }

    setBusy(true);
    setStatus(`Updating ${remote.name}...`);
    try {
      const result = await window.api.setGitRemoteUrl(
        project.path,
        remote.name,
        option.url
      );
      if (!result.ok) {
        setStatus(result.errorSummary || `Could not update ${remote.name}.`, 'error');
        importConfiguredUrls();
        renderTarget();
        renderHistory();
        await notifyChange();
        return false;
      }

      const index = gitRemotes.findIndex((entry) => entry.name === remote.name);
      if (index !== -1) gitRemotes[index] = result.remote;
      syncProjectRemotes();
      importConfiguredUrls();
      renderTarget();
      renderHistory();
      setStatus(
        result.unchanged
          ? `${remote.name} already uses this URL.`
          : `${remote.name} now uses ${option.url}.`,
        'success'
      );
      await notifyChange({ refresh: !result.unchanged });
      return true;
    } catch (error) {
      setStatus(error?.message || `Could not update ${remote.name}.`, 'error');
      importConfiguredUrls();
      renderTarget();
      renderHistory();
      await notifyChange();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const buildUrlForm = (group, addButton) => {
    const form = document.createElement('form');
    form.className = 'remote-url-form';
    form.hidden = true;
    let editingId = null;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Remote URL or local path';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Remote URL or local repository path');

    const formStatus = document.createElement('div');
    formStatus.className = 'remote-url-form-status';
    formStatus.setAttribute('aria-live', 'polite');

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
    saveButton.type = 'button';
    saveButton.className = 'btn remote-form-save-only';
    saveButton.textContent = 'Add';
    const saveUseButton = document.createElement('button');
    saveUseButton.type = 'submit';
    saveUseButton.className = 'btn remote-form-save';
    saveUseButton.textContent = 'Add & use';
    saveUseButton.dataset.requiresTarget = 'true';
    actions.append(cancelButton, testButton, saveButton, saveUseButton);
    form.append(input, formStatus, actions);

    const setFormStatus = (message = '', tone = '') => {
      formStatus.textContent = message;
      formStatus.classList.toggle('error', tone === 'error');
      formStatus.classList.toggle('success', tone === 'success');
      if (tone === 'error' && message) {
        log(`[${basename(project.path)}] Remote manager: ${message}`);
      }
    };

    const hide = () => {
      editingId = null;
      input.value = '';
      form.hidden = true;
      addButton.hidden = false;
      setFormStatus();
    };

    const show = (option = null) => {
      editingId = option?.id || null;
      input.value = option?.url || '';
      saveButton.textContent = option ? 'Save' : 'Add';
      saveUseButton.textContent = option ? 'Save & use' : 'Add & use';
      saveUseButton.disabled = !currentRemote();
      form.hidden = false;
      addButton.hidden = true;
      setStatus();
      setFormStatus();
      input.focus();
      if (option) input.select();
    };

    addButton.addEventListener('click', () => show());
    cancelButton.addEventListener('click', hide);

    testButton.addEventListener('click', async () => {
      const validation = validateRemoteUrl(input.value);
      if (!validation.ok) {
        setFormStatus(validation.error, 'error');
        return;
      }
      testButton.disabled = true;
      saveButton.disabled = true;
      saveUseButton.disabled = true;
      setFormStatus('Testing connection...');
      try {
        const result = await window.api.testAppRemote(project.path, {
          id: editingId || makeRemoteId(project.remoteUrls),
          name: project.selectedRemoteName || 'history',
          url: validation.url,
        });
        setFormStatus(
          result.ok ? 'Connection successful.' : (result.errorSummary || 'Connection failed.'),
          result.ok ? 'success' : 'error'
        );
      } catch (error) {
        setFormStatus(error?.message || 'Connection failed.', 'error');
      } finally {
        testButton.disabled = false;
        saveButton.disabled = false;
        saveUseButton.disabled = !currentRemote();
      }
    });

    const saveDraft = async (use) => {
      const validation = validateRemoteUrl(input.value);
      if (!validation.ok) {
        setFormStatus(validation.error, 'error');
        return;
      }

      const existing = project.remoteUrls.find((option) => option.id === editingId) || null;
      const duplicate = project.remoteUrls.find((option) => (
        option.id !== editingId && option.url === validation.url
      )) || null;
      let option = duplicate;
      if (duplicate) {
        if (existing) {
          project.remoteUrls = project.remoteUrls.filter((entry) => entry.id !== existing.id);
        }
      } else if (existing) {
        existing.url = validation.url;
        option = existing;
      } else {
        option = {
          id: makeRemoteId(project.remoteUrls),
          ...(project.selectedRemoteName ? { remoteName: project.selectedRemoteName } : {}),
          url: validation.url,
        };
        project.remoteUrls.push(option);
      }

      hide();
      importConfiguredUrls();
      renderHistory();
      if (use && currentRemote()) {
        await useOption(option);
      } else {
        setStatus(duplicate ? 'That URL is already in history.' : 'URL saved.', 'success');
        await notifyChange();
      }
    };

    saveButton.addEventListener('click', () => saveDraft(false));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveDraft(!!currentRemote());
    });

    group.appendChild(form);
    return { show };
  };

  const renderHistory = () => {
    list.replaceChildren();
    list.classList.remove('scrollable');

    const group = document.createElement('section');
    group.className = 'remote-group remote-history-group';
    const groupHeader = document.createElement('div');
    groupHeader.className = 'remote-group-header';
    const groupName = document.createElement('h3');
    groupName.className = 'remote-group-name';
    groupName.textContent = 'URL history';
    const count = document.createElement('span');
    count.className = 'remote-history-count';
    count.textContent = `${project.remoteUrls.length} saved`;
    groupHeader.append(groupName, count);
    group.appendChild(groupHeader);

    const optionList = document.createElement('div');
    optionList.className = 'remote-url-list';
    const activeUrl = currentRemote()?.url || '';
    const protectedUrls = configuredUrls();
    let formControl;

    if (!project.remoteUrls.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-manager-empty';
      empty.textContent = 'No saved URLs yet.';
      optionList.appendChild(empty);
    }

    for (const option of project.remoteUrls) {
      const active = !!activeUrl && option.url === activeUrl;
      const configured = protectedUrls.has(option.url);
      const row = document.createElement('div');
      row.className = `remote-url-row${active ? ' active' : ''}${currentRemote() ? '' : ' disabled'}`;
      const choice = document.createElement('label');
      choice.className = 'remote-url-choice';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'active-remote-url';
      radio.value = option.id;
      radio.checked = active;
      radio.disabled = !currentRemote();
      radio.dataset.requiresTarget = 'true';
      radio.setAttribute(
        'aria-label',
        currentRemote()
          ? `Use ${option.url} for ${project.selectedRemoteName}`
          : `Saved URL ${option.url}`
      );
      const url = document.createElement('span');
      url.className = 'remote-row-url';
      url.textContent = option.url;
      url.title = option.url;
      choice.append(radio, url);
      radio.addEventListener('change', () => {
        if (radio.checked) useOption(option);
      });

      const actions = document.createElement('div');
      actions.className = 'remote-row-actions';
      const editButton = iconButton('remote-row-action', 'pencil', `Edit ${option.url}`);
      editButton.addEventListener('click', () => formControl.show(option));
      const deleteButton = iconButton('remote-row-action danger', 'trash2', `Delete ${option.url}`);
      deleteButton.disabled = configured;
      deleteButton.dataset.locked = String(configured);
      if (configured) {
        deleteButton.title = 'This URL is currently configured on a Git remote';
        deleteButton.setAttribute('aria-label', deleteButton.title);
      }
      deleteButton.addEventListener('click', async () => {
        if (configured) return;
        const confirmed = await confirmDialog({
          message: 'Delete this URL?',
          detail: option.url,
          confirmText: 'Delete',
        });
        if (!confirmed) return;
        project.remoteUrls = project.remoteUrls.filter((entry) => entry.id !== option.id);
        renderHistory();
        await notifyChange();
      });
      actions.append(editButton, deleteButton);
      row.addEventListener('click', (event) => {
        if (
          !currentRemote()
          || event.target.closest('.remote-url-choice')
          || event.target.closest('.remote-row-actions')
        ) return;
        radio.checked = true;
        useOption(option);
      });
      row.append(choice, actions);
      optionList.appendChild(row);
    }
    group.appendChild(optionList);

    const addButton = textButton('remote-add-url', 'plus', 'Add URL');
    group.appendChild(addButton);
    formControl = buildUrlForm(group, addButton);
    list.appendChild(group);
    setBusy(busy);
    requestAnimationFrame(syncListOverflow);
  };

  targetSelect.addEventListener('change', async () => {
    if (busy) return;
    project.selectedRemoteName = targetSelect.value;
    setStatus();
    renderTarget();
    renderHistory();
    await notifyChange();
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

  migrateAndImport();
  renderTarget();
  renderHistory();
  listResizeObserver = new ResizeObserver(syncListOverflow);
  listResizeObserver.observe(list);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    syncListOverflow();
    targetSelect.focus();
  });

  window.api.getGitRemotes(project.path)
    .then(async (result) => {
      if (closed) return;
      if (!result.ok) {
        setStatus(result.errorSummary || 'Could not read repository remotes.', 'error');
        return;
      }
      gitRemotes = result.remotes;
      const changed = migrateAndImport();
      renderTarget();
      renderHistory();
      if (changed) await notifyChange();
    })
    .catch((error) => {
      if (closed) return;
      setStatus(error?.message || 'Could not read repository remotes.', 'error');
    });
}
