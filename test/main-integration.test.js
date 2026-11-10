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

test('repository checks preserve Git failure details', async (t) => {
  const dir = await makeTempDir(t, 'git-sync-not-a-repo-');
  const result = await handlers.get('get-branches')(null, dir);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'This folder is not currently a Git repository.');
  assert.match(result.rawError, /not a git repository/i);
});

test('repository scan discovers nested repos and avoids dependency or repository subtrees', async (t) => {
  const root = await makeTempDir(t, 'git-sync-scan-');
  const first = path.join(root, 'first');
  const second = path.join(root, 'group', 'second');
  const nested = path.join(first, 'nested');
  const ignored = path.join(root, 'node_modules', 'ignored');
  await fs.mkdir(first, { recursive: true });
  await fs.mkdir(second, { recursive: true });
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(ignored, { recursive: true });
  await initRepo(first);
  await initRepo(second);
  await initRepo(nested);
  await initRepo(ignored);

  const result = await handlers.get('scan-git-repositories')(null, [root]);

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.repositories, [first, second].sort((left, right) => left.localeCompare(right)));
  assert.equal(result.truncated, false);
  assert.ok(result.scannedDirectories >= 3);

  const direct = await handlers.get('scan-git-repositories')(null, [second]);
  assert.deepEqual(direct.repositories, [second]);
});

test('status failures are not reported as a clean dashboard or Commit Tool state', async (t) => {
  const dir = await makeTempDir(t, 'git-sync-broken-index-');
  await initRepo(dir);
  await commitFile(dir, 'tracked.txt', 'tracked\n', 'initial');
  await fs.writeFile(path.join(dir, '.git', 'index'), 'broken-index');

  const branches = await handlers.get('get-branches')(null, dir);
  assert.equal(branches.ok, false);
  assert.match(branches.error, /status failed/i);
  assert.match(branches.rawError, /index/i);

  const history = await handlers.get('commit-tool-history')(null, dir, 100);
  assert.equal(history.ok, false);
  assert.match(history.error, /status failed|working tree/i);
  assert.match(history.raw, /index/i);
});

test('quick commit preserves staging failure details', async (t) => {
  const dir = await makeTempDir(t, 'git-sync-stage-error-');
  await initRepo(dir);
  await commitFile(dir, 'tracked.txt', 'tracked\n', 'initial');
  await fs.writeFile(path.join(dir, 'new.txt'), 'new\n');
  await fs.writeFile(path.join(dir, '.git', 'index.lock'), 'locked');

  const result = await handlers.get('git-commit-all')(null, dir, 'should not commit', false);
  assert.equal(result.ok, false);
  assert.equal(result.errorSummary, 'Staging changes failed.');
  assert.match(result.errorRaw, /index\.lock|another git process/i);
});

test('Cross Sync propagates comparison and target-status failures', async (t) => {
  const root = await makeTempDir(t, 'git-sync-cross-errors-');
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(source);
  await fs.mkdir(target);
  await initRepo(source);
  await initRepo(target);
  await commitFile(source, 'source.txt', 'source\n', 'source');
  await commitFile(target, 'target.txt', 'target\n', 'target');

  const compare = await handlers.get('cross-compare')(null, {
    sourcePath: source,
    sourceBranch: 'main',
    targetPath: target,
    targetBranch: 'missing-branch',
  });
  assert.equal(compare.ok, false);
  assert.match(compare.error, /compare incoming commits|git command failed/i);
  assert.match(compare.raw, /unknown revision|ambiguous argument/i);

  await fs.writeFile(path.join(target, '.git', 'index'), 'broken-index');
  const beforeBranch = (await git(target, 'branch', '--show-current')).stdout.trim();
  const integrate = await handlers.get('cross-integrate')(null, {
    sourcePath: source,
    sourceBranch: 'main',
    targetPath: target,
    targetBranch: 'main',
  });
  assert.equal(integrate.ok, false);
  assert.match(integrate.error, /status failed|working tree/i);
  assert.match(integrate.raw, /index/i);
  assert.equal((await git(target, 'branch', '--show-current')).stdout.trim(), beforeBranch);
});

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

test('history preview shows current-branch commits and exact staged, unstaged, and untracked paths', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-history-preview-');
  await initRepo(repo);
  await commitFile(repo, 'tracked.txt', 'original\n', 'initial commit');
  const initial = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'checkout', '-b', 'other');
  await commitFile(repo, 'other.txt', 'other branch\n', 'other branch only');
  await git(repo, 'checkout', 'main');
  await commitFile(repo, 'old name.txt', 'rename me\n', 'add file for rename');
  await git(repo, 'mv', 'old name.txt', 'new name.txt');
  await fs.writeFile(path.join(repo, 'tracked.txt'), 'staged\n');
  await git(repo, 'add', 'tracked.txt');
  await fs.writeFile(path.join(repo, 'tracked.txt'), 'unstaged\n');
  const newPath = 'new [literal]\nfile.txt';
  await fs.writeFile(path.join(repo, newPath), '<script>new file</script>\n');
  const statusBefore = (await git(repo, 'status', '--porcelain=v1', '-z')).stdout;

  const preview = await handlers.get('git-history-preview')(null, repo);
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.branch, 'main');
  assert.deepEqual(preview.commits.map((commit) => commit.subject), ['add file for rename', 'initial commit']);
  const tracked = preview.changes.find((file) => file.path === 'tracked.txt');
  assert.equal(tracked.staged, true);
  assert.equal(tracked.unstaged, true);
  assert.equal(preview.changes.find((file) => file.path === newPath).untracked, true);
  assert.equal(preview.changes.find((file) => file.path === 'new name.txt').originalPath, 'old name.txt');

  const staged = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: 'tracked.txt', kind: 'staged' });
  assert.equal(staged.ok, true, staged.error);
  assert.match(staged.patch, /\+staged/);
  assert.doesNotMatch(staged.patch, /\+unstaged/);
  const unstaged = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: 'tracked.txt', kind: 'unstaged' });
  assert.match(unstaged.patch, /\+unstaged/);
  const untracked = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: newPath, kind: 'untracked' });
  assert.equal(untracked.patch, '<script>new file</script>\n');
  assert.equal(untracked.plainText, true);

  const root = await handlers.get('git-history-commit')(null, repo, initial);
  assert.equal(root.ok, true, root.error);
  assert.deepEqual(root.files.map((file) => file.path), ['tracked.txt']);
  const rootPatch = await handlers.get('git-history-patch')(null, { repoPath: repo, commit: initial, filePath: 'tracked.txt' });
  assert.match(rootPatch.patch, /\+original/);
  assert.equal((await git(repo, 'status', '--porcelain=v1', '-z')).stdout, statusBefore);
  await git(repo, 'commit', '-m', 'rename and update');
  const renamedSha = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  const renamed = await handlers.get('git-history-commit')(null, repo, renamedSha);
  assert.equal(renamed.files.find((file) => file.path === 'new name.txt').originalPath, 'old name.txt');
  const renamePatch = await handlers.get('git-history-patch')(null, {
    repoPath: repo, commit: renamedSha, filePath: 'new name.txt', originalPath: 'old name.txt',
  });
  assert.match(renamePatch.patch, /rename from old name.txt/);
});

