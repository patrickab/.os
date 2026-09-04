#!/usr/bin/env bash
# template.sh — a runbook starting point: gum for polished prompts, fzf for
# fast fuzzy search. Adapt freely — add/drop menu items, inline a tmux_launch
# pattern for long-running work, whatever the actual procedure needs.
# Install: gum -> pacman -S gum   fzf -> pacman -S fzf
set -euo pipefail

# gum has a "die and exit" behavior on Ctrl-C by default; nothing extra needed.

# NOTE: no --border/--padding here on purpose. Any cell gum fills with a
# background (even implicitly, to draw a box) renders fully opaque in
# terminals with background_opacity/blur (kitty, wezterm, alacritty) —
# only cells that are never bg-painted show your wallpaper through.
# Plain foreground styling never touches bg, so it always inherits.
gum style --foreground 212 --bold --margin "1 0" "Workflow Automator (gum + fzf)"

# --- 1. main menu: gum choose -------------------------------------------------
STEP=$(gum choose \
    "Configure a run (inputs)" \
    "Select scripts to launch (fzf multi-select)" \
    "Pick an environment (gum choose)" \
    "Fuzzy-jump to a script (fzf + preview)" \
    "Confirm a destructive action (gum confirm)" \
    "Run with a spinner (gum spin)" \
    "Quit")

case "$STEP" in

  "Configure a run (inputs)")
    # --- 2. sequential prompts, gum's version of a form ------------------------
    NAME=$(gum input --placeholder "run name" --value "n6_probe_$(date +%s)")
    LR=$(gum input --placeholder "learning rate" --value "1e-3")
    EPOCHS=$(gum input --placeholder "epochs" --value "100")
    SEED=$(gum input --placeholder "seed" --value "42")
    gum style --foreground 212 "name=$NAME lr=$LR epochs=$EPOCHS seed=$SEED"
    ;;

  "Select scripts to launch (fzf multi-select)")
    # --- 3. fzf multi-select is faster/more familiar than gum choose --no-limit
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
    ;;

  "Pick an environment (gum choose)")
    # --- 4. single-select ------------------------------------------------------
    ENV=$(gum choose --header "Environment:" "local" "gpu-box" "cluster")
    gum style --foreground 212 "-> $ENV"
    ;;

  "Fuzzy-jump to a script (fzf + preview)")
    # --- 5. fzf with a live preview pane — this is where fzf beats gum outright
    PICK=$(find . -maxdepth 3 -name '*.py' -not -path '*/.git/*' 2>/dev/null \
        | fzf --height=60% --border --prompt="open> " \
              --preview 'bat --color=always --style=numbers {} 2>/dev/null || head -50 {}' \
              --preview-window=right:60%)
    [[ -n "${PICK:-}" ]] && gum style --foreground 212 "picked: $PICK"
    ;;

  "Confirm a destructive action (gum confirm)")
    # --- 6. exits 0 on Yes, 1 on No — plug straight into an if -----------------
    if gum confirm "Delete logs/ and re-run everything?"; then
        gum style --foreground 196 "confirmed (demo — nothing deleted)"
    else
        gum style --foreground 244 "aborted"
    fi
    ;;

  "Run with a spinner (gum spin)")
    # --- 7. spinner wraps any command; --title shows while it runs -------------
    gum spin --spinner dot --title "Working..." -- sleep 2
    gum style --foreground 212 "done"
    ;;

  "Quit"|"")
    exit 0
    ;;
esac
