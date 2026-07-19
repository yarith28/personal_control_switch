import { basename, positionDropdown } from './util.js';
import { log } from './log.js';

function targetsForPlatform() {
  const isMac = document.body.classList.contains('platform-darwin');
  const isWindows = document.body.classList.contains('platform-win32');

  return [
    { id: 'terminal', label: 'Terminal' },
    { id: 'vscode', label: 'VS Code' },
    { id: 'sourcetree', label: 'SourceTree' },
    { id: 'antigravity', label: 'Antigravity' },
    { id: 'finder', label: isMac ? 'Finder' : (isWindows ? 'Explorer' : 'Folder') },
  ];
}

export function createProjectOpenMenu({ trigger, projectPath, scope = '', disabled } = {}) {
  if (!trigger || !projectPath) return null;

  trigger.classList.add('project-open-trigger');
  trigger.title = 'Open with...';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';
  if (scope) dropdown.dataset.menuScope = scope;
  document.body.appendChild(dropdown);

  trigger.addEventListener('click', (event) => {
    if (disabled?.()) return;
    event.stopPropagation();

    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open').forEach((item) => item.classList.remove('open'));
    if (isOpen) {
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }

    dropdown.replaceChildren();
    for (const target of targetsForPlatform()) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'move-option';
      option.setAttribute('role', 'menuitem');
      option.textContent = target.label;
      option.addEventListener('click', async (optionEvent) => {
        optionEvent.stopPropagation();
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        const result = await window.api.openWith(projectPath, target.id);
        if (!result.ok) {
          log(`[${basename(projectPath)}] failed to open in ${target.label}: ${result.error}`, true);
        }
      });
      dropdown.appendChild(option);
    }

    dropdown.classList.add('open');
    dropdown.setAttribute('role', 'menu');
    trigger.setAttribute('aria-expanded', 'true');
    positionDropdown(dropdown, trigger.getBoundingClientRect());
    dropdown.querySelector('.move-option')?.focus();
  });

  return dropdown;
}