test('history preview limits display to 30 commits while preserving the full repository history', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-history-limit-');
  await initRepo(repo);
  await commitFile(repo, 'tracked.txt', 'initial\n', 'Commit 1');
  for (let index = 2; index <= 35; index += 1) {
    await git(repo, 'commit', '--allow-empty', '-m', `Commit ${index}`);
  }
  const preview = await handlers.get('git-history-preview')(null, repo);
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.commits.length, 30);
  assert.equal(preview.totalCount, 35);
  assert.equal(preview.commits[0].subject, 'Commit 35');
  assert.equal(preview.commits.at(-1).subject, 'Commit 6');
  assert.equal((await git(repo, 'rev-list', '--count', 'HEAD')).stdout.trim(), '35');
  const commitTool = await handlers.get('commit-tool-history')(null, repo);
  assert.equal(commitTool.ok, true, commitTool.error);
  assert.equal(commitTool.commits.length, 35);
});

test('history preview handles unborn and detached branches and bounds new-file previews', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-history-empty-');
  await initRepo(repo);
  await fs.writeFile(path.join(repo, 'new.txt'), 'first file\n');
  await git(repo, 'add', 'new.txt');
  const unborn = await handlers.get('git-history-preview')(null, repo);
  assert.equal(unborn.ok, true, unborn.error);
  assert.equal(unborn.branch, 'main');
  assert.deepEqual(unborn.commits, []);
  assert.equal(unborn.changes[0].staged, true);
  const staged = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: 'new.txt', kind: 'staged' });
  assert.equal(staged.ok, true, staged.error);
  assert.match(staged.patch, /\+first file/);
  await git(repo, 'commit', '-m', 'initial');
  await git(repo, 'checkout', '--detach');
  const detached = await handlers.get('git-history-preview')(null, repo);
  assert.equal(detached.detached, true);
  assert.equal(detached.commits.length, 1);

  await fs.writeFile(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2]));
  const binary = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: 'binary.bin', kind: 'untracked' });
  assert.equal(binary.binary, true);
  await fs.writeFile(path.join(repo, 'large.txt'), 'a'.repeat(170000));
  const large = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: 'large.txt', kind: 'untracked' });
  assert.equal(large.truncated, true);
  assert.equal(large.patch.length, 160000);
  const outside = await handlers.get('git-history-patch')(null, { repoPath: repo, filePath: '../outside', kind: 'untracked' });
  assert.equal(outside.ok, false);
});

test('history preview compares merge commits with their first parent', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-history-merge-');
  await initRepo(repo);
  await commitFile(repo, 'base.txt', 'base\n', 'base');
  await git(repo, 'checkout', '-b', 'feature');
  await commitFile(repo, 'feature.txt', 'feature\n', 'feature');
  await git(repo, 'checkout', 'main');
  await commitFile(repo, 'main.txt', 'main\n', 'main');
  await git(repo, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
  const sha = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  const detail = await handlers.get('git-history-commit')(null, repo, sha);
  assert.equal(detail.ok, true, detail.error);
  assert.equal(detail.commit.parents.length, 2);
  assert.deepEqual(detail.files.map((file) => file.path), ['feature.txt']);
  const patch = await handlers.get('git-history-patch')(null, { repoPath: repo, commit: sha, filePath: 'feature.txt' });
  assert.match(patch.patch, /\+feature/);
});

test('file-status actions stage exact files and commit staged changes only', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-file-status-');
  await initRepo(repo);
  await commitFile(repo, 'tracked.txt', 'base\n', 'initial');
  const literal = 'new [file].txt';
  await fs.writeFile(path.join(repo, literal), 'new file\n');
  await fs.writeFile(path.join(repo, 'tracked.txt'), 'staged value\n');
  const stage = handlers.get('git-history-set-staging');
  const staged = await stage(null, { repoPath: repo, paths: ['tracked.txt', literal], staged: true });
  assert.equal(staged.ok, true, staged.error);
  const preview = await handlers.get('git-history-preview')(null, repo);
  assert.equal(preview.ok, true, preview.error);
  await fs.writeFile(path.join(repo, 'tracked.txt'), 'unstaged value\n');
  const committed = await handlers.get('git-history-commit-staged')(
    null, repo, 'Commit selected changes', preview.commitSnapshot
  );
  assert.equal(committed.ok, true, committed.error);
  assert.equal((await git(repo, 'show', 'HEAD:tracked.txt')).stdout, 'staged value\n');
  assert.equal(await fs.readFile(path.join(repo, 'tracked.txt'), 'utf8'), 'unstaged value\n');
  assert.equal((await git(repo, 'show', `HEAD:${literal}`)).stdout, 'new file\n');
  assert.match((await git(repo, 'status', '--porcelain')).stdout, / M tracked.txt/);
  const empty = await handlers.get('git-history-commit-staged')(null, repo, 'Nothing staged');
  assert.equal(empty.ok, false);
  const invalid = await stage(null, { repoPath: repo, paths: ['../outside'], staged: true });
  assert.equal(invalid.ok, false);
});

