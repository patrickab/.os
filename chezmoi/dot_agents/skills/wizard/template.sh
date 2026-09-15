#!/usr/bin/env bash
# template.sh — a runbook starting point: gum for polished prompts, fzf for
# fast fuzzy search. Adapt freely — add/drop menu items, inline a tmux_launch
# pattern for long-running work, whatever the actual procedure needs.
# Install: gum -> pacman -S gum   fzf -> pacman -S fzf
set -euo pipefail

# gum has a "die and exit" behavior on Ctrl-C by default; nothing extra needed.

# --- persistent header: redrawn every loop, cheap, no gum subprocess -------
# echo -e with raw ANSI never bg-paints a cell, so it sidesteps the exact
# opacity trap noted below for gum style --border/--padding — and it's
# free to call every screen instead of once at startup.
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; DIM='\033[2m'; NC='\033[0m'
header() {
    clear
    echo -e "${MAGENTA}════════════════════════════════════════${NC}"
    echo -e "${CYAN}         WORKFLOW AUTOMATOR             ${NC}"
    echo -e "${MAGENTA}════════════════════════════════════════${NC}"
    echo -e " ${DIM}$(pwd)${NC}"
    echo ""
}

pause() {
    echo -e "\n${DIM}Press any key...${NC}"
    read -n 1 -s -r
}

# --- generic picker: fzf when present, numbered read fallback otherwise ----
# One place implements both paths; every callsite gets the fallback for free
# instead of re-deriving "command -v fzf" logic per step.
pick() {
    local title="$1"; shift
    local -a items=("$@")
    if [[ ${#items[@]} -eq 0 ]]; then
        gum style --foreground 196 "nothing to pick from" >&2 2>/dev/null \
            || echo "nothing to pick from" >&2
        return 1
    fi
    if command -v fzf &>/dev/null; then
        printf '%s\n' "${items[@]}" | fzf --prompt="$title> " --height=~40% --reverse || return 1
    else
        echo -e "${CYAN}$title:${NC}" >&2
        local i
        for i in "${!items[@]}"; do
            printf '  %d) %s\n' "$((i+1))" "${items[$i]}" >&2
        done
        echo "" >&2
        local idx
        read -r -p "Select (1-${#items[@]}): " idx
        [[ "$idx" =~ ^[0-9]+$ ]] && (( idx >= 1 && idx <= ${#items[@]} )) \
            && echo "${items[$((idx-1))]}" || return 1
    fi
}

# --- persistent menu loop ---------------------------------------------------
# Use this shape (header + loop + pause) for anything the user runs
# repeatedly in one sitting with different choices each time. For a
# straight-line procedure, drop the loop and let the script fall off the
# end after one pass instead.
while true; do
    header
    STEP=$(gum choose \
        "Configure a run (inputs)" \
        "Select scripts to launch (fzf multi-select)" \
        "Pick an environment (gum choose)" \
        "Fuzzy-jump to a script (fzf + preview)" \
        "Pick from a plain list (pick() with fallback)" \
        "Confirm a destructive action (gum confirm)" \
        "Run with a spinner (gum spin)" \
        "Quit")

    case "$STEP" in

      "Configure a run (inputs)")
        # --- sequential prompts, gum's version of a form ------------------------
        NAME=$(gum input --placeholder "run name" --value "n6_probe_$(date +%s)")
        LR=$(gum input --placeholder "learning rate" --value "1e-3")
        EPOCHS=$(gum input --placeholder "epochs" --value "100")
        SEED=$(gum input --placeholder "seed" --value "42")
        gum style --foreground 212 "name=$NAME lr=$LR epochs=$EPOCHS seed=$SEED"
        pause
        ;;

      "Select scripts to launch (fzf multi-select)")
        # --- fzf multi-select is faster/more familiar than gum choose --no-limit
        # for long lists — tab to mark, enter to confirm.
        mapfile -t SELECTED < <(find scripts -maxdepth 1 -name '*.py' -printf '%f\n' 2>/dev/null \
            | fzf --multi --height=40% --border --prompt="scripts> " \
                  --header="tab: mark  enter: confirm")
        if [[ ${#SELECTED[@]} -eq 0 ]]; then
            gum style --foreground 196 "nothing selected"
        else
            # gum format -t code paints a glamour code-block background (opaque,
            # same issue as the header box) — plain foreground text avoids it.
            printf '%s\n' "${SELECTED[@]}" | gum style --foreground 212
        fi
        pause
        ;;

      "Pick an environment (gum choose)")
        # --- single-select ------------------------------------------------------
        ENV=$(gum choose --header "Environment:" "local" "gpu-box" "cluster")
        gum style --foreground 212 "-> $ENV"
        pause
        ;;

      "Fuzzy-jump to a script (fzf + preview)")
        # --- fzf with a live preview pane — this is where fzf beats gum outright
        PICK=$(find . -maxdepth 3 -name '*.py' -not -path '*/.git/*' 2>/dev/null \
            | fzf --height=60% --border --prompt="open> " \
                  --preview 'bat --color=always --style=numbers {} 2>/dev/null || head -50 {}' \
                  --preview-window=right:60%)
        [[ -n "${PICK:-}" ]] && gum style --foreground 212 "picked: $PICK"
        pause
        ;;

      "Pick from a plain list (pick() with fallback)")
        # --- the reusable pick() above: fzf when present, numbered read when not.
        # Prefer this over an inline fzf-or-bust call whenever a runbook has
        # more than one picker — write the fallback once, call it everywhere.
        mapfile -t OPTIONS < <(printf '%s\n' "local" "gpu-box" "cluster")
        SELECTED=$(pick "Environment" "${OPTIONS[@]}") || true
        [[ -n "${SELECTED:-}" ]] && gum style --foreground 212 "-> $SELECTED"
        pause
        ;;

      "Confirm a destructive action (gum confirm)")
        # --- exits 0 on Yes, 1 on No — plug straight into an if -----------------
        if gum confirm "Delete logs/ and re-run everything?"; then
            gum style --foreground 196 "confirmed (demo — nothing deleted)"
        else
            gum style --foreground 244 "aborted"
        fi
        pause
        ;;

      "Run with a spinner (gum spin)")
        # --- spinner wraps any command; --title shows while it runs -------------
        gum spin --spinner dot --title "Working..." -- sleep 2
        gum style --foreground 212 "done"
        pause
        ;;

      "Quit"|"")
        clear
        exit 0
        ;;
    esac
done
