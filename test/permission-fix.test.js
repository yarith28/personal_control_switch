const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  buildPermissionCommand,
  fixSharedPermissions,
  resolveRepositoryRoot,
  shellQuote,
} = require('../src/main/permission-fix');

const execFileP = promisify(execFile);

async function makeTempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('permission command safely quotes paths and grants inherited directory access', () => {
  const repoPath = "/Users/Shared/Projects/team's repo";
  const command = buildPermissionCommand(repoPath, 'staff');

  assert.match(command, /\/usr\/bin\/find/);
  assert.match(command, /delete_child/);
  assert.match(command, /file_inherit,directory_inherit/);
  assert.ok(command.includes(shellQuote(repoPath)));
  assert.ok(!command.includes(`find ${repoPath} `));
});

test('generated permission command parses with an apostrophe in the repository path', {
  skip: process.platform === 'win32',
}, async () => {
  const command = buildPermissionCommand("/Users/Shared/Projects/team's repo", 'staff');
  await execFileP('/bin/sh', ['-n', '-c', command], { encoding: 'utf8' });
});

test('repository validation only accepts a repository root', async (t) => {
  const root = await makeTempDir(t, 'git-sync-permissions-');
  const repo = path.join(root, 'repo');
  const nested = path.join(repo, 'nested');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  await fs.mkdir(nested);

  assert.equal(await resolveRepositoryRoot(repo), await fs.realpath(repo));
  await assert.rejects(resolveRepositoryRoot(nested), /not a Git repository root/i);
  await assert.rejects(resolveRepositoryRoot(os.homedir()), /home folder/i);
});

test('repository validation reports permission denial instead of a missing folder', async () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const fsApi = {
    async realpath() { throw denied; },
  };
  await assert.rejects(
    resolveRepositoryRoot('/shared/repo', { fsApi, homePath: '/Users/tester' }),
    /permission/i
  );
});

test('macOS permission repair requests elevation and trusts the repository', async (t) => {
  const root = await makeTempDir(t, 'git-sync-permissions-run-');
  const repo = path.join(root, "team's repo");
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });

  const calls = [];
  const exec = async (file, args) => {
    calls.push({ file, args });
    if (file === '/usr/bin/id') return { stdout: 'staff\n', stderr: '' };
    if (file === '/usr/bin/osascript') return { stdout: '', stderr: '' };
    if (file === '/usr/bin/git' && args.includes('--get-all')) {
      const error = new Error('key not found');
      error.code = 1;
      throw error;
    }
    if (file === '/usr/bin/git' && args.includes('--add')) return { stdout: '', stderr: '' };
    throw new Error(`Unexpected command: ${file} ${args.join(' ')}`);
  };

  const result = await fixSharedPermissions(repo, {
    platform: 'darwin',
    exec,
    homePath: path.join(root, 'home'),
  });

  assert.equal(result.ok, true, result.errorSummary);
  assert.equal(result.groupName, 'staff');
  const elevation = calls.find((call) => call.file === '/usr/bin/osascript');
  assert.ok(elevation);
  assert.match(elevation.args[1], /administrator privileges/);
  assert.match(elevation.args[1], /delete_child/);
  const trust = calls.find((call) => call.file === '/usr/bin/git' && call.args.includes('--add'));
  assert.deepEqual(trust.args.slice(-2), ['safe.directory', await fs.realpath(repo)]);
});

test('permission repair reports unsupported platforms without running commands', async () => {
  let called = false;
  const result = await fixSharedPermissions('/tmp/repo', {
    platform: 'win32',
    exec: async () => {
      called = true;
      return { stdout: '', stderr: '' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'UNSUPPORTED_PLATFORM');
  assert.equal(called, false);
});