test('history preview refreshes status without reloading unchanged history', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-incremental-preview-');
  await initRepo(repo);
  await commitFile(repo, 'tracked.txt', 'initial\n', 'initial');
  const preview = handlers.get('git-history-preview');
  const initial = await preview(null, repo);
  assert.equal(initial.ok, true, initial.error);
  assert.equal(initial.commits.length, 1);

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'staged\n');
  await git(repo, 'add', 'tracked.txt');
  const staged = await preview(null, repo, initial.commitSnapshot);
  assert.equal(staged.ok, true, staged.error);
  assert.equal(Object.hasOwn(staged, 'commits'), false);
  assert.equal(Object.hasOwn(staged, 'totalCount'), false);
  assert.equal(staged.changes[0].staged, true);
  assert.notEqual(staged.commitSnapshot.index, initial.commitSnapshot.index);

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'working\n');
  const working = await preview(null, repo, staged.commitSnapshot);
  assert.equal(working.ok, true, working.error);
  assert.equal(Object.hasOwn(working, 'commits'), false);
  assert.equal(working.changes[0].unstaged, true);
  assert.deepEqual(working.commitSnapshot, staged.commitSnapshot);

  const committed = await handlers.get('git-history-commit-staged')(
    null, repo, 'Selected changes', working.commitSnapshot
  );
  assert.equal(committed.ok, true, committed.error);
  const afterCommit = await preview(null, repo, working.commitSnapshot);
  assert.equal(afterCommit.ok, true, afterCommit.error);
  assert.equal(afterCommit.totalCount, 2);
  assert.equal(afterCommit.commits[0].subject, 'Selected changes');

  await git(repo, 'switch', '-c', 'other');
  const afterSwitch = await preview(null, repo, afterCommit.commitSnapshot);
  assert.equal(afterSwitch.ok, true, afterSwitch.error);
  assert.equal(afterSwitch.branch, 'other');
  assert.equal(afterSwitch.commits.length, 2);
  const explicitRefresh = await preview(null, repo);
  assert.equal(explicitRefresh.ok, true, explicitRefresh.error);
  assert.equal(explicitRefresh.commits.length, 2);
});

test('file-status unstage preserves files before and after the first commit', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-unstage-');
  await initRepo(repo);
  await fs.writeFile(path.join(repo, 'new.txt'), 'original content\n');
  const stage = handlers.get('git-history-set-staging');
  assert.equal((await stage(null, { repoPath: repo, paths: ['new.txt'], staged: true })).ok, true);
  const unstaged = await stage(null, { repoPath: repo, paths: ['new.txt'], staged: false });
  assert.equal(unstaged.ok, true, unstaged.error);
  assert.equal(await fs.readFile(path.join(repo, 'new.txt'), 'utf8'), 'original content\n');
  assert.match((await git(repo, 'status', '--porcelain')).stdout, /\?\? new.txt/);
  await commitFile(repo, 'new.txt', 'original content\n', 'initial');
  await fs.writeFile(path.join(repo, 'new.txt'), 'edited content\n');
  await stage(null, { repoPath: repo, paths: ['new.txt'], staged: true });
  assert.equal((await stage(null, { repoPath: repo, paths: ['new.txt'], staged: false })).ok, true);
  assert.equal(await fs.readFile(path.join(repo, 'new.txt'), 'utf8'), 'edited content\n');
  assert.equal((await git(repo, 'diff', '--cached')).stdout, '');
});

test('file-status resolves subfolder projects to the worktree root for previews and mutations', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-subfolder-status-');
  const subfolder = path.join(repo, 'sub');
  await initRepo(repo);
  await fs.mkdir(subfolder);
  await commitFile(repo, 'shared.txt', 'root initial\n', 'root file');
  await commitFile(repo, 'sub/shared.txt', 'nested initial\n', 'nested file');
  const head = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await fs.writeFile(path.join(repo, 'shared.txt'), 'root edited\n');
  await fs.writeFile(path.join(subfolder, 'shared.txt'), 'nested edited\n');
  await fs.writeFile(path.join(repo, 'new.txt'), 'root untracked\n');
  await fs.writeFile(path.join(subfolder, 'new.txt'), 'nested untracked\n');

  const preview = await handlers.get('git-history-preview')(null, subfolder);
  assert.equal(preview.ok, true, preview.error);
  assert.deepEqual(preview.changes.map((file) => file.path).sort(), [
    'new.txt', 'shared.txt', 'sub/new.txt', 'sub/shared.txt',
  ]);
  const patch = await handlers.get('git-history-patch')(null, {
    repoPath: subfolder, filePath: 'shared.txt', kind: 'unstaged',
  });
  assert.equal(patch.ok, true, patch.error);
  assert.match(patch.patch, /\+root edited/);
  assert.doesNotMatch(patch.patch, /nested edited/);
  const untracked = await handlers.get('git-history-patch')(null, {
    repoPath: subfolder, filePath: 'new.txt', kind: 'untracked',
  });
  assert.equal(untracked.patch, 'root untracked\n');
  const detail = await handlers.get('git-history-commit')(null, subfolder, head);
  assert.equal(detail.ok, true, detail.error);
  assert.deepEqual(detail.files.map((file) => file.path), ['sub/shared.txt']);
  const committedPatch = await handlers.get('git-history-patch')(null, {
    repoPath: subfolder, filePath: 'sub/shared.txt', commit: head,
  });
  assert.match(committedPatch.patch, /\+nested initial/);

  const stage = handlers.get('git-history-set-staging');
  assert.equal((await stage(null, { repoPath: subfolder, paths: ['shared.txt'], staged: true })).ok, true);
  assert.equal((await git(repo, 'diff', '--cached', '--name-only')).stdout.trim(), 'shared.txt');
  assert.equal((await stage(null, { repoPath: subfolder, paths: ['shared.txt'], staged: false })).ok, true);
  assert.equal((await git(repo, 'diff', '--cached')).stdout, '');
  assert.equal((await stage(null, { repoPath: subfolder, paths: ['shared.txt'], staged: true })).ok, true);
  const stagedPreview = await handlers.get('git-history-preview')(null, subfolder);
  const result = await handlers.get('git-history-commit-staged')(
    null, subfolder, 'Commit root file', stagedPreview.commitSnapshot
  );
  assert.equal(result.ok, true, result.error);
  assert.equal((await git(repo, 'show', 'HEAD:shared.txt')).stdout, 'root edited\n');
  assert.equal((await git(repo, 'show', 'HEAD:sub/shared.txt')).stdout, 'nested initial\n');
});

