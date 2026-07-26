// Reusable branch selector shared by Git Sync and Cross Sync. Callers supply
// the meaning of a selection (checkout, compare, etc.) through onSelect.
import { positionDropdown } from './util.js';
import { iconElement } from './icons.js';

function ensureOutsideClickBackdrop() {
  let backdrop = document.querySelector('.branch-dropdown-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.className = 'branch-dropdown-backdrop';
  backdrop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll('.branch-dropdown.open').forEach((dropdown) => dropdown.classList.remove('open'));
    document.querySelectorAll('.name-branch[aria-expanded="true"]')
      .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

export function createBranchPicker({
  onSelect,
  onCreate,
  scope = '',
  title = 'Select branch',
  emptyText = '(no branch)',
} = {}) {
  let selected = null;
  let hasBranches = false;
  let selecting = false;
  let searchInput = null;
  let createButton = null;
  let remoteToggleButton = null;
  let branchNames = [];
  let remoteBranchNames = [];
  let showRemoteBranches = false;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'name-branch';
  trigger.textContent = emptyText;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const dropdown = document.createElement('div');
  dropdown.className = 'branch-dropdown';
  dropdown.setAttribute('role', 'listbox');
  if (scope) dropdown.dataset.pickerScope = scope;
  document.body.appendChild(dropdown);
  ensureOutsideClickBackdrop();
  dropdown.addEventListener('click', (event) => event.stopPropagation());

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasBranches || selecting) return;
    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open').forEach((d) => d.classList.remove('open'));
    if (isOpen) {
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    positionDropdown(dropdown, trigger.getBoundingClientRect());
    dropdown.scrollTop = 0;
    if (searchInput) {
      searchInput.value = '';
      showRemoteBranches = false;
      syncRemoteToggleButton();
      filterOptions('');
      requestAnimationFrame(() => searchInput?.focus({ preventScroll: true }));
    }
  });

  function filterOptions(query) {
    const normalized = query.trim().toLowerCase();
    let visibleCount = 0;
    dropdown.querySelectorAll('.branch-option').forEach((option) => {
      const remoteVisible = option.dataset.remote !== 'true' || showRemoteBranches;
      const visible = remoteVisible
        && (!normalized || option.dataset.branchName.includes(normalized));
      option.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    dropdown.querySelector('.branch-search-empty')?.toggleAttribute('hidden', visibleCount > 0);
    syncCreateButton();
  }

  function syncCreateButton() {
    if (!createButton) return;
    const name = searchInput?.value.trim() || '';
    const alreadyExists = branchNames.includes(name);
    createButton.disabled = selecting || !name || alreadyExists;
    createButton.title = alreadyExists ? 'Branch already exists' : 'Create branch';
    createButton.setAttribute(
      'aria-label',
      alreadyExists ? `Branch ${name} already exists` : `Create branch ${name || 'from entered name'}`
    );
  }

  function syncRemoteToggleButton() {
    if (!remoteToggleButton) return;
    const label = showRemoteBranches ? 'Hide remote branches' : 'Show remote branches';
    remoteToggleButton.classList.toggle('active', showRemoteBranches);
    remoteToggleButton.setAttribute('aria-pressed', String(showRemoteBranches));
    remoteToggleButton.setAttribute('aria-label', label);
    remoteToggleButton.title = label;
  }

  function setSelected(branch) {
    selected = branch;
    trigger.textContent = selected || emptyText;
    dropdown.querySelectorAll('.branch-option').forEach((option) => {
      const active = option.textContent === selected;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }

  function setSelecting(value) {
    selecting = value;
    trigger.classList.toggle('busy', selecting);
    trigger.classList.toggle('clickable', hasBranches && !selecting);
    trigger.setAttribute('aria-busy', String(selecting));
    syncCreateButton();
  }

  function setBranches(branches = [], current = null, chosen = null, remotes = []) {
    dropdown.replaceChildren();
    branchNames = [...branches];
    remoteBranchNames = [...new Set(remotes)].filter((branch) => (
      typeof branch === 'string' && branch && !branch.endsWith('/HEAD')
    ));
    searchInput = null;
    createButton = null;
    remoteToggleButton = null;
    showRemoteBranches = false;
    hasBranches = branches.length > 0 || remoteBranchNames.length > 0;
    if (!hasBranches) {
      trigger.classList.remove('clickable');
      trigger.removeAttribute('title');
      setSelected(null);
      return null;
    }

    const nextSelected = branches.includes(chosen) ? chosen
      : branches.includes(current) ? current
      : branches[0];
    selected = nextSelected;
    trigger.textContent = nextSelected;
    trigger.classList.add('clickable');
    trigger.title = title;

    const searchWrap = document.createElement('div');
    searchWrap.className = 'branch-search';
    searchWrap.appendChild(iconElement('search', { size: 13, strokeWidth: 1.9 }));
    searchInput = document.createElement('input');
    searchInput.className = 'branch-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = onCreate ? 'Search or name a branch' : 'Search branches';
    searchInput.setAttribute('aria-label', onCreate ? 'Search or enter a new branch name' : 'Search branches');
    searchInput.spellcheck = false;
    searchInput.addEventListener('input', () => filterOptions(searchInput.value));
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus?.();
      } else if (event.key === 'Enter') {
        const firstMatch = dropdown.querySelector('.branch-option:not([hidden])');
        if (firstMatch) {
          event.preventDefault();
          firstMatch.click();
        }
      }
    });
    searchWrap.appendChild(searchInput);
    if (remoteBranchNames.length) {
      remoteToggleButton = document.createElement('button');
      remoteToggleButton.type = 'button';
      remoteToggleButton.className = 'branch-remote-btn';
      remoteToggleButton.appendChild(iconElement('cloud', { size: 13, strokeWidth: 1.9 }));
      remoteToggleButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showRemoteBranches = !showRemoteBranches;
        syncRemoteToggleButton();
        filterOptions(searchInput?.value || '');
        searchInput?.focus({ preventScroll: true });
      });
      syncRemoteToggleButton();
      searchWrap.appendChild(remoteToggleButton);
    }
    if (onCreate) {
      createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'branch-create-btn';
      createButton.disabled = true;
      createButton.appendChild(iconElement('gitBranchPlus', { size: 13, strokeWidth: 1.9 }));
      createButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const name = searchInput?.value.trim() || '';
        if (!name || branchNames.includes(name) || selecting) return;

        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        setSelecting(true);
        Promise.resolve(onCreate(name))
          .then((accepted) => {
            if (accepted !== false) setSelected(name);
          })
          .finally(() => setSelecting(false));
      });
      searchWrap.appendChild(createButton);
      syncCreateButton();
    }
    dropdown.appendChild(searchWrap);

    const appendOption = (b, isRemote = false) => {
      const opt = document.createElement('div');
      opt.className = `branch-option${isRemote ? ' remote' : ''}${b === selected ? ' active' : ''}`;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(b === selected));
      opt.textContent = b;
      opt.dataset.branchName = b.toLowerCase();
      opt.dataset.remote = String(isRemote);
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        if (b === selected || selecting) return;
        setSelecting(true);
        Promise.resolve(onSelect?.(b, selected, { remote: isRemote }))
          .then((accepted) => {
            if (accepted === false) return;
            if (typeof accepted === 'string') setSelected(accepted);
            else if (!isRemote) setSelected(b);
          })
          .finally(() => setSelecting(false));
      });
      dropdown.appendChild(opt);
    };
    for (const b of branches) appendOption(b);
    for (const b of remoteBranchNames) appendOption(b, true);

    if (!showRemoteBranches) {
      dropdown.querySelectorAll('.branch-option.remote').forEach((option) => {
        option.hidden = true;
      });
    }
    const empty = document.createElement('div');
    empty.className = 'branch-search-empty';
    empty.textContent = 'No matching branches';
    empty.hidden = true;
    dropdown.appendChild(empty);
    return selected;
  }

  return { el: trigger, setBranches, setSelected };
}
