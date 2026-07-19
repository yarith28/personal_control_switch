#!/bin/bash
cd "$(dirname "$0")"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Run: corepack enable"
  read -r -p "Press Return to close..."
  exit 1
fi
pnpm start
