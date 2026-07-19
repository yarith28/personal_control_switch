const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { classifyGitFailure, createGitService } = require('../src/main/git-process');

async function withRepo(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-sync-runner-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createGitService();
  assert.equal((await service.runGit(['init', '-b', 'main'], dir)).ok, true);
  assert.equal((await service.runGit(['config', 'user.name', 'Test User'], dir)).ok, true);
  assert.equal((await service.runGit(['config', 'user.email', 'test@example.com'], dir)).ok, true);
  return { dir, service };
}

test('Git failures receive actionable summaries', () => {
  const noUpstream = classifyGitFailure(
    ['push'],
    '',
    'fatal: The current branch main has no upstream branch.'
  );
  assert.equal(noUpstream.summary, 'No upstream branch is set for this branch.');
  assert.equal(noUpstream.code, 'NO_UPSTREAM');
  assert.equal(
    classifyGitFailure(['pull'], '', 'CONFLICT (content): Merge conflict in file.txt').summary,
    'Pull stopped because Git found merge conflicts that need manual resolution.'
  );
  assert.equal(
    classifyGitFailure(['fetch'], '', 'fatal: unable to access: Could not resolve host').summary,
    'Could not reach the remote repository. Check your network, VPN, or remote URL.'
  );
});

test('the Git runner commits input and reports repository state', async (t) => {
  const { dir, service } = await withRepo(t);
  await fs.writeFile(path.join(dir, 'hello.txt'), 'hello\n');
  assert.equal((await service.runGit(['add', '-A'], dir)).ok, true);
  assert.equal((await service.runGitWithInput(['commit', '-F', '-'], dir, 'Initial commit\n')).ok, true);
  const log = await service.runGit(['log', '-1', '--format=%s'], dir);
  assert.equal(log.ok, true);
  assert.equal(log.stdout.trim(), 'Initial commit');
});

test('streaming Git operations can be cancelled', { skip: process.platform === 'win32' }, async (t) => {
  const { dir } = await withRepo(t);
  const service = createGitService({ streamingTimeoutMs: 5000 });
  const pending = service.runGitStreaming(['-c', 'alias.wait=!sleep 5', 'wait'], dir);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(service.cancelRepoOperations(dir).cancelled, 1);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.errorSummary, 'Operation cancelled.');
});

test('Git operations are terminated after their configured timeout', { skip: process.platform === 'win32' }, async (t) => {
  const { dir } = await withRepo(t);
  const service = createGitService({ defaultTimeoutMs: 60 });
  const result = await service.runGit(['-c', 'alias.wait=!sleep 5', 'wait'], dir);
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.errorSummary, 'Git operation timed out.');
});
