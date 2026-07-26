const test = require('node:test');
const assert = require('node:assert/strict');

test('remote URL options normalize by remote and import current Git URLs', async () => {
  const {
    mergeConfiguredRemoteUrls,
    normalizeRemoteUrlOptions,
    selectedGitRemoteTarget,
    selectedRemoteUrlOption,
    validateRemoteUrl,
  } = await import('../src/renderer/js/remote-url-options.mjs');

  const normalized = normalizeRemoteUrlOptions([
    { id: 'one', remoteName: ' origin ', url: ' https://example.com/one.git ' },
    { id: 'duplicate', remoteName: 'origin', url: 'https://example.com/one.git' },
    { id: 'two', remoteName: 'upstream', url: 'https://example.com/one.git' },
    { id: 'bad id', remoteName: 'origin', url: 'https://example.com/two.git' },
  ]);
  assert.deepEqual(normalized, [
    { id: 'one', remoteName: 'origin', url: 'https://example.com/one.git' },
    { id: 'two', remoteName: 'upstream', url: 'https://example.com/one.git' },
  ]);

  let nextId = 0;
  const merged = mergeConfiguredRemoteUrls(normalized, [
    { name: 'origin', url: 'https://example.com/two.git' },
    { name: 'upstream', url: 'https://example.com/one.git' },
  ], () => `added_${++nextId}`);
  assert.equal(merged.changed, true);
  assert.deepEqual(merged.options, [
    ...normalized,
    { id: 'added_1', remoteName: 'origin', url: 'https://example.com/two.git' },
  ]);
  assert.equal(validateRemoteUrl('/tmp/repository.git').ok, true);
  assert.equal(validateRemoteUrl('').ok, false);
  const project = { remoteUrls: merged.options, selectedRemoteUrlId: 'two' };
  assert.equal(selectedRemoteUrlOption(project).remoteName, 'upstream');
  assert.deepEqual(selectedGitRemoteTarget(project), { type: 'git-remote', name: 'upstream' });
});
