#!/usr/bin/env bash
# Meeting transcription with speaker turns on the GPU box, used by scripts/record.sh
#
# - Run from the client, the GPU box is configured over ssh
# - Idempotent: rerun to apply changes to meeting-transcribe.py or the whisperx version
# - Needs HF_TOKEN in env (with accepted terms for pyannote/speaker-diarization-community-1),
#   only to download models once, it is not stored on the GPU box.
#   Afterwards transcription runs offline (HF_HUB_OFFLINE=1 in record.sh)
set -euo pipefail

GPU_HOST=gigachad-backend
WHISPERX_VERSION=3.8.6
: "${HF_TOKEN:?HF_TOKEN must be set}"

here=$(dirname "$(realpath "$0")")
ssh_() { ssh -o ClearAllForwardings=yes "$GPU_HOST" "$@"; }

echo "==> GPU: whisperx $WHISPERX_VERSION in ~/whisperx"
# uv from a bootstrap venv avoids needing sudo, uv provides python 3.12 (whisperx needs <3.14)
ssh_ bash -s -- "$WHISPERX_VERSION" <<'REMOTE'
set -euo pipefail
mkdir -p ~/whisperx && cd ~/whisperx
[[ -x uv-boot/bin/uv ]] || { python3 -m venv uv-boot && uv-boot/bin/pip install -q uv; }
[[ -d .venv ]] || uv-boot/bin/uv venv -q --python 3.12 .venv
VIRTUAL_ENV=.venv uv-boot/bin/uv pip install -q "whisperx==$1"
REMOTE
ssh_ 'cat > ~/whisperx/transcribe.py' <"$here/meeting-transcribe.py"

echo "==> GPU: download models (whisper large-v3, en/de word alignment, pyannote diarization)"
ssh_ "cd ~/whisperx && HF_TOKEN=\$(cat) .venv/bin/python -c '
import whisperx
from whisperx.diarize import DiarizationPipeline
whisperx.load_model(\"large-v3\", \"cpu\", compute_type=\"int8\")
for lang in (\"en\", \"de\"):
    whisperx.load_align_model(language_code=lang, device=\"cpu\")
DiarizationPipeline()
' >setup.log 2>&1 || { cat setup.log; exit 1; }" <<<"$HF_TOKEN"

echo "==> Smoke test, offline (whisper.cpp samples/jfk.wav)"
ssh_ 'cd ~/whisperx && HF_HUB_OFFLINE=1 .venv/bin/python transcribe.py ~/whisper.cpp/samples/jfk.wav smoke-test 2>/dev/null'
