# Git Sync

Git Sync is a desktop dashboard for working with multiple Git repositories. It keeps routine fetch, pull, push, branch, and commit actions in one place while leaving each repository as a normal Git working tree.

## Features

- Track repositories individually or organize them into folders
- Search by repository name, path, or branch
- Fetch a repository, folder, selection, or the full list; pull or push a repository or selection
- Route a project through an app-managed remote URL without changing its Git configuration
- Run batch operations sequentially or in parallel with Burst mode
- Cancel an active fetch, pull, or push; stalled Git commands time out automatically
- Switch local branches and open a repository in a terminal, file manager, VS Code, SourceTree, or another supported tool
- Create or amend quick commits
- Compare and coordinate branches between independent local repositories with Cross Sync
- Inspect commit history and safely rewrite supported commit metadata with Commit Tool
- Manage global Git identity and per-project identity overrides with Identity Tool
- Repair shared-repository directory permissions from a project row on macOS
- Choose themes, fonts, and compact layout
- Load the app configuration from a chosen JSON file or return to the default location

## Requirements

- Node.js 22.12 or later
- pnpm 11.9.0 (the version declared in `package.json`)
- Git available in `PATH`

If `pnpm` is unavailable on a new machine, install the version pinned by this
project:

```bash
npm install --global pnpm@11.9.0
pnpm --version
```

## Setup

Install the locked dependencies:

```bash
pnpm install --frozen-lockfile
```

Use pnpm for this repository; Electron Builder reads the `packageManager` field
and invokes pnpm while collecting packaged dependencies.

The project post-install step downloads the Electron runtime automatically. No separate Electron command is required.

Set `GIT_SYNC_CONFIG_PATH` to override the configuration location for a launch. Use an absolute path or a path beginning with `~/`:

```bash
GIT_SYNC_CONFIG_PATH=~/shared/git_sync_config.json pnpm start
```

The environment override takes priority without replacing the location saved in Settings. Removing it restores the previous location.

## Run

```bash
pnpm start
```

`pnpm run dev` starts the same development server. On macOS or Windows, `start.command` and `start.bat` provide double-click launchers after setup.

## Test and verify

```bash
pnpm test
pnpm run check
```

`check` runs the automated tests and builds the production Electron bundle.

## Build an installer

Build on the operating system you are targeting:

```bash
# macOS — produces a DMG in dist/
pnpm run build:mac

# Windows — produces portable and unpacked builds in dist/
pnpm run build:win
```

The included packaging configuration does not sign installers. Public distribution should add the appropriate Apple or Windows signing identity.

## Safety and recovery

- Repository-default pull and push use Git's existing behavior and configuration. If a push has no upstream, the app can set one after confirmation using the configured push remote, `origin`, or the repository's only remote.
- App-managed remotes are stored by Git Sync, not in `.git/config`. Their selected URL is used directly for fetch and push; pull fetches that URL and only fast-forwards the matching local branch.
- Git credential prompts are disabled inside the app so an operation cannot wait on an invisible terminal prompt. Configure credentials with your normal Git tooling.
- Fetch, pull, and push can be cancelled from the repository row. Network operations time out after five minutes; other Git commands time out after two minutes.
- Quick Commit bypasses repository Git hooks for both new commits and amendments.
- Commit Tool only rewrites clean, linear local history. It creates a temporary backup branch, updates the branch with compare-and-swap semantics, verifies the result, and attempts an automatic rollback if verification fails.
- Cross Sync refuses dirty target working trees and aborts a conflicted rebase.
- The macOS permission repair asks for administrator approval, grants the current primary group inherited directory access within the selected repository, and marks that repository as trusted in the current user's global Git configuration. It does not install dependencies or alter commits.
- Configuration saves are atomic. Before replacing a valid configuration, the app keeps a last known-good backup. An unreadable configuration is preserved and recovery is reported in the app.
- The default configuration is `~/git_sync_config.json`. A custom location is remembered by a small pointer file in the app data directory. Switching locations does not delete or move either configuration file.

## Basic usage

1. Select **Add project** and choose one or more Git repository folders.
2. Use the branch badge to switch branches.
3. Use the repository actions to fetch, pull, push, create a quick commit, or repair shared permissions on macOS.
4. Use search to focus a large repository list.
5. Open the activity log for Git output and error details.
6. Open the in-app quick tour for toolbar and repository-action help.
7. Use **Identity Tool** to update the global Git name/email or set an override for a project from Git Sync.
