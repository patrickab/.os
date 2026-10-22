#!/usr/bin/env bash
# Serve voxtype transcription from a GPU box running whisper.cpp server.
#
# - Run from the client, the GPU box is configured over ssh
# - Idempotent: rerun to apply changes (MODEL, tag bump) or repair the setup
# - Contract: OpenAI API at http://<GPU_IP>:PORT/v1/audio/transcriptions
# - Client side lives in chezmoi/dot_config/voxtype/config.toml, keep remote_endpoint in sync
set -euo pipefail

GPU_HOST=noob@100.96.227.106 # user@<tailscale ip>, whisper-server binds to that ip
MODEL=large-v3-turbo         # any name accepted by whisper.cpp models/download-ggml-model.sh
PORT=8080
WHISPER_TAG=v1.9.5

GPU_IP=${GPU_HOST#*@}
ENDPOINT=http://$GPU_IP:$PORT

echo "==> GPU: build dependencies"
if ! ssh "$GPU_HOST" pacman -Q base-devel cmake git vulkan-headers spirv-headers shaderc >/dev/null 2>&1; then
    ssh -t "$GPU_HOST" sudo pacman -S --needed --noconfirm base-devel cmake git vulkan-headers spirv-headers shaderc
fi
if ! ssh "$GPU_HOST" loginctl show-user '$USER' -p Linger | grep -q yes; then
    ssh -t "$GPU_HOST" 'sudo loginctl enable-linger $USER'
fi

echo "==> GPU: whisper.cpp $WHISPER_TAG, model $MODEL, service on $GPU_IP:$PORT"
ssh "$GPU_HOST" bash -s -- "$WHISPER_TAG" "$MODEL" "$GPU_IP" "$PORT" <<'REMOTE'
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
    curl -sf "$ENDPOINT/health" >/dev/null && break
    sleep 2
done
curl -sf "$ENDPOINT/health" >/dev/null || { echo "whisper-server not healthy, check: ssh $GPU_HOST journalctl --user -u whisper-server" >&2; exit 1; }

echo "==> Smoke test (samples/jfk.wav)"
ssh "$GPU_HOST" cat whisper.cpp/samples/jfk.wav |
    curl -sf "$ENDPOINT/v1/audio/transcriptions" -F file=@- -F response_format=json
echo
ssh "$GPU_HOST" journalctl --user -u whisper-server -b --no-pager | grep -m1 -i 'vulkan.*nvidia\|ggml_vulkan: 0' || echo "WARNING: no Vulkan device in server log, running on CPU?"

echo "==> Client: restart voxtype"
systemctl --user restart voxtype
