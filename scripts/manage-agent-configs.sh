#!/usr/bin/env bash
# Interactive TUI for managing agent configs.
# Canonical source: chezmoi/dot_agents/ — edit here, then sync to all tools.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
NC='\033[0m'

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$DOTFILES_DIR/chezmoi/dot_agents"
SYNC_SCRIPT="$DOTFILES_DIR/scripts/sync-agent-configs.sh"

EDIT_CMD="${EDITOR:-}"
if [[ -z "$EDIT_CMD" ]]; then
    for candidate in nvim vim nano vi; do
        if command -v "$candidate" &>/dev/null; then
            EDIT_CMD="$candidate"
            break
        fi
    done
fi

header() {
    clear
    echo -e "${MAGENTA}════════════════════════════════════════${NC}"
    echo -e "${CYAN}         AGENT CONFIG MANAGER          ${NC}"
    echo -e "${MAGENTA}════════════════════════════════════════${NC}"
    echo -e " Editor: ${GREEN}$EDIT_CMD${NC}  Source: ${DIM}$SOURCE_DIR${NC}"
    echo ""
}

pause() {
    echo -e "\nPress any key..."
    read -n 1 -s -r
}

collect_skills() {
    local dir="$SOURCE_DIR/skills"
    [[ -d "$dir" ]] || return
    for d in "$dir"/*/; do
        [[ -d "$d" ]] || continue
        local name
        name="$(basename "$d")"
        [[ -f "$d/SKILL.md" ]] && printf 'skill\t%s\t%s\n' "$name" "$d/SKILL.md"
    done
}

collect_commands() {
    local dir="$SOURCE_DIR/commands"
    [[ -d "$dir" ]] || return
    for d in "$dir"/*/; do
        [[ -d "$d" ]] || continue
        local name
        name="$(basename "$d")"
        [[ -f "$d/SKILL.md" ]] && printf 'cmd\t%s\t%s\n' "$name" "$d/SKILL.md"
    done
}

collect_all() {
    [[ -f "$SOURCE_DIR/AGENTS.md" ]] && printf 'rules\tAGENTS.md\t%s\n' "$SOURCE_DIR/AGENTS.md"
    collect_skills
    collect_commands
}

pick() {
    local title="$1"
    shift
    local -a items=("$@")
    if [[ ${#items[@]} -eq 0 ]]; then
        echo -e "  ${YELLOW}None found.${NC}" >&2
        return 1
    fi

    if command -v fzf &>/dev/null; then
        printf '%s\n' "${items[@]}" \
            | fzf --prompt="$title> " --height=~40% --reverse \
                  --delimiter=$'\t' --with-nth=1,2 \
            || return 1
    else
        echo -e "${CYAN}$title:${NC}" >&2
        local i
        for i in "${!items[@]}"; do
            local kind name
            kind="$(echo "${items[$i]}" | cut -f1)"
            name="$(echo "${items[$i]}" | cut -f2)"
            printf '  %d) %-6s %s\n' "$((i+1))" "$kind" "$name" >&2
        done
        echo "" >&2
        local idx
        read -p "Select (1-${#items[@]}): " idx
        if [[ "$idx" =~ ^[0-9]+$ ]] && (( idx >= 1 && idx <= ${#items[@]} )); then
            echo "${items[$((idx-1))]}"
        else
            return 1
        fi
    fi
}

path_from_pick() {
    echo "$1" | cut -f3
}

pick_and_edit() {
    local title="$1"
    shift
    local -a items=("$@")
    local selected
    selected="$(pick "$title" "${items[@]}")" || return
    local path
    path="$(path_from_pick "$selected")"
    [[ -n "$path" ]] && $EDIT_CMD "$path"
}

create_new() {
    header
    echo -e "${CYAN}Create new:${NC}"
    echo -e "  1) Skill"
    echo -e "  2) Command"
    echo ""
    read -p "Choice: " kind_idx
    local subdir
    case "$kind_idx" in
        1) subdir="skills" ;;
        2) subdir="commands" ;;
        *) return ;;
    esac
    read -p "Name (kebab-case): " name
    [[ -n "$name" ]] || return
    local filepath="$SOURCE_DIR/$subdir/$name/SKILL.md"
    mkdir -p "$(dirname "$filepath")"
    cat > "$filepath" <<EOF
---
name: $name
description:
---

EOF
    $EDIT_CMD "$filepath"
    echo -e "${GREEN}Created:${NC} $filepath"
}

delete_item() {
    header
    local -a items
    mapfile -t items < <(collect_skills; collect_commands)
    if [[ ${#items[@]} -eq 0 ]]; then
        echo -e "  ${YELLOW}Nothing to delete.${NC}"
        pause
        return
    fi
    local selected
    selected="$(pick "Delete" "${items[@]}")" || return
    local path name dir
    path="$(path_from_pick "$selected")"
    dir="$(dirname "$path")"
    name="$(basename "$dir")"
    echo ""
    echo -e "${YELLOW}Will delete:${NC} $dir"
    read -p "Are you sure? (y/N): " confirm
    if [[ "$confirm" =~ ^[yY]$ ]]; then
        rm -rf "$dir"
        echo -e "${GREEN}Deleted:${NC} $name"
    fi
    pause
}

run_sync() {
    header
    if [[ -x "$SYNC_SCRIPT" ]]; then
        "$SYNC_SCRIPT"
        echo ""
        echo -e "${GREEN}Sync complete.${NC}"
    else
        echo -e "${RED}Sync script not found:${NC} $SYNC_SCRIPT"
    fi
    pause
}

show_status() {
    header
    if [[ -x "$SYNC_SCRIPT" ]]; then
        "$SYNC_SCRIPT" --status
    else
        echo -e "${RED}Sync script not found.${NC}"
    fi
    pause
}

while true; do
    header
    echo -e "  ${CYAN}1${NC})  Browse all              ${DIM}fzf picker${NC}"
    echo -e "  ${CYAN}2${NC})  Edit AGENTS.md           ${DIM}rules source${NC}"
    echo -e "  ${CYAN}3${NC})  Edit a skill"
    echo -e "  ${CYAN}4${NC})  Edit a command"
    echo -e "  ${CYAN}5${NC})  Create new"
    echo -e "  ${CYAN}6${NC})  Delete"
    echo -e "  ${CYAN}s${NC})  Sync → all tools"
    echo -e "  ${CYAN}i${NC})  Sync status"
    echo -e "  ${CYAN}q${NC})  Quit"
    echo ""
    read -p "› " choice

    case "$choice" in
        1)
            header
            items=()
            mapfile -t items < <(collect_all)
            pick_and_edit "All configs" "${items[@]}"
            ;;
        2)
            [[ -f "$SOURCE_DIR/AGENTS.md" ]] && $EDIT_CMD "$SOURCE_DIR/AGENTS.md" \
                || { echo -e "${RED}Not found${NC}"; pause; }
            ;;
        3)
            header
            items=()
            mapfile -t items < <(collect_skills)
            pick_and_edit "Edit skill" "${items[@]}"
            ;;
        4)
            header
            items=()
            mapfile -t items < <(collect_commands)
            pick_and_edit "Edit command" "${items[@]}"
            ;;
        5) create_new ;;
        6) delete_item ;;
        s|S) run_sync ;;
        i|I) show_status ;;
        q|Q) clear; exit 0 ;;
        *) ;;
    esac
done
