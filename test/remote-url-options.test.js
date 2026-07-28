const test = require('node:test');
const assert = require('node:assert/strict');

test('remote history validates names, deduplicates URLs, and imports configured Git URLs', async () => {
  const {
    applyGitRemoteChange,
    mergeConfiguredRemoteUrls,
    normalizeRemoteUrlOptions,
    selectRemoteName,
    validateRemoteName,
    validateRemoteUrl,
  } = await import('../src/renderer/js/remote-url-options.mjs');

  const normalized = normalizeRemoteUrlOptions([
    { id: 'one', remoteName: ' origin ', url: ' https://example.com/one.git ' },
    { id: 'duplicate', remoteName: 'origin', url: 'https://example.com/one.git' },
    { id: 'duplicate_elsewhere', remoteName: 'upstream', url: 'https://example.com/one.git' },
    { id: 'history_only', url: '/tmp/repository.git' },
    { id: 'bad id', remoteName: 'origin', url: 'https://example.com/two.git' },
  ]);
  assert.deepEqual(normalized, [
    { id: 'one', remoteName: 'origin', url: 'https://example.com/one.git' },
    { id: 'history_only', url: '/tmp/repository.git' },
  ]);

  let nextId = 0;
  const merged = mergeConfiguredRemoteUrls(normalized, [
    {
      name: 'origin',
      url: 'https://example.com/two.git',
      urls: ['https://example.com/two.git', 'https://example.com/mirror.git'],
      pushUrl: 'ssh://push.example.com/repository.git',
      pushUrls: ['ssh://push.example.com/repository.git'],
    },
    { name: 'upstream', url: 'https://example.com/one.git' },
  ], () => `added_${++nextId}`);
  assert.equal(merged.changed, true);
  assert.deepEqual(merged.options, [
    ...normalized,
    { id: 'added_1', remoteName: 'origin', url: 'https://example.com/two.git' },
    { id: 'added_2', remoteName: 'origin', url: 'https://example.com/mirror.git' },
    { id: 'added_3', remoteName: 'origin', url: 'ssh://push.example.com/repository.git' },
  ]);

  const remotes = [{ name: 'origin' }, { name: 'job23' }];
  assert.equal(selectRemoteName('job23', remotes, ['origin']), 'job23');
  assert.equal(selectRemoteName('missing', remotes, ['origin']), 'origin');
  assert.equal(selectRemoteName('', [{ name: 'job23' }]), 'job23');
  assert.deepEqual(validateRemoteName(' work/account '), {
    ok: true,
    remoteName: 'work/account',
  });
  assert.equal(validateRemoteName('').ok, false);
  assert.equal(validateRemoteName('-work').ok, false);
  assert.equal(validateRemoteName('work remote').ok, false);
  assert.equal(validateRemoteName('work..remote').ok, false);
  assert.equal(validateRemoteUrl('/tmp/repository.git').ok, true);
  assert.equal(validateRemoteUrl('').ok, false);

  const project = {
    selectedRemoteName: 'origin',
    configuredRemote: 'origin',
    defaultRemote: 'origin',
    upstream: 'origin/main',
    remoteBranches: ['origin/main', 'job23/main'],
  };
  const changedRemote = {
    name: 'work',
    url: 'https://example.com/work.git',
    urls: ['https://example.com/work.git'],
    pushUrl: 'ssh://push.example.com/work.git',
    pushUrls: ['ssh://push.example.com/work.git'],
    hasExplicitPushUrl: true,
  };
  const changedRemotes = applyGitRemoteChange(
    project,
    [{ name: 'origin' }, { name: 'job23' }],
    { previousName: 'origin', remote: changedRemote }
  );
  assert.deepEqual(changedRemotes, [{ name: 'job23' }, changedRemote]);
  assert.equal(project.selectedRemoteName, 'work');
  assert.equal(project.configuredRemote, 'work');
  assert.equal(project.defaultRemote, 'work');
  assert.equal(project.upstream, 'work/main');
  assert.deepEqual(project.remoteBranches, ['work/main', 'job23/main']);
});