test('file-status rejects stale branch, HEAD, and staged-content snapshots', async (t) => {
  const scenarios = [
    ['branch switch with the same HEAD and index', async (repo) => {
      await git(repo, 'switch', '-c', 'other');
    }],
    ['detached HEAD with the same commit and index', async (repo) => {
      await git(repo, 'checkout', '--detach');
    }],
    ['another staged file', async (repo) => {
      await fs.writeFile(path.join(repo, 'extra.txt'), 'unreviewed\n');
      await git(repo, 'add', 'extra.txt');
    }],
    ['different staged content at the same path', async (repo) => {
      await fs.writeFile(path.join(repo, 'tracked.txt'), 'unreviewed replacement\n');
      await git(repo, 'add', 'tracked.txt');
    }],
    ['HEAD update with the same branch and index', async (repo) => {
      const head = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
      const tree = (await git(repo, 'rev-parse', 'HEAD^{tree}')).stdout.trim();
      const next = (await git(repo, 'commit-tree', tree, '-p', head, '-m', 'External empty commit')).stdout.trim();
      await git(repo, 'update-ref', 'HEAD', next, head);
    }],
  ];
  for (const [name, change] of scenarios) {
    await t.test(name, async (t) => {
      const repo = await makeTempDir(t, 'git-sync-stale-status-');
      await initRepo(repo);
      await commitFile(repo, 'tracked.txt', 'initial\n', 'initial');
      await fs.writeFile(path.join(repo, 'tracked.txt'), 'reviewed\n');
      await git(repo, 'add', 'tracked.txt');
      const preview = await handlers.get('git-history-preview')(null, repo);
      assert.equal(preview.ok, true, preview.error);
      await change(repo);
      const headBefore = (await git(repo, 'rev-parse', 'HEAD')).stdout;
      const indexBefore = (await git(repo, 'ls-files', '--stage', '-z')).stdout;
      const result = await handlers.get('git-history-commit-staged')(
        null, repo, 'Commit reviewed changes', preview.commitSnapshot
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'HISTORY_STATE_CHANGED');
      assert.equal((await git(repo, 'rev-parse', 'HEAD')).stdout, headBefore);
      assert.equal((await git(repo, 'ls-files', '--stage', '-z')).stdout, indexBefore);
      const refreshed = await handlers.get('git-history-preview')(null, repo);
      const retry = await handlers.get('git-history-commit-staged')(
        null, repo, 'Commit refreshed changes', refreshed.commitSnapshot
      );
      assert.equal(retry.ok, true, retry.error);
    });
  }
});

