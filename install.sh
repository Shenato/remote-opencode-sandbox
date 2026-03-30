#!/usr/bin/env bash
# remote-opencode-sandbox installer
#
# Installs:
#   1. Bun (if not present)
#   2. OpenCode (if not present)
#   3. remote-opencode (if not present)
#   4. remote-opencode-sandbox CLI
#
# Prerequisites:
#   - Docker must be installed separately
#   - Node.js 18+ (for npm global installs)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }
info() { echo -e "${DIM}  $1${NC}"; }

echo -e "\n${BOLD}remote-opencode-sandbox installer${NC}\n"

# ── Check prerequisites ────────────────────────────────────────────

# Docker
if command -v docker &>/dev/null; then
  log "Docker found: $(docker --version | head -1)"
else
  err "Docker is not installed."
  echo -e "  Install Docker for your platform: ${CYAN}https://docs.docker.com/get-docker/${NC}"
  exit 1
fi

# Node.js
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  log "Node.js found: $NODE_VERSION"
else
  warn "Node.js not found. Installing via Bun..."
fi

# ── Install Bun ────────────────────────────────────────────────────

if command -v bun &>/dev/null; then
  log "Bun found: $(bun --version)"
else
  echo -e "\n${BOLD}Installing Bun...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"

  if command -v bun &>/dev/null; then
    log "Bun installed: $(bun --version)"
  else
    err "Bun installation failed."
    exit 1
  fi
fi

# ── Install OpenCode ───────────────────────────────────────────────

if command -v opencode &>/dev/null; then
  log "OpenCode found: $(opencode --version 2>/dev/null || echo 'installed')"
else
  echo -e "\n${BOLD}Installing OpenCode...${NC}"
  curl -fsSL https://opencode.ai/install | bash

  # Move to a location on PATH if needed
  if [ -f "$HOME/.opencode/bin/opencode" ] && ! command -v opencode &>/dev/null; then
    sudo mv "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode 2>/dev/null || {
      export PATH="$HOME/.opencode/bin:$PATH"
    }
  fi

  if command -v opencode &>/dev/null; then
    log "OpenCode installed"
  else
    warn "OpenCode installed but may not be on PATH. Add ~/.opencode/bin to your PATH."
  fi
fi

# ── Install remote-opencode ────────────────────────────────────────

if command -v remote-opencode &>/dev/null; then
  log "remote-opencode found"
else
  echo -e "\n${BOLD}Installing remote-opencode...${NC}"
  npm install -g remote-opencode 2>/dev/null || bun install -g remote-opencode

  if command -v remote-opencode &>/dev/null; then
    log "remote-opencode installed"
  else
    warn "remote-opencode installed but may not be on PATH."
  fi
fi

# ── Install remote-opencode-sandbox ────────────────────────────────

echo -e "\n${BOLD}Installing remote-opencode-sandbox...${NC}"

# Clone or update the repo
INSTALL_DIR="$HOME/.remote-opencode-sandbox"

if [ -d "$INSTALL_DIR" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  info "Cloning repository..."
  git clone https://github.com/Shenato/remote-opencode-sandbox.git "$INSTALL_DIR" 2>/dev/null || {
    # If repo doesn't exist yet, just mkdir and we'll handle it
    err "Repository not available yet. Please install manually:"
    echo -e "  ${CYAN}cd ~/repos/remote-opencode-sandbox && bun install && bun link${NC}"
    exit 1
  }
fi

cd "$INSTALL_DIR"
bun install
bun link 2>/dev/null || {
  # Create a symlink manually
  mkdir -p "$HOME/.bun/bin"
  ln -sf "$INSTALL_DIR/bin/sandbox.ts" "$HOME/.bun/bin/sandbox"
}

if command -v sandbox &>/dev/null; then
  log "remote-opencode-sandbox installed"
else
  # Add to PATH hint
  warn "sandbox CLI installed but not on PATH."
  echo -e "  Add to your shell config: ${CYAN}export PATH=\"\$HOME/.bun/bin:\$PATH\"${NC}"
fi

# ── Done ───────────────────────────────────────────────────────────

echo -e "\n${GREEN}${BOLD}Installation complete!${NC}\n"
echo -e "Next steps:"
echo -e "  ${CYAN}sandbox init${NC}              — First-time setup"
echo -e "  ${CYAN}sandbox add <project>${NC}     — Add a project"
echo -e "  ${CYAN}sandbox up${NC}                — Start the sandbox"
echo -e ""
echo -e "For help: ${CYAN}sandbox --help${NC}"
echo ""
