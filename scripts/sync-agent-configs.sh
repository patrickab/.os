#!/usr/bin/env bash
# Sync ~/.agents canonical config to cursor, codex, opencode, and claude.
#
# Source of truth: chezmoi/dot_agents/  (deploys to ~/.agents/)
#   AGENTS.md     -> agentsync -> CLAUDE.md, .cursor/rules/, etc.
#   skills/       -> agent-auto skills on all tools (incl. opencode skills/)
#   commands/     -> user-only: opencode command/*.md; others get flagged skills
#
# OpenCode-only: chezmoi/dot_config/opencode/opencode.jsonc (JSON slash commands)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$DOTFILES_DIR/chezmoi/dot_agents"
OPENCODE_CONFIG="$DOTFILES_DIR/chezmoi/dot_config/opencode/opencode.jsonc"
AGENTSYNC_DIR="$DOTFILES_DIR/.agentsync"
RULES_FILE="$AGENTSYNC_DIR/rules.md"

DRY_RUN=0
STATUS_ONLY=0

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Sync .agents skills, commands, and AGENTS.md to cursor, codex, opencode, and claude.

Source: chezmoi/dot_agents/
Edit there, then run this script (or setup-lite.sh).

Options:
  --dry-run   Preview changes without writing files
  --status    Show sync status and exit
  -h, --help  Show this help

Requires: rulesync (uv tool install rulesync)
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --status)  STATUS_ONLY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) err "Unknown option: $1"; usage; exit 1 ;;
    esac
done

ensure_rulesync() {
    if command -v rulesync &>/dev/null; then
        return 0
    fi
    if command -v uv &>/dev/null; then
        info "Installing rulesync via uv..."
        uv tool install rulesync
        return 0
    fi
    err "rulesync not found. Install with: uv tool install rulesync"
    exit 1
}

agentsync_python() {
    local uv_py="$HOME/.local/share/uv/tools/rulesync/bin/python3"
    if [[ -x "$uv_py" ]]; then
        echo "$uv_py"
        return 0
    fi
    if python3 -c "import agentsync" 2>/dev/null; then
        echo "python3"
        return 0
    fi
    err "agentsync Python module not found. Run: uv tool install rulesync"
    exit 1
}

require_source() {
    if [[ ! -d "$SOURCE_DIR" ]]; then
        err "Canonical .agents dir not found: $SOURCE_DIR"
        exit 1
    fi
    if [[ ! -f "$SOURCE_DIR/AGENTS.md" ]]; then
        err "Missing canonical AGENTS.md at $SOURCE_DIR/AGENTS.md"
        exit 1
    fi
}