test('file-status requires a snapshot and supports the first commit on an unborn branch', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-first-status-commit-');
  await initRepo(repo);
  await fs.writeFile(path.join(repo, 'first.txt'), 'first\n');
  await git(repo, 'add', 'first.txt');
  const commit = handlers.get('git-history-commit-staged');
  const missing = await commit(null, repo, 'Missing snapshot');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'HISTORY_STATE_CHANGED');
  const preview = await handlers.get('git-history-preview')(null, repo);
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.commitSnapshot.head, '');
  assert.equal(preview.commitSnapshot.ref, 'refs/heads/main');
  const initial = await commit(null, repo, 'Initial commit', preview.commitSnapshot);
  assert.equal(initial.ok, true, initial.error);
  assert.equal((await git(repo, 'show', 'HEAD:first.txt')).stdout, 'first\n');
});

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

  await git(first, 'checkout', '-b', 'feature/remote-only');
  await commitFile(first, 'remote.txt', 'remote branch\n', 'remote branch');
  await git(first, 'push', '-u', 'origin', 'feature/remote-only');
  await git(first, 'checkout', 'main');
  await git(
    second,
    'fetch',
    'origin',
    'refs/heads/feature/remote-only:refs/remotes/origin/feature/remote-only'
  );

  const withRemoteBranches = await handlers.get('get-branches')(null, second);
  assert.equal(withRemoteBranches.ok, true);
  assert.ok(withRemoteBranches.remoteBranches.includes('origin/feature/remote-only'));
  assert.ok(!withRemoteBranches.remoteBranches.includes('origin/HEAD'));

  const remoteCheckout = await handlers.get('checkout-remote-branch')(
    null,
    second,
    'origin/feature/remote-only'
  );
  assert.equal(remoteCheckout.ok, true, remoteCheckout.errorSummary);
  assert.equal(remoteCheckout.created, true);
  assert.equal(remoteCheckout.branch, 'feature/remote-only');
  assert.equal((await git(second, 'branch', '--show-current')).stdout.trim(), 'feature/remote-only');
  assert.equal(
    (await git(second, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')).stdout.trim(),
    'origin/feature/remote-only'
  );
  await git(second, 'checkout', 'main');
  const existingRemoteCheckout = await handlers.get('checkout-remote-branch')(
    null,
    second,
    'origin/feature/remote-only'
  );
  assert.equal(existingRemoteCheckout.ok, true, existingRemoteCheckout.errorSummary);
  assert.equal(existingRemoteCheckout.created, false);
  await git(second, 'checkout', 'main');

  await commitFile(second, 'local.txt', 'local\n', 'local change');
  await git(second, 'config', 'pull.rebase', 'false');
  const rejectingMergeHook = path.join(second, '.git', 'hooks', 'pre-merge-commit');
  await fs.writeFile(rejectingMergeHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingMergeHook, 0o755);
  await commitFile(first, 'shared.txt', 'two\n', 'from first');
  const rejectingPushHook = path.join(first, '.git', 'hooks', 'pre-push');
  await fs.writeFile(rejectingPushHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingPushHook, 0o755);
  assert.equal((await handlers.get('push')(progressEvent, first)).ok, true);
  assert.equal((await handlers.get('fetch')(progressEvent, second)).ok, true);
  const branches = await handlers.get('get-branches')(null, second);
  assert.equal(branches.ok, true);
  assert.equal(branches.hasUpstream, true);
  assert.equal(branches.upstream, 'origin/main');
  assert.equal(branches.behind, 1);
  assert.equal((await handlers.get('pull')(progressEvent, second)).ok, true);
  assert.equal(await fs.readFile(path.join(second, 'shared.txt'), 'utf8'), 'two\n');

  await fs.writeFile(path.join(second, 'new.txt'), 'new\n');
  const rejectingCommitHook = path.join(second, '.git', 'hooks', 'pre-commit');
  await fs.writeFile(rejectingCommitHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingCommitHook, 0o755);
  const rejectingPrepareMessageHook = path.join(second, '.git', 'hooks', 'prepare-commit-msg');
  await fs.writeFile(rejectingPrepareMessageHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingPrepareMessageHook, 0o755);
  const status = await handlers.get('git-status')(null, second);
  assert.equal(status.ok, true);
  assert.equal(status.changedCount, 1);
  assert.equal((await handlers.get('git-commit-all')(null, second, 'quick commit', false)).ok, true);
  assert.equal((await git(second, 'log', '-1', '--format=%s')).stdout.trim(), 'quick commit');
  assert.equal((await handlers.get('git-commit-all')(null, second, 'amended quick commit', true)).ok, true);
  assert.equal((await git(second, 'log', '-1', '--format=%s')).stdout.trim(), 'amended quick commit');

  const created = await handlers.get('create-branch')(null, second, 'feature/new-control');
  assert.equal(created.ok, true, created.errorSummary);
  assert.equal((await git(second, 'branch', '--show-current')).stdout.trim(), 'feature/new-control');
  assert.equal((await handlers.get('create-branch')(null, second, 'invalid branch name')).ok, false);

  const localOnly = await handlers.get('get-branches')(null, second);
  assert.equal(localOnly.hasUpstream, false);
  assert.equal(localOnly.upstream, null);
  assert.equal(localOnly.configuredRemote, null);
  assert.equal(localOnly.defaultRemote, 'origin');

  const rejectingSetupPushHook = path.join(second, '.git', 'hooks', 'pre-push');
  await fs.writeFile(rejectingSetupPushHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingSetupPushHook, 0o755);
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
  const trackedBranch = await handlers.get('get-branches')(null, second);
  assert.equal(trackedBranch.hasUpstream, true);
  assert.equal(trackedBranch.upstream, 'origin/feature/new-control');

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

test('force push reports its exact target, rejects stale confirmation, and skips hooks', async (t) => {
  const root = await makeTempDir(t, 'git-sync-force-push-');
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  await fs.mkdir(remote);
  await git(remote, 'init', '--bare');
  await fs.mkdir(repo);
  await initRepo(repo);
  await commitFile(repo, 'shared.txt', 'one\n', 'first');
  const firstCommit = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'remote', 'add', 'origin', remote);
  await git(repo, 'push', '-u', 'origin', 'main');
  await commitFile(repo, 'shared.txt', 'two\n', 'second');
  await git(repo, 'push', 'origin', 'main');
  await git(repo, 'reset', '--hard', firstCommit);

  const rejectingPushHook = path.join(repo, '.git', 'hooks', 'pre-push');
  await fs.writeFile(rejectingPushHook, '#!/bin/sh\nexit 1\n');
  await fs.chmod(rejectingPushHook, 0o755);

  const target = await handlers.get('get-force-push-target')(null, repo);
  assert.deepEqual(target, {
    ok: true,
    branch: 'main',
    remote: 'origin',
    remoteBranch: 'main',
    remoteUrl: remote,
    remoteUrls: [remote],
  });

  const stale = await handlers.get('force-push')(
    progressEvent,
    repo,
    { ...target, remoteUrl: `${remote}-changed` }
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, 'PUSH_TARGET_CHANGED');

  const pushed = await handlers.get('force-push')(progressEvent, repo, target);
  assert.equal(pushed.ok, true, pushed.errorSummary);
  assert.equal((await git(remote, 'rev-parse', 'refs/heads/main')).stdout.trim(), firstCommit);
});

test('app-managed remote operations use one URL without changing Git configuration', async (t) => {
  const root = await makeTempDir(t, 'git-sync-app-remote-');
  const remote = path.join(root, 'remote.git');
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(remote);
  await git(remote, 'init', '--bare');
  await fs.mkdir(source);
  await initRepo(source);
  await commitFile(source, 'shared.txt', 'one\n', 'initial');
  await git(source, 'push', remote, 'main:main');

  await fs.mkdir(target);
  await initRepo(target);
  await git(target, 'fetch', remote, 'main');
  await git(target, 'reset', '--hard', 'FETCH_HEAD');
  const configPath = path.join(target, '.git', 'config');
  const configBefore = await fs.readFile(configPath, 'utf8');
  const appRemote = { id: 'team_remote', name: 'team', url: remote };

  assert.equal((await handlers.get('test-app-remote')(null, target, appRemote)).ok, true);
  await commitFile(source, 'shared.txt', 'two\n', 'source update');
  await git(source, 'push', remote, 'main:main');
  await git(source, 'checkout', '-b', 'other');
  await commitFile(source, 'other.txt', 'other\n', 'other branch');
  await git(source, 'push', remote, 'other:other');
  await git(source, 'checkout', 'main');

  const fetched = await handlers.get('fetch')(progressEvent, target, appRemote);
  assert.equal(fetched.ok, true, fetched.errorSummary);
  await assert.rejects(
    git(target, 'rev-parse', '--verify', 'refs/git-sync/remotes/team_remote/other')
  );
  const status = await handlers.get('get-branches')(null, target, appRemote);
  assert.equal(status.ok, true);
  assert.equal(status.hasRemoteBranch, true);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 1);

  const pulled = await handlers.get('pull')(progressEvent, target, appRemote);
  assert.equal(pulled.ok, true, pulled.errorSummary);
  assert.equal(await fs.readFile(path.join(target, 'shared.txt'), 'utf8'), 'two\n');

  await commitFile(target, 'target.txt', 'target\n', 'target update');
  const pushed = await handlers.get('push')(progressEvent, target, appRemote);
  assert.equal(pushed.ok, true, pushed.errorSummary);
  assert.equal(
    (await git(target, 'rev-parse', 'HEAD')).stdout.trim(),
    (await git(remote, 'rev-parse', 'refs/heads/main')).stdout.trim()
  );

  assert.equal(await fs.readFile(configPath, 'utf8'), configBefore);
  assert.equal((await handlers.get('clear-app-remote')(null, target, appRemote.id)).ok, true);
  await assert.rejects(git(target, 'rev-parse', '--verify', 'refs/git-sync/remotes/team_remote/main'));
  assert.equal(await fs.readFile(configPath, 'utf8'), configBefore);
});

