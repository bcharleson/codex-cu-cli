#!/usr/bin/env bash
# Install a symlink to this checkout. No npm or MCP configuration required.
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${CODEX_CU_BIN_DIR:-$HOME/.local/bin}"
UNINSTALL=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin-dir)
      if [[ $# -lt 2 || -z "$2" || "$2" = --* ]]; then echo '--bin-dir requires a directory' >&2; exit 2; fi
      BIN_DIR="$2"; shift ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h) echo 'usage: ./install.sh [--bin-dir directory] [--dry-run] [--uninstall]'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
DEST="$BIN_DIR/codex-cu"
if [[ -e "$DEST" || -L "$DEST" ]]; then
  if [[ ! -L "$DEST" || "$(readlink "$DEST")" != "$ROOT/bin/codex-cu" ]]; then
    echo "Refusing to replace an existing command: $DEST. Choose --bin-dir or remove it yourself." >&2
    exit 1
  fi
fi
if [[ $DRY_RUN -eq 1 ]]; then
  if [[ $UNINSTALL -eq 1 ]]; then echo "Would remove $DEST (only if owned by this checkout)";
  else echo "Would link $DEST -> $ROOT/bin/codex-cu"; fi
  exit 0
fi
if [[ $UNINSTALL -eq 1 ]]; then
  [[ ! -L "$DEST" ]] || rm "$DEST"
  echo "Removed checkout link: $DEST"
else
  # Check the launcher before writing anything. Full helper checks are explicit.
  "$ROOT/bin/codex-cu" --version >/dev/null
  mkdir -p "$BIN_DIR"
  [[ -L "$DEST" ]] || ln -s "$ROOT/bin/codex-cu" "$DEST"
  echo "Installed $DEST"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Add this directory to PATH in your shell profile: $BIN_DIR" ;;
  esac
  echo "Next: codex-cu doctor && codex-cu demo"
  echo "Keep this checkout in place; the command links to it."
fi
