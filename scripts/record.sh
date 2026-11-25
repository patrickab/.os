#!/usr/bin/env bash
# Record a meeting (mic + system audio), transcript with speaker turns from WhisperX on the GPU box
# Usage: record.sh <name>  ->  ~/git/voxtype_meeting/<name>/<yyyy-mm-dd-hh-mm>.{md,flac}
# GPU side is set up by scripts/setup-whisperx.sh, runs offline
set -euo pipefail

GPU_HOST=gigachad-backend

dir=~/git/voxtype_meeting/$1
base=$dir/$(date +%F-%H-%M)
mkdir -p "$dir"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pw-record --rate 16000 --channels 1 "$tmp/mic.wav" &
mic=$!
pw-record --rate 16000 --channels 1 --target "$(pactl get-default-sink)" -P '{ stream.capture.sink = true }' "$tmp/sys.wav" &
sys=$!

read -rp "Recording '$1', press Enter to stop "
kill -INT "$mic" "$sys"
wait

# Keep the audio next to the transcript, to rerun transcription if needed
ffmpeg -loglevel error -y -i "$tmp/mic.wav" -i "$tmp/sys.wav" -filter_complex amix=inputs=2:duration=longest "$base.flac"

echo "Transcribing on $GPU_HOST..."
# Only the progress lines of transcribe.py, not library logs (stderr through the pipe, stdout to the file)
ssh -o ClearAllForwardings=yes "$GPU_HOST" \
    "f=\$(mktemp --suffix .flac) && cat >\$f && cd ~/whisperx && HF_HUB_OFFLINE=1 .venv/bin/python transcribe.py \$f $(printf %q "$1"); rc=\$?; rm -f \$f; exit \$rc" \
    <"$base.flac" 2>&1 >"$base.md" | { grep --line-buffered -E '^(transcribing|aligning|separating|Traceback|[A-Za-z]*Error)' || true; }

echo "Transcript: $base.md"