test('Remote Changer renames a repository remote and changes its URL', async (t) => {
  const root = await makeTempDir(t, 'git-sync-remote-manager-');
  const firstRemote = path.join(root, 'first.git');
  const secondRemote = path.join(root, 'second.git');
  const mirrorRemote = path.join(root, 'mirror.git');
  const pushRemote = path.join(root, 'push.git');
  const repo = path.join(root, 'repo');
  await fs.mkdir(firstRemote);
  await git(firstRemote, 'init', '--bare');
  await fs.mkdir(secondRemote);
  await git(secondRemote, 'init', '--bare');
  await fs.mkdir(mirrorRemote);
  await git(mirrorRemote, 'init', '--bare');
  await fs.mkdir(pushRemote);
  await git(pushRemote, 'init', '--bare');
  await fs.mkdir(repo);
  await initRepo(repo);
  await commitFile(repo, 'tracked.txt', 'tracked\n', 'initial commit');
  await git(repo, 'remote', 'add', 'origin', firstRemote);
  await git(repo, 'remote', 'set-url', '--add', 'origin', mirrorRemote);
  await git(repo, 'remote', 'set-url', '--push', '--add', 'origin', pushRemote);
  await git(repo, 'remote', 'add', 'job23', secondRemote);
  await git(repo, 'config', 'branch.main.remote', 'origin');
  await git(repo, 'config', 'branch.main.pushRemote', 'origin');
  await git(repo, 'config', 'branch.main.merge', 'refs/heads/main');
  await git(repo, 'config', 'remote.pushDefault', 'origin');
  await git(repo, 'update-ref', 'refs/remotes/origin/cached', 'HEAD');
  await git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/cached');

  const listed = await handlers.get('get-git-remotes')(null, repo);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.remotes.map((remote) => remote.name), ['job23', 'origin']);
  const originInfo = listed.remotes.find((remote) => remote.name === 'origin');
  assert.deepEqual(originInfo, {
    name: 'origin',
    url: firstRemote,
    urls: [firstRemote, mirrorRemote],
    pushUrl: pushRemote,
    pushUrls: [pushRemote],
    hasExplicitPushUrl: true,
  });
  assert.equal(handlers.has('add-git-remote'), false);
  assert.equal(handlers.has('set-active-git-remote'), false);
  assert.equal(handlers.has('set-git-remote-url'), false);
  assert.equal(handlers.has('change-git-remote'), true);

  const startup = await handlers.get('get-branches')(null, repo);
  assert.equal(startup.ok, true);
  assert.deepEqual(startup.gitRemotes, listed.remotes);
  assert.equal(startup.configuredRemote, 'origin');
  const branchRemoteBefore = (await git(repo, 'config', '--get', 'branch.main.remote')).stdout.trim();
  const trackingRefBefore = (
    await git(repo, 'rev-parse', 'refs/remotes/origin/cached')
  ).stdout.trim();

  const collision = await handlers.get('change-git-remote')(
    null,
    repo,
    'origin',
    'job23',
    firstRemote
  );
  assert.equal(collision.ok, false);
  assert.equal(collision.errorCode, 'GIT_REMOTE_ALREADY_EXISTS');
  assert.equal((await git(repo, 'remote', 'get-url', 'origin')).stdout.trim(), firstRemote);
  assert.equal(
    (await git(repo, 'config', '--get', 'branch.main.remote')).stdout.trim(),
    branchRemoteBefore
  );

  const changed = await handlers.get('change-git-remote')(
    null,
    repo,
    'origin',
    'work',
    secondRemote
  );
  assert.equal(changed.ok, true, changed.errorSummary);
  assert.equal(changed.renamed, true);
  assert.equal(changed.previousName, 'origin');
  assert.equal(changed.previousUrl, firstRemote);
  assert.equal(changed.remote.name, 'work');
  assert.equal(changed.remote.url, secondRemote);
  assert.deepEqual(changed.remote.urls, [secondRemote, mirrorRemote]);
  assert.equal(changed.remote.pushUrl, pushRemote);
  assert.deepEqual(changed.remote.pushUrls, [pushRemote]);
  assert.equal(changed.remote.hasExplicitPushUrl, true);
  await assert.rejects(git(repo, 'remote', 'get-url', 'origin'));
  assert.equal((await git(repo, 'remote', 'get-url', 'work')).stdout.trim(), secondRemote);
  assert.deepEqual(
    (await git(repo, 'remote', 'get-url', '--all', 'work')).stdout.trim().split(/\r?\n/),
    [secondRemote, mirrorRemote]
  );
  assert.equal((await git(repo, 'remote', 'get-url', '--push', 'work')).stdout.trim(), pushRemote);
  assert.equal(
    (await git(repo, 'config', '--get', 'branch.main.remote')).stdout.trim(),
    'work'
  );
  assert.equal(
    (await git(repo, 'config', '--get', 'branch.main.pushRemote')).stdout.trim(),
    'work'
  );
  assert.equal(
    (await git(repo, 'config', '--get', 'remote.pushDefault')).stdout.trim(),
    'work'
  );
  assert.deepEqual(
    (await git(repo, 'config', '--get-all', 'remote.work.fetch')).stdout.trim().split(/\r?\n/),
    ['+refs/heads/*:refs/remotes/work/*']
  );
  await assert.rejects(git(repo, 'rev-parse', '--verify', 'refs/remotes/origin/cached'));
  assert.equal(
    (await git(repo, 'rev-parse', 'refs/remotes/work/cached')).stdout.trim(),
    trackingRefBefore
  );
  assert.equal(
    (await git(repo, 'symbolic-ref', 'refs/remotes/work/HEAD')).stdout.trim(),
    'refs/remotes/work/cached'
  );
  assert.equal((await git(repo, 'remote', 'get-url', 'job23')).stdout.trim(), secondRemote);

  const urlOnly = await handlers.get('change-git-remote')(
    null,
    repo,
    'work',
    'work',
    firstRemote
  );
  assert.equal(urlOnly.ok, true, urlOnly.errorSummary);
  assert.equal(urlOnly.renamed, false);
  assert.equal(urlOnly.remote.name, 'work');
  assert.equal(urlOnly.remote.url, firstRemote);
  assert.deepEqual(urlOnly.remote.urls, [firstRemote, mirrorRemote]);
  assert.deepEqual(urlOnly.remote.pushUrls, [pushRemote]);
  assert.equal((await git(repo, 'remote', 'get-url', '--push', 'work')).stdout.trim(), pushRemote);
  assert.equal(
    (await git(repo, 'config', '--get', 'branch.main.remote')).stdout.trim(),
    'work'
  );

  const missing = await handlers.get('change-git-remote')(
    null,
    repo,
    'missing',
    'replacement',
    firstRemote
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, 'GIT_REMOTE_NOT_FOUND');
});

