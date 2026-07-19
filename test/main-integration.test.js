const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Module = require('node:module');

const execFileP = promisify(execFile);

function loadMainHandlers() {
  const handlers = new Map();
  const electronStub = {
    app: {
      isPackaged: false,
      whenReady: () => new Promise(() => {}),
      on: () => {},
      getPath: () => os.tmpdir(),
    },
    BrowserWindow: class BrowserWindow {},
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: {},
    nativeImage: {},
  };
  electronStub.BrowserWindow.getAllWindows = () => [];
  electronStub.BrowserWindow.fromWebContents = () => null;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/index.js')];
    require('../src/main/index.js');
  } finally {
    Module._load = originalLoad;
  }
  return handlers;
}

const handlers = loadMainHandlers();
const progressEvent = { sender: { send: () => {} } };

async function git(cwd, ...args) {
  const { stdout = '', stderr = '' } = await execFileP('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { stdout, stderr };
}

async function makeTempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function initRepo(dir) {
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.name', 'Integration Test');
  await git(dir, 'config', 'user.email', 'integration@example.com');
}

async function commitFile(dir, name, contents, message) {
  await fs.writeFile(path.join(dir, name), contents);
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-m', message);
}

test('fetch, pull, push, status, and quick commit handlers work with a local remote', async (t) => {
  const root = await makeTempDir(t, 'git-sync-ipc-');
  const remote = path.join(root, 'remote.git');
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  await fs.mkdir(remote);
  await git(remote, 'init', '--bare');
  await fs.mkdir(first);
  await initRepo(first);
  await commitFile(first, 'shared.txt', 'one\n', 'initial');
  await git(first, 'remote', 'add', 'origin', remote);
  await git(first, 'push', '-u', 'origin', 'main');
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git(root, 'clone', remote, second);
  await git(second, 'config', 'user.name', 'Integration Test');
  await git(second, 'config', 'user.email', 'integration@example.com');

  await commitFile(first, 'shared.txt', 'two\n', 'from first');
  assert.equal((await handlers.get('push')(progressEvent, first)).ok, true);
  assert.equal((await handlers.get('fetch')(progressEvent, second)).ok, true);
  const branches = await handlers.get('get-branches')(null, second);
  assert.equal(branches.ok, true);
  assert.equal(branches.behind, 1);
  assert.equal((await handlers.get('pull')(progressEvent, second)).ok, true);
  assert.equal(await fs.readFile(path.join(second, 'shared.txt'), 'utf8'), 'two\n');

  await fs.writeFile(path.join(second, 'new.txt'), 'new\n');
  const status = await handlers.get('git-status')(null, second);
  assert.equal(status.ok, true);
  assert.equal(status.changedCount, 1);
  assert.equal((await handlers.get('git-commit-all')(null, second, 'quick commit', false)).ok, true);
  assert.equal((await git(second, 'log', '-1', '--format=%s')).stdout.trim(), 'quick commit');

  const created = await handlers.get('create-branch')(null, second, 'feature/new-control');
  assert.equal(created.ok, true, created.errorSummary);
  assert.equal((await git(second, 'branch', '--show-current')).stdout.trim(), 'feature/new-control');
  assert.equal((await handlers.get('create-branch')(null, second, 'invalid branch name')).ok, false);

  const noUpstream = await handlers.get('push')(progressEvent, second);
  assert.equal(noUpstream.ok, false);
  assert.equal(noUpstream.errorCode, 'NO_UPSTREAM');
  const setupPush = await handlers.get('push-set-upstream')(progressEvent, second);
  assert.equal(setupPush.ok, true, setupPush.errorSummary);
  assert.equal(setupPush.remote, 'origin');
  assert.equal(setupPush.branch, 'feature/new-control');
  assert.equal(
    (await git(second, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')).stdout.trim(),
    'origin/feature/new-control'
  );

  const projectIdentity = await handlers.get('identity-get')(
    null,
    { scope: 'project', repoPath: second }
  );
  assert.equal(projectIdentity.ok, true);
  assert.equal(projectIdentity.name, 'Integration Test');
  assert.equal(projectIdentity.email, 'integration@example.com');

  const savedIdentity = await handlers.get('identity-save')(null, {
    scope: 'project',
    repoPath: second,
    name: 'Project Override',
    email: 'project@example.com',
  });
  assert.equal(savedIdentity.ok, true, savedIdentity.error);
  assert.equal((await git(second, 'config', '--local', '--get', 'user.name')).stdout.trim(), 'Project Override');

  const clearedIdentity = await handlers.get('identity-clear-project')(null, second);
  assert.equal(clearedIdentity.ok, true, clearedIdentity.error);
  assert.equal(clearedIdentity.hasNameOverride, false);
  assert.equal(clearedIdentity.hasEmailOverride, false);
});

test('Cross Sync compares and integrates related local repositories', async (t) => {
  const root = await makeTempDir(t, 'git-sync-cross-');
  const base = path.join(root, 'base');
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(base);
  await initRepo(base);
  await commitFile(base, 'base.txt', 'base\n', 'base');
  await git(root, 'clone', base, source);
  await git(root, 'clone', base, target);
  await git(source, 'config', 'user.name', 'Integration Test');
  await git(source, 'config', 'user.email', 'integration@example.com');
  await git(target, 'config', 'user.name', 'Integration Test');
  await git(target, 'config', 'user.email', 'integration@example.com');
  await commitFile(source, 'source.txt', 'source\n', 'source change');

  const payload = { sourcePath: source, sourceBranch: 'main', targetPath: target, targetBranch: 'main' };
  const comparison = await handlers.get('cross-compare')(null, payload);
  assert.equal(comparison.ok, true);
  assert.equal(comparison.related, true);
  assert.equal(comparison.incoming.length, 1);
  assert.equal(comparison.outgoing.length, 0);

  const integrated = await handlers.get('cross-integrate')(null, payload);
  assert.equal(integrated.ok, true, integrated.error);
  assert.equal((await git(source, 'rev-parse', 'HEAD')).stdout.trim(), (await git(target, 'rev-parse', 'HEAD')).stdout.trim());
  assert.equal(await fs.readFile(path.join(target, 'source.txt'), 'utf8'), 'source\n');
});

test('Commit Tool rewrites metadata and cleans up its temporary backup branch', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-rewrite-');
  await initRepo(repo);
  await commitFile(repo, 'one.txt', 'one\n', 'one');
  await commitFile(repo, 'two.txt', 'two\n', 'old subject');
  const oldHead = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();

  const result = await handlers.get('commit-tool-rewrite')(null, {
    repoPath: repo,
    commit: oldHead,
    message: 'new subject',
    authorMode: 'preserve',
    authorDateMode: 'preserve',
    committerMode: 'preserve',
    reSign: false,
  });

  assert.equal(result.ok, true, result.error);
  assert.notEqual(result.newHead, oldHead);
  assert.equal((await git(repo, 'log', '-1', '--format=%s')).stdout.trim(), 'new subject');
  const branches = (await git(repo, 'branch', '--list', 'pcs-backup-*')).stdout.trim();
  assert.equal(branches, '');
  assert.equal((await git(repo, 'status', '--porcelain')).stdout.trim(), '');
});
