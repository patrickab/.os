#!/usr/bin/env bash
# Set up voxtype on this machine, transcribing either locally or on a GPU box.
#
# Usage:
#   setup-voxtype.sh --local   transcribe on this machine
#   setup-voxtype.sh --ssh     transcribe on a GPU box (whisper.cpp server over tailscale),
#                              prompts for <user>@<host>, ssh/sudo passwords are asked interactively
#
# - Both modes first set up this machine, --ssh then the GPU box
# - Idempotent: rerun to apply changes (MODEL, tag bump) or repair the setup
# - Remote contract: OpenAI API at http://<GPU tailscale ip>:PORT/v1/audio/transcriptions
# - Only changes whisper.mode/model/remote_endpoint in ~/.config/voxtype/config.toml (via `voxtype config set`),
#   a later `chezmoi apply` resets them to the repo defaults, rerun this script after
# - scripts/record.sh only talks to the local voxtype daemon, so it works in either mode
set -euo pipefail

MODEL=large-v3-turbo # any name accepted by whisper.cpp models/download-ggml-model.sh and `voxtype setup --model`
PORT=8080
WHISPER_TAG=v1.9.5

usage() { echo "Usage: ${0##*/} --local | --ssh" >&2; exit 2; }
[[ $# -eq 1 ]] || usage
case $1 in --local | --ssh) mode=${1#--} ;; *) usage ;; esac

setup_client() {
    echo "==> Client: requirements"
    : "${HF_TOKEN:?HF_TOKEN must be set (needed for speaker diarization models), export it and rerun}"
    command -v voxtype >/dev/null || { echo "voxtype is not installed on this machine" >&2; exit 1; }
    # ONNX binary: ml speaker diarization for scripts/record.sh
    voxtype setup onnx --status | grep -q 'Backend: ONNX' || sudo voxtype setup onnx --enable
}

setup_local() {
    echo "==> Client: local transcription, model $MODEL"
    voxtype setup --download --model "$MODEL" >/dev/null
    voxtype config set whisper.model "$MODEL"
    voxtype config set whisper.mode local
    systemctl --user restart voxtype
}

setup_ssh() {
    read -rp "GPU box (<user>@<host>): " gpu_host
    [[ $gpu_host == *?@?* ]] || { echo "expected <user>@<host>" >&2; exit 1; }

    # One authenticated connection, reused by every ssh call below, so the password is asked once
    ctl=$(mktemp -u /tmp/voxtype-ssh.XXXXXX)
    ssh_() { ssh -o ControlMaster=auto -o ControlPath="$ctl" -o ControlPersist=10m "$@"; }
    trap 'ssh -o ControlPath="$ctl" -O exit "$gpu_host" 2>/dev/null || true' EXIT

    echo "==> GPU: connecting (ssh password prompt, if any)"
    ssh_ -t "$gpu_host" true

    gpu_ip=$(ssh_ "$gpu_host" tailscale ip -4 | head -1)
    [[ -n $gpu_ip ]] || { echo "no tailscale ip on $gpu_host" >&2; exit 1; }
    endpoint=http://$gpu_ip:$PORT

    echo "==> GPU: build dependencies"
    if ! ssh_ "$gpu_host" pacman -Q base-devel cmake git vulkan-headers spirv-headers shaderc >/dev/null 2>&1; then
        ssh_ -t "$gpu_host" sudo pacman -S --needed --noconfirm base-devel cmake git vulkan-headers spirv-headers shaderc
    fi
    if ! ssh_ "$gpu_host" loginctl show-user '$USER' -p Linger | grep -q yes; then
        ssh_ -t "$gpu_host" 'sudo loginctl enable-linger $USER'
    fi

    echo "==> GPU: whisper.cpp $WHISPER_TAG, model $MODEL, service on $gpu_ip:$PORT"
    ssh_ "$gpu_host" bash -s -- "$WHISPER_TAG" "$MODEL" "$gpu_ip" "$PORT" <<'REMOTE'
set -euo pipefail
tag=$1 model=$2 bind_ip=$3 port=$4
repo=~/whisper.cpp

[[ -d $repo ]] || git clone --quiet https://github.com/ggml-org/whisper.cpp "$repo"
git -C "$repo" fetch --quiet --tags
git -C "$repo" -c advice.detachedHead=false checkout --quiet "$tag"
cmake -S "$repo" -B "$repo/build" -Wno-author -Wno-deprecated -DGGML_VULKAN=1 -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$repo/build" -j --target whisper-server >/dev/null

model_file=$repo/models/ggml-$model.bin
[[ -f $model_file ]] || sh "$repo/models/download-ggml-model.sh" "$model" >/dev/null

mkdir -p ~/.config/systemd/user
cat >~/.config/systemd/user/whisper-server.service <<UNIT
[Unit]
Description=whisper.cpp server for voxtype

[Service]
ExecStart=$repo/build/bin/whisper-server -m $model_file --host $bind_ip --port $port --inference-path /v1/audio/transcriptions
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --quiet whisper-server
systemctl --user restart whisper-server
REMOTE

    echo "==> Waiting for model to load"
    for _ in {1..60}; do
        curl -sf "$endpoint/health" >/dev/null && break
        sleep 2
    done
    curl -sf "$endpoint/health" >/dev/null || { echo "whisper-server not healthy, check: ssh $gpu_host journalctl --user -u whisper-server" >&2; exit 1; }

    echo "==> Smoke test (samples/jfk.wav)"
    ssh_ "$gpu_host" cat whisper.cpp/samples/jfk.wav |
        curl -sf "$endpoint/v1/audio/transcriptions" -F file=@- -F response_format=json
    echo
    ssh_ "$gpu_host" journalctl --user -u whisper-server -b --no-pager | grep -m1 -i 'vulkan.*nvidia\|ggml_vulkan: 0' || echo "WARNING: no Vulkan device in server log, running on CPU?"

    echo "==> Client: remote transcription via $endpoint"
    voxtype config set whisper.remote_endpoint "$endpoint"
    voxtype config set whisper.mode remote
    systemctl --user restart voxtype
}

setup_client
case $mode in
local) setup_local ;;
ssh) setup_ssh ;;
esac
echo "==> Done ($mode). Record with scripts/record.sh <name>"