test('Remote Changer reuses an existing destination tracking-ref cache', async (t) => {
  const root = await makeTempDir(t, 'git-sync-remote-cache-');
  const repo = path.join(root, 'repo');
  const originUrl = path.join(root, 'origin.git');
  const job23Url = path.join(root, 'job23.git');
  await fs.mkdir(repo);
  await initRepo(repo);
  await commitFile(repo, 'first.txt', 'first\n', 'first commit');
  const firstCommit = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await commitFile(repo, 'second.txt', 'second\n', 'second commit');
  const secondCommit = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'remote', 'add', 'origin', originUrl);
  await git(repo, 'config', 'branch.main.remote', 'origin');
  await git(repo, 'config', 'branch.main.merge', 'refs/heads/main');
  await git(repo, 'update-ref', 'refs/remotes/origin/cached', secondCommit);
  await git(repo, 'update-ref', 'refs/remotes/job23/cached', firstCommit);
  await git(repo, 'symbolic-ref', 'refs/remotes/job23/HEAD', 'refs/remotes/job23/cached');

  const changed = await handlers.get('change-git-remote')(
    null,
    repo,
    'origin',
    'job23',
    job23Url
  );
  assert.equal(changed.ok, true, changed.errorSummary);
  assert.equal(changed.remote.name, 'job23');
  assert.equal((await git(repo, 'remote', 'get-url', 'job23')).stdout.trim(), job23Url);
  await assert.rejects(git(repo, 'remote', 'get-url', 'origin'));
  assert.equal(
    (await git(repo, 'rev-parse', 'refs/remotes/origin/cached')).stdout.trim(),
    secondCommit
  );
  assert.equal(
    (await git(repo, 'rev-parse', 'refs/remotes/job23/cached')).stdout.trim(),
    firstCommit
  );
  assert.equal(
    (await git(repo, 'symbolic-ref', 'refs/remotes/job23/HEAD')).stdout.trim(),
    'refs/remotes/job23/cached'
  );
  assert.equal(
    (await git(repo, 'config', '--get', 'branch.main.remote')).stdout.trim(),
    'job23'
  );
  assert.equal(
    (await git(repo, 'config', '--get', 'remote.job23.fetch')).stdout.trim(),
    '+refs/heads/*:refs/remotes/job23/*'
  );

  const restored = await handlers.get('change-git-remote')(
    null,
    repo,
    'job23',
    'origin',
    originUrl
  );
  assert.equal(restored.ok, true, restored.errorSummary);
  assert.equal((await git(repo, 'remote', 'get-url', 'origin')).stdout.trim(), originUrl);
  assert.equal(
    (await git(repo, 'rev-parse', 'refs/remotes/origin/cached')).stdout.trim(),
    secondCommit
  );
  assert.equal(
    (await git(repo, 'rev-parse', 'refs/remotes/job23/cached')).stdout.trim(),
    firstCommit
  );
});

