#!/usr/bin/env bash
# Record a meeting with voxtype, transcript separated by speaker
# Usage: record.sh <name>  ->  ~/git/voxtype_meeting/<name>/<yyyy-mm-dd>.md
set -euo pipefail

dir=~/git/voxtype_meeting/$1
out=$dir/$(date +%F).md
mkdir -p "$dir"

# `|| true`: show fails while no meeting exists yet, set -e would exit silently
latest_id() { voxtype meeting show latest 2>/dev/null | awk '/^ID:/{print $2}' || true; }
meeting_status() { voxtype meeting show "$1" 2>/dev/null | awk '/^Status:/{print $2}' || true; }

prev=$(latest_id)
voxtype meeting start -t "$1" >/dev/null
echo "Starting..."
# The daemon may load or download models first, wait until the new meeting exists
until id=$(latest_id) && [[ -n $id && $id != "$prev" ]]; do sleep 1; done

read -rp "Recording '$1', press Enter to stop "
voxtype meeting stop >/dev/null
echo "Transcribing last chunk..."
until [[ $(meeting_status "$id") == Completed ]]; do sleep 1; done

voxtype meeting export "$id" --speakers --timestamps -o "$out" >/dev/null
echo "Transcript: $out"
