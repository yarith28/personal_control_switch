// Header tab bar — switches between top-level pages (Git Sync, Cross Sync).
export function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-bar .tab'));
  const pages = Array.from(document.querySelectorAll('.page'));

  const placeSharedControls = (name) => {
    const controls = document.getElementById('shared-tab-controls');
    const output = document.getElementById('output-wrap');
    const page = document.querySelector(`.page[data-page="${name}"]`);
    const toolbar = name === 'cross-sync'
      ? page?.querySelector('.cross-head')
      : page?.querySelector('.toolbar');

    if (controls && toolbar) toolbar.appendChild(controls);
    if (output && page) page.appendChild(output);
  };

  const activate = (name) => {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const page of pages) {
      page.toggleAttribute('hidden', page.dataset.page !== name);
    }
    placeSharedControls(name);
    window.dispatchEvent(new CustomEvent('pcs:tab-change', { detail: { name } }));
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(current + direction + tabs.length) % tabs.length];
      activate(next.dataset.tab);
      next.focus();
    });
  }
}