test('normal branch configuration drives fetch, comparison, pull, and push', async (t) => {
  const root = await makeTempDir(t, 'git-sync-selected-remote-');
  const origin = path.join(root, 'origin.git');
  const selected = path.join(root, 'selected.git');
  const source = path.join(root, 'source');
  const selectedSource = path.join(root, 'selected-source');
  const target = path.join(root, 'target');

  await fs.mkdir(origin);
  await git(origin, 'init', '--bare');
  await fs.mkdir(source);
  await initRepo(source);
  await commitFile(source, 'shared.txt', 'one\n', 'initial');
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'push', '-u', 'origin', 'main');
  await git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');

  await git(root, 'clone', '--bare', origin, selected);
  await git(root, 'clone', selected, selectedSource);
  await git(selectedSource, 'config', 'user.name', 'Integration Test');
  await git(selectedSource, 'config', 'user.email', 'integration@example.com');
  await commitFile(selectedSource, 'shared.txt', 'two\n', 'selected update');
  await git(selectedSource, 'push', 'origin', 'main');
  await git(selectedSource, 'checkout', '-b', 'other');
  await commitFile(selectedSource, 'other.txt', 'other\n', 'other branch');
  await git(selectedSource, 'push', 'origin', 'other');
  await git(selectedSource, 'checkout', 'main');

  await git(root, 'clone', origin, target);
  await git(target, 'config', 'user.name', 'Integration Test');
  await git(target, 'config', 'user.email', 'integration@example.com');
  await git(target, 'remote', 'add', 'job23', selected);
  await commitFile(source, 'shared.txt', 'origin update\n', 'origin update');
  await git(source, 'push', 'origin', 'main');
  const selectedHead = (await git(selected, 'rev-parse', 'refs/heads/main')).stdout.trim();

  assert.equal((await git(target, 'config', '--get', 'branch.main.remote')).stdout.trim(), 'origin');
  const fetched = await handlers.get('fetch')(progressEvent, target);
  assert.equal(fetched.ok, true, fetched.errorSummary);
  await assert.rejects(git(target, 'rev-parse', '--verify', 'refs/remotes/job23/other'));
  const status = await handlers.get('get-branches')(null, target);
  assert.equal(status.ok, true);
  assert.equal(status.configuredRemote, 'origin');
  assert.equal(status.configuredRemoteUrl, origin);
  assert.equal(status.behind, 1);

  const pulled = await handlers.get('pull')(progressEvent, target);
  assert.equal(pulled.ok, true, pulled.errorSummary);
  assert.equal(await fs.readFile(path.join(target, 'shared.txt'), 'utf8'), 'origin update\n');

  await commitFile(target, 'target.txt', 'target\n', 'target update');
  const pushed = await handlers.get('push')(progressEvent, target);
  assert.equal(pushed.ok, true, pushed.errorSummary);
  const targetHead = (await git(target, 'rev-parse', 'HEAD')).stdout.trim();
  assert.equal((await git(origin, 'rev-parse', 'refs/heads/main')).stdout.trim(), targetHead);
  assert.equal((await git(selected, 'rev-parse', 'refs/heads/main')).stdout.trim(), selectedHead);
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

test('Commit Tool preserves merge topology while rewriting identities and merge metadata', async (t) => {
  const repo = await makeTempDir(t, 'git-sync-merge-rewrite-');
  const globalConfig = path.join(repo, 'test-global.gitconfig');
  const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  t.after(() => {
    if (previousGlobalConfig == null) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
  });
  await fs.writeFile(globalConfig, '[user]\n\tname = Rewritten User\n\temail = rewritten@example.com\n');

  await initRepo(repo);
  await commitFile(repo, 'base.txt', 'base\n', 'base');
  const base = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'branch', 'feature');

  await commitFile(repo, 'main.txt', 'main\n', 'main work');
  const oldMain = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'checkout', 'feature');
  await commitFile(repo, 'feature.txt', 'feature\n', 'feature work');
  const oldFeature = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  await git(repo, 'checkout', 'main');
  await git(repo, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
  await commitFile(repo, 'after.txt', 'after\n', 'after merge');
  const oldHead = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim();
  const oldTree = (await git(repo, 'rev-parse', `${oldHead}^{tree}`)).stdout.trim();

  const batchResult = await handlers.get('commit-tool-rewrite')(null, {
    repoPath: repo,
    commit: oldMain,
    commits: [oldMain, oldFeature],
    authorMode: 'global',
    authorDateMode: 'preserve',
    committerMode: 'preserve',
    reSign: false,
  });

  assert.equal(batchResult.ok, true, batchResult.error);
  assert.equal(batchResult.rewrittenCount, 4);
  assert.equal((await git(repo, 'rev-parse', 'HEAD^{tree}')).stdout.trim(), oldTree);

  const rewrittenMain = (await git(repo, 'log', '--format=%H', '--grep=^main work$')).stdout.trim();
  const rewrittenFeature = (await git(repo, 'log', '--format=%H', '--grep=^feature work$')).stdout.trim();
  const rewrittenMerge = (await git(repo, 'log', '--format=%H', '--grep=^merge feature$')).stdout.trim();
  assert.equal((await git(repo, 'show', '-s', '--format=%an <%ae>', rewrittenMain)).stdout.trim(), 'Rewritten User <rewritten@example.com>');
  assert.equal((await git(repo, 'show', '-s', '--format=%an <%ae>', rewrittenFeature)).stdout.trim(), 'Rewritten User <rewritten@example.com>');
  assert.deepEqual(
    (await git(repo, 'show', '-s', '--format=%P', rewrittenMerge)).stdout.trim().split(' '),
    [rewrittenMain, rewrittenFeature]
  );
  assert.equal((await git(repo, 'show', '-s', '--format=%P', rewrittenMain)).stdout.trim(), base);
  assert.equal((await git(repo, 'show', '-s', '--format=%P', rewrittenFeature)).stdout.trim(), base);

  const mergeResult = await handlers.get('commit-tool-rewrite')(null, {
    repoPath: repo,
    commit: rewrittenMerge,
    message: 'renamed merge',
    authorMode: 'preserve',
    authorDateMode: 'preserve',
    committerMode: 'preserve',
    reSign: false,
  });

  assert.equal(mergeResult.ok, true, mergeResult.error);
  assert.equal(mergeResult.rewrittenCount, 2);
  const renamedMerge = (await git(repo, 'log', '--format=%H', '--grep=^renamed merge$')).stdout.trim();
  assert.deepEqual(
    (await git(repo, 'show', '-s', '--format=%P', renamedMerge)).stdout.trim().split(' '),
    [rewrittenMain, rewrittenFeature]
  );
  assert.equal((await git(repo, 'branch', '--list', 'pcs-backup-*')).stdout.trim(), '');
  assert.equal((await git(repo, 'status', '--porcelain')).stdout.trim(), '');
});