# Sync directory contents: copy src/* into dest/, remove dest entries absent from src.
sync_dir() {
    local src="$1" dest="$2"
    local base item

    if [[ $DRY_RUN -eq 1 ]]; then
        info "[dry-run] would sync $src -> $dest"
        return 0
    fi

    mkdir -p "$dest"

    shopt -s dotglob nullglob
    for item in "$dest"/*; do
        [[ -e "$item" ]] || continue
        base="$(basename "$item")"
        if [[ ! -e "$src/$base" ]]; then
            rm -rf "$item"
        fi
    done

    for item in "$src"/*; do
        [[ -e "$item" ]] || continue
        base="$(basename "$item")"
        if [[ -d "$item" ]]; then
            rm -rf "$dest/$base"
            cp -a "$item" "$dest/$base"
        else
            cp -a "$item" "$dest/$base"
        fi
    done
    shopt -u dotglob nullglob
}

copy_file() {
    local src="$1" dest="$2"
    if [[ $DRY_RUN -eq 1 ]]; then
        info "[dry-run] would copy $src -> $dest"
        return 0
    fi
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
}

strip_frontmatter() {
    local file="$1"
    awk 'BEGIN{fm=0; done=0}
         /^---$/ && !done { fm++; if (fm==2) {done=1; next} next }
         done || fm==0 { print }' "$file"
}

frontmatter_field() {
    local file="$1" field="$2"
    awk -v want="$field" '
        /^---$/ { n++; next }
        n == 1 && $0 ~ "^" want ":" {
            sub("^" want ":[[:space:]]*", "")
            print
            exit
        }
    ' "$file"
}

# Resolve commands/*/SKILL.md (or legacy *.md) for a command name directory.
command_source_file() {
    local dir="$1"
    if [[ -f "$dir/SKILL.md" ]]; then
        echo "$dir/SKILL.md"
    elif [[ -f "$dir/COMMAND.md" ]]; then
        echo "$dir/COMMAND.md"
    fi
}

# OpenCode command/*.md — description frontmatter only (no skill index pollution).
command_to_opencode() {
    local src="$1" dest="$2" name="$3"
    local desc body
    desc="$(frontmatter_field "$src" description)"
    body="$(strip_frontmatter "$src")"
    [[ -n "$desc" ]] || desc="$name"

    local content
    content=$(cat <<EOF
---
description: $desc
---

$body
EOF
)
    if [[ $DRY_RUN -eq 1 ]]; then
        info "[dry-run] would write opencode command $dest"
        return 0
    fi
    mkdir -p "$(dirname "$dest")"
    printf '%s' "$content" > "$dest"
}

# Cursor / Codex / Claude slash command as flagged skill.
command_to_skill() {
    local src="$1" skill_dir="$2" name="$3"
    local desc body
    desc="$(frontmatter_field "$src" description)"
    body="$(strip_frontmatter "$src")"
    [[ -n "$desc" ]] || desc="$name"

    local content
    content=$(cat <<EOF
---
name: $name
description: $desc
disable-model-invocation: true
user-invocable: true
---

$body
EOF
)
    if [[ $DRY_RUN -eq 1 ]]; then
        info "[dry-run] would write skill command $skill_dir/SKILL.md"
        return 0
    fi
    mkdir -p "$skill_dir"
    printf '%s' "$content" > "$skill_dir/SKILL.md"
}

# Claude command/*.md — same shape as opencode (description + body).
command_to_claude() {
    local src="$1" dest="$2" name="$3"
    command_to_opencode "$src" "$dest" "$name"
}

sync_agents_home() {
    info "Deploying source to ~/.agents ..."
    local home_agents="$HOME/.agents"
    copy_file "$SOURCE_DIR/AGENTS.md" "$home_agents/AGENTS.md"
    if [[ -d "$SOURCE_DIR/skills" ]]; then
        sync_dir "$SOURCE_DIR/skills/" "$home_agents/skills/"
    fi
    ok "~/.agents"
}

sync_opencode() {
    info "Mapping .agents -> opencode (~/.config/opencode)..."
    local global="$HOME/.config/opencode"
    mkdir -p "$global"

    if [[ -d "$SOURCE_DIR/skills" ]]; then
        sync_dir "$SOURCE_DIR/skills/" "$global/skills/"
    else
        rm -rf "$global/skills" 2>/dev/null || true
    fi

    local cmd_src="$SOURCE_DIR/commands"
    local cmd_dest="$global/command"
    if [[ -d "$cmd_src" ]]; then
        mkdir -p "$cmd_dest"
        if [[ $DRY_RUN -eq 0 ]]; then
            shopt -s nullglob
            for existing in "$cmd_dest"/*.md; do
                rm -f "$existing"
            done
            shopt -u nullglob
        fi
        for cmd_dir in "$cmd_src"/*; do
            [[ -d "$cmd_dir" ]] || continue
            local name src
            name="$(basename "$cmd_dir")"
            src="$(command_source_file "$cmd_dir")"
            [[ -n "$src" ]] || continue
            command_to_opencode "$src" "$cmd_dest/${name}.md" "$name"
            ok "command -> opencode command/${name}.md"
        done
    else
        rm -rf "$cmd_dest" 2>/dev/null || true
    fi

    if [[ -f "$OPENCODE_CONFIG" ]]; then
        copy_file "$OPENCODE_CONFIG" "$global/opencode.jsonc"
    fi

    copy_file "$SOURCE_DIR/AGENTS.md" "$global/AGENTS.md"
    ok "opencode (~/.config/opencode)"
}

sync_skills() {
    local src="$SOURCE_DIR/skills"
    [[ -d "$src" ]] || { warn "No skills at $src"; return 0; }

    info "Syncing agent-auto skills to cursor, codex, claude..."
    local -a targets=(
        "$HOME/.cursor/skills"
        "$HOME/.codex/skills"
        "$HOME/.claude/skills"
    )
    for dest in "${targets[@]}"; do
        sync_dir "$src/" "$dest/"
        ok "skills -> $dest"
    done
}

sync_commands() {
    local cmd_src="$SOURCE_DIR/commands"
    [[ -d "$cmd_src" ]] || { warn "No commands at $cmd_src"; return 0; }

    info "Syncing user commands to cursor, codex, claude..."
    mkdir -p "$HOME/.claude/commands"

    for cmd_dir in "$cmd_src"/*; do
        [[ -d "$cmd_dir" ]] || continue
        local name src
        name="$(basename "$cmd_dir")"
        src="$(command_source_file "$cmd_dir")"
        [[ -n "$src" ]] || continue

        command_to_claude "$src" "$HOME/.claude/commands/${name}.md" "$name"
        ok "command -> ~/.claude/commands/${name}.md"

        command_to_skill "$src" "$HOME/.cursor/skills/${name}" "$name"
        ok "command -> ~/.cursor/skills/${name}/SKILL.md"

        command_to_skill "$src" "$HOME/.codex/skills/${name}" "$name"
        ok "command -> ~/.codex/skills/${name}/SKILL.md"
    done
}

sync_rules() {
    info "Syncing AGENTS.md via agentsync..."

    mkdir -p "$AGENTSYNC_DIR"
    if [[ $DRY_RUN -eq 0 ]]; then
        cp "$SOURCE_DIR/AGENTS.md" "$RULES_FILE"
    fi

    local py
    py="$(agentsync_python)"

    SOURCE_AGENTS="$SOURCE_DIR/AGENTS.md" RULES_FILE="$RULES_FILE" DRY_RUN="$DRY_RUN" "$py" <<'PY'
import os
import sys
from pathlib import Path

dry_run = os.environ.get("DRY_RUN") == "1"
rules_path = Path(os.environ["RULES_FILE"])
source_path = Path(os.environ["SOURCE_AGENTS"])
content = (rules_path if rules_path.exists() else source_path).read_text(encoding="utf-8")

try:
    from agentsync.tools import get_tool
except ImportError:
    print("ERROR: agentsync not found. Install: uv tool install rulesync", file=sys.stderr)
    sys.exit(1)

home = Path.home()
targets = [
    ("agents_md", home / ".agents/AGENTS.md"),
    ("agents_md", home / ".config/opencode/AGENTS.md"),
    ("agents_md", home / ".codex/AGENTS.md"),
    ("claude_md", home / ".claude/CLAUDE.md"),
    ("cursor_mdc", home / ".cursor/rules/global-agents.mdc"),
]

for tool_id, dest in targets:
    tool = get_tool(tool_id)
    generated = tool.generate(content)
    if dry_run:
        action = "exists" if dest.exists() and dest.read_text(encoding="utf-8") == generated else "would update"
        print(f"[dry-run] {action}: {dest}")
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(generated, encoding="utf-8")
        print(f"OK: {dest}")
PY
}

show_status() {
    require_source
    ensure_rulesync

    echo -e "${CYAN}Agent config sync status${NC}"
    echo "Source: $SOURCE_DIR"
    echo ""

    local -a checks=(
        "$HOME/.agents/AGENTS.md"
        "$HOME/.config/opencode/AGENTS.md"
        "$HOME/.codex/AGENTS.md"
        "$HOME/.claude/CLAUDE.md"
        "$HOME/.cursor/rules/global-agents.mdc"
        "$HOME/.agents/skills"
        "$HOME/.config/opencode/skills"
        "$HOME/.config/opencode/command"
        "$HOME/.cursor/skills"
        "$HOME/.codex/skills"
        "$HOME/.claude/skills"
        "$HOME/.claude/commands"
    )

    for path in "${checks[@]}"; do
        if [[ -e "$path" ]]; then
            if [[ -d "$path" ]]; then
                local count
                count=$(find "$path" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
                echo -e "  ${GREEN}ok${NC}  $path ($count entries)"
            elif cmp -s "$path" "$SOURCE_DIR/AGENTS.md" 2>/dev/null; then
                echo -e "  ${GREEN}ok${NC}  $path (matches source)"
            elif [[ "$path" == *"CLAUDE.md" ]] || [[ "$path" == *"global-agents.mdc" ]]; then
                echo -e "  ${YELLOW}??${NC}  $path (agentsync-generated)"
            else
                echo -e "  ${YELLOW}stale${NC}  $path"
            fi
        else
            echo -e "  ${RED}missing${NC}  $path"
        fi
    done
}

main() {
    require_source

    if [[ $STATUS_ONLY -eq 1 ]]; then
        show_status
        exit 0
    fi

    ensure_rulesync

    echo -e "${CYAN}====================================================${NC}"
    echo -e "${CYAN}  Agent Config Sync (.agents -> all tools)${NC}"
    echo -e "${CYAN}====================================================${NC}"
    echo ""

    sync_agents_home
    sync_opencode
    sync_skills
    sync_commands
    sync_rules

    echo ""
    ok "Agent config sync complete."
    if [[ $DRY_RUN -eq 0 ]]; then
        echo "Edit: $SOURCE_DIR"
        echo "Restart agent sessions to pick up changes."
    fi
}

main "$@"
