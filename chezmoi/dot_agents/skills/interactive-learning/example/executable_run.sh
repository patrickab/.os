#!/usr/bin/env bash
# Install locked dependencies and run the lesson preview.
# Consumes: frontend/package-lock.json, uv.lock, free loopback ports 5173 and 8000.
# Provides: supervised Vite frontend and FastAPI backend, stopped together on exit.
#   ./run.sh                  -> frontend + API
#   ./run.sh --frontend-only  -> frontend without Python
set -euo pipefail
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
frontend_port=5173
api_port=8000

usage() { printf 'usage: %s [--frontend-only]\n' "${BASH_SOURCE[0]}" >&2; }
case "${1:-}:$#" in
    :0) frontend_only=false ;;
    --frontend-only:1) frontend_only=true ;;
    -h:1|--help:1) usage; exit 0 ;;
    *) usage; exit 2 ;;
esac

require() {
    command -v "$1" >/dev/null || { printf 'Missing %s. %s\n' "$1" "$2" >&2; exit 1; }
}
require node 'Install Node.js 20.19+ or 22.12+.'
require npm 'Install npm with Node.js.'
[[ "$frontend_only" == true ]] || require uv 'Install it from https://docs.astral.sh/uv/ or use --frontend-only.'

port_is_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

ports=("$frontend_port")
[[ "$frontend_only" == true ]] || ports+=("$api_port")
for port in "${ports[@]}"; do
    if port_is_open "$port"; then
        printf 'Port %s is already in use. Stop the existing preview first.\n' "$port" >&2
        exit 1
    fi
done

# Print the process tree rooted at $1, with children before parents.
process_tree() {
    local child
    for child in $(pgrep -P "$1"); do
        process_tree "$child"
    done
    printf '%s\n' "$1"
}

# Stop process trees rooted at the supplied IDs, escalating after ten seconds.
stop_processes() {
    local process_id
    local -a process_ids=()
    for process_id in "$@"; do
        [[ -n "$process_id" ]] && mapfile -t -O "${#process_ids[@]}" process_ids < <(process_tree "$process_id")
    done
    ((${#process_ids[@]})) || return 0
    kill -TERM "${process_ids[@]}" 2>/dev/null || true
    for _ in {1..20}; do
        kill -0 "${process_ids[@]}" 2>/dev/null || return 0
        sleep 0.5
    done
    kill -KILL "${process_ids[@]}" 2>/dev/null || true
}

pids=()
cleanup() {
    trap - EXIT
    stop_processes "${pids[@]}"
    printf 'Done.\n'
}
trap cleanup EXIT
trap 'exit 0' INT TERM

# Wait until $1 accepts connections, failing if process $2 exits or 20 s pass.
wait_for_port() {
    local deadline=$((SECONDS + 20))
    until port_is_open "$1"; do
        if ! kill -0 "$2" 2>/dev/null || ((SECONDS >= deadline)); then
            printf '%s failed to start on port %s.\n' "$3" "$1" >&2
            return 1
        fi
        sleep 0.1
    done
}

# Install only when the lockfile is newer than the last install. uv sync is already a no-op when nothing changed.
if [[ ! "$root_dir/frontend/node_modules/.package-lock.json" -nt "$root_dir/frontend/package-lock.json" ]]; then
    npm --prefix "$root_dir/frontend" ci --no-audit --no-fund
fi
if [[ "$frontend_only" == false ]]; then
    uv sync --project "$root_dir" --frozen --inexact
    (cd -- "$root_dir" && exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "$api_port") &
    pids+=($!)
    wait_for_port "$api_port" "${pids[-1]}" 'Python API'
fi

node "$root_dir/frontend/node_modules/vite/bin/vite.js" --config "$root_dir/frontend/vite.config.ts" "$root_dir/frontend" \
    --host 127.0.0.1 --port "$frontend_port" --strictPort &
pids+=($!)
wait_for_port "$frontend_port" "${pids[-1]}" 'Frontend'
printf '\nPreview: http://127.0.0.1:%s/\nPress Ctrl+C to stop.\n\n' "$frontend_port"

wait -n "${pids[@]}"
