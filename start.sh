#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "  ========================================"
echo "   Hey Claude - talk to your code"
echo "  ========================================"
echo ""

# --- Node.js ---
if ! command -v node &>/dev/null; then
  echo "  [setup] Node.js not found. Trying to install it..."
  if command -v brew &>/dev/null; then brew install node || true
  elif command -v apt-get &>/dev/null; then sudo apt-get install -y nodejs npm || true
  fi
  if ! command -v node &>/dev/null; then
    echo "  [!] Could not auto-install Node.js. Install it once from https://nodejs.org and rerun."; exit 1
  fi
fi

# --- Claude Code CLI ---
if ! command -v claude &>/dev/null; then
  echo "  [setup] Claude Code CLI not found. Installing..."
  npm install -g @anthropic-ai/claude-code || true
  if ! command -v claude &>/dev/null; then
    echo "  [!] Install it manually: npm install -g @anthropic-ai/claude-code"; exit 1
  fi
fi

echo ""
echo "  Already use Claude Code in VS Code? You're logged in — the CLI shares that session (no re-login)."
echo ""

PORT="${VOICE_PORT:-8765}"
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 0.4

# workspace = parent folder (drop the hey-claude/ folder in your project root)
export VOICE_WORKSPACE="${VOICE_WORKSPACE:-$(cd .. && pwd)}"
echo "  Workspace: $VOICE_WORKSPACE"
echo "  Open Chrome or Edge at  http://localhost:$PORT   (Ctrl+C to stop)"
echo ""
exec node server.js
