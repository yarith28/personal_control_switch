# Git Sync

A simple desktop app to manage git pull/push across multiple repositories.

## Requirements

- [Node.js](https://nodejs.org) (v18 or later)
- [Git](https://git-scm.com) installed and available in your PATH

## Setup

Install dependencies (only needed once):

```bash
npm install
```

## Run

```bash
npm start
```

Or double-click to launch without a terminal:

- **Windows** — double-click `start.bat`
- **Mac** — run `chmod +x start.command` once in the terminal, then double-click `start.command` in Finder

## Build a standalone installer

Packages the app into a proper installer — no Node.js or terminal required to run it.

**Windows** (run on a Windows machine):
```bash
npm run build:win
```
Produces a one-click installer at `dist/Git Sync Setup *.exe`.

**Mac** (run on a Mac):
```bash
npm run build:mac
```
Produces a `.dmg` at `dist/Git Sync-*.dmg`.

> Note: Mac apps must be built on macOS; Windows installers must be built on Windows.

## Usage

1. Click **Add project** and pick one or more git repository folders
2. Use the branch dropdown to switch branches
3. Click **Pull** or **Push** per project, or check multiple projects and use **Pull selected** / **Push selected**
4. The **Log** panel at the bottom shows output — click it to collapse/expand
