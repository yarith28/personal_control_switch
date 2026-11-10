const test = require('node:test');
const assert = require('node:assert/strict');

test('history manager groups configured folders and standalone repositories without changing them', async () => {
  const { historyManagerGroups } = await import('../src/renderer/js/history-manager-model.mjs');
  const standalone = { type: 'project', path: '/repos/tools' };
  const web = { type: 'project', path: '/work/web' };
  const api = { type: 'project', path: '/work/api' };
  const other = { type: 'project', path: '/other/tools' };
  const items = [
    { type: 'folder', id: 'work', name: 'Work', color: '#15803d', collapsed: true, items: [web, api] },
    standalone,
    { type: 'folder', id: 'personal', name: 'Personal', items: [other] },
    { type: 'project', path: '/repos/scripts' },
  ];
  const before = JSON.stringify(items);
  const groups = historyManagerGroups(items);
  assert.deepEqual(groups.map((group) => group.name), ['Work', 'Ungrouped', 'Personal']);
  assert.deepEqual(groups.map((group) => group.projects.map((repo) => repo.path)), [
    ['/work/web', '/work/api'], ['/repos/tools', '/repos/scripts'], ['/other/tools'],
  ]);
  assert.equal(groups[0].color, '#15803d');
  assert.equal(groups[0].projects[0], web);
  assert.equal(groups[1].projects[0], standalone);
  assert.equal(JSON.stringify(items), before);
});

test('history manager excludes empty folders and keeps folder IDs distinct from Ungrouped', async () => {
  const { historyManagerGroups } = await import('../src/renderer/js/history-manager-model.mjs');
  assert.deepEqual(historyManagerGroups(), []);
  assert.deepEqual(historyManagerGroups([{ type: 'folder', id: 'empty', items: [] }]), []);
  const groups = historyManagerGroups([
    { type: 'folder', id: 'ungrouped', name: 'Ungrouped', items: [{ type: 'project', path: '/repos/first' }] },
    { type: 'project', path: '/repos/second' },
    { type: 'folder', items: [{ type: 'project', path: '/repos/third' }, { type: 'project', path: '' }] },
  ]);
  assert.equal(new Set(groups.map((group) => group.id)).size, 3);
  assert.equal(groups[2].name, 'Folder');
  assert.equal(groups[2].projects.length, 1);
});

test('history view cache evicts least-recent views while preserving lightweight draft and selection state', async () => {
  const { trimHistoryViews, MAX_CACHED_HISTORY_VIEWS } = await import('../src/renderer/js/history-manager-model.mjs');
  const closed = [];
  const views = new Map();
  for (const key of ['first', 'second', 'third', 'active']) views.set(key, {
    isBusy: () => false,
    getState: () => ({ draft: `draft ${key}`, selection: 'working-tree' }),
    close: (options) => closed.push({ key, options }),
  });
  const saved = new Map([['first', { draft: 'latest draft', scroll: { diff: { top: 1700, left: 0 } } }]]);
  trimHistoryViews(views, saved, 'active');
  assert.equal(views.size, MAX_CACHED_HISTORY_VIEWS);
  assert.deepEqual([...views.keys()], ['second', 'third', 'active']);
  assert.equal(saved.get('first').draft, 'latest draft');
  assert.equal(saved.get('first').scroll.diff.top, 1700);
  assert.deepEqual(closed, [{ key: 'first', options: { restoreFocus: false, keepWindow: true } }]);
});

test('history cache does not evict an active view or a running Git mutation', async () => {
  const { trimHistoryViews } = await import('../src/renderer/js/history-manager-model.mjs');
  const closed = [];
  const views = new Map(['busy', 'old', 'active'].map((key) => [key, {
    isBusy: () => key === 'busy', getState: () => ({ draft: key }), close: () => closed.push(key),
  }]));
  const saved = new Map();
  trimHistoryViews(views, saved, 'active', 2);
  assert.deepEqual(closed, ['old']);
  assert.deepEqual([...views.keys()], ['busy', 'active']);
  assert.deepEqual(saved.get('old'), { draft: 'old' });
});
