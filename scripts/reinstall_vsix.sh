#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Working directory: $ROOT_DIR"

echo "Installing dependencies..."
npm install

echo "Compiling extension (if applicable)..."
# compile step may be present in package.json
if npm run | grep -q " compile"; then
  npm run compile || true
fi

echo "Packaging VSIX (using vsce)..."
if ! command -v vsce >/dev/null 2>&1; then
  echo "vsce not found globally; using npx vsce package"
  npx vsce package
else
  vsce package
fi

VSIX_FILE=$(ls -1t ./*.vsix 2>/dev/null | head -n1 || true)
if [ -z "$VSIX_FILE" ]; then
  echo "ERROR: No .vsix file found in $ROOT_DIR"
  exit 1
fi

echo "Found VSIX: $VSIX_FILE"
EXTENSION_ID="ericktarzia.drift-studio"

echo "Uninstalling old extension (if installed): $EXTENSION_ID"
code --uninstall-extension "$EXTENSION_ID" || true

echo "Installing new VSIX: $VSIX_FILE"
code --install-extension "$VSIX_FILE"

echo "Done. Reload VS Code window if needed."
