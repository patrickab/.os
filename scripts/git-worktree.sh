#!/usr/bin/env bash
# Prints the selected worktree. The worktree shell function performs the cd.
set -euo pipefail
export LC_ALL=C

if ! command -v fzf >/dev/null 2>&1; then
    printf 'worktree: fzf is required. Install it with brew install fzf.\n' >&2
    exit 1
fi

root="$HOME/git/worktrees"
if [[ ! -d "$root" ]]; then
    printf 'worktree: no worktree directory at %s\n' "$root" >&2
    exit 1
fi

shopt -s nullglob dotglob
repos=()
entries=()
for repo in "$root"/*/; do
    repo_name="${repo%/}"
    repo_name="${repo_name##*/}"
    found=false
    for worktree in "$repo"*/; do
        [[ -f "$worktree.git" || -d "$worktree.git" ]] || continue
        path="${worktree%/}"
        entries+=("$repo_name"$'\t'"${path##*/}"$'\t'"$path")
        found=true
    done
    if [[ "$found" == true ]]; then
        repos+=("$repo_name")
    fi
done

if (( ${#entries[@]} == 0 )); then
    printf 'worktree: no worktrees found in %s/<repo>/<worktree>.\n' "$root" >&2
    exit 1
fi

scope=0
query=''
while true; do
    label='All repos'
    visible=("${entries[@]}")
    if (( scope > 0 )); then
        label="${repos[scope-1]}"
        visible=()
        for entry in "${entries[@]}"; do
            if [[ "${entry%%$'\t'*}" == "$label" ]]; then
                visible+=("$entry")
            fi
        done
    fi

    # ponytail: rebuild the small picker on Tab, preserving the fuzzy query.
    # No reload subprocess, temporary state, or shell interpolation of repo names.
    status=0
    result="$(printf '%s\n' "${visible[@]}" |
        FZF_DEFAULT_OPTS= FZF_DEFAULT_OPTS_FILE= fzf \
            --height='~60%' --layout=reverse --border=rounded --padding=1,2 \
            --border-label=" GIT WORKTREES · $label " \
            --prompt="$label › " --info=inline --no-multi \
            --color='border:magenta,label:cyan,prompt:cyan,pointer:magenta,header:cyan,info:yellow' \
            --header=$'Tab  next repo    ↑/↓  select    Enter  jump    Esc  cancel\nRepository / Worktree' \
            --delimiter=$'\t' --with-nth=1,2 --nth=1,2 \
            --query="$query" --print-query --expect=tab)" || status=$?
    mapfile -t answer <<< "$result"
    query="${answer[0]}"
    # fzf exits 1 on Tab when the current query has no matches.
    if [[ "${answer[1]:-}" == tab ]] && (( status <= 1 )); then
        scope=$(( (scope + 1) % (${#repos[@]} + 1) ))
        continue
    fi
    if (( status != 0 )); then
        # Esc / Ctrl-C and Enter on an empty list leave the caller in place.
        if (( status == 130 || status == 1 )); then
            exit 0
        fi
        exit "$status"
    fi
    selected="${answer[2]:-}"
    if [[ -n "$selected" ]]; then
        selected="${selected#*$'\t'}"
        printf '%s\n' "${selected#*$'\t'}"
    fi
    exit 0
done
