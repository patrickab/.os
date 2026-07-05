#!/usr/bin/env bash
# One-shot setup for Bitwarden across this machine: installs bw (vault CLI),
# bws (Secrets Manager CLI), and Bitwarden Desktop, points them at the EU
# region, then does the first ~/.secrets fetch and enables the login-time
# refresh service. Re-running is safe — every step is idempotent.
set -euo pipefail
cd ~/.os

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

echo "==> Installing/updating bws (Secrets Manager CLI)..."
BWS_REPO="bitwarden/sdk-sm"
BWS_BIN_DIR="${HOME}/.local/bin"
BWS_BIN_PATH="${BWS_BIN_DIR}/bws"

case "$(uname -m)" in
  x86_64)  BWS_ARCH="x86_64" ;;
  aarch64) BWS_ARCH="aarch64" ;;
  *) red "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac
BWS_PLATFORM="${BWS_ARCH}-unknown-linux-gnu"

bws_latest_tag=$(gh release list --repo "${BWS_REPO}" --limit 50 --json tagName -q '.[].tagName' | grep '^bws-v' | sort -V | tail -1)
bws_latest_version="${bws_latest_tag#bws-v}"

if [ -x "${BWS_BIN_PATH}" ] && [ "$("${BWS_BIN_PATH}" --version | awk '{print $2}')" = "${bws_latest_version}" ]; then
  green "bws already at latest version (${bws_latest_version})"
else
  BWS_TMP_DIR=$(mktemp -d)
  trap 'rm -rf "${BWS_TMP_DIR}"' EXIT
  (
    cd "${BWS_TMP_DIR}"
    asset="bws-${BWS_PLATFORM}-${bws_latest_version}.zip"
    checksums="bws-sha256-checksums-${bws_latest_version}.txt"
    gh release download "${bws_latest_tag}" --repo "${BWS_REPO}" -p "${asset}" -p "${checksums}"
    grep "${asset}" "${checksums}" | sha256sum -c -
    unzip -oq "${asset}" -d extracted
    mkdir -p "${BWS_BIN_DIR}"
    install -m 755 extracted/bws "${BWS_BIN_PATH}"
  )
  green "bws installed/updated to ${bws_latest_version}"
fi

if command -v bw &>/dev/null; then
  echo "==> Updating bw (vault CLI)..."
  brew upgrade bitwarden-cli || true
else
  echo "==> Installing bw (vault CLI)..."
  brew install bitwarden-cli
fi

if flatpak list --app 2>/dev/null | grep -q com.bitwarden.desktop; then
  echo "==> Updating Bitwarden Desktop..."
  flatpak update -y com.bitwarden.desktop
else
  echo "==> Installing Bitwarden Desktop..."
  flatpak install -y flathub com.bitwarden.desktop
fi

echo "==> Setting EU region..."
bw config server https://vault.bitwarden.eu >/dev/null
bws config server-base https://vault.bitwarden.eu >/dev/null

if [ ! -f ~/.bws-token ]; then
  read -rsp "Bitwarden Secrets Manager access token: " token
  echo
  printf '%s' "$token" > ~/.bws-token
  chmod 600 ~/.bws-token
fi

if [ ! -f ~/.bws-project-id ]; then
  echo "==> Looking up projects the machine account can see..."
  projects_json=$(BWS_ACCESS_TOKEN="$(cat ~/.bws-token)" bws project list)
  count=$(jq 'length' <<<"$projects_json")
  case "$count" in
    0)
      red "Machine account has no project access. In the web vault: Machine accounts -> your account -> Projects -> grant access, then re-run this script."
      exit 1
      ;;
    1)
      project_id=$(jq -r '.[0].id' <<<"$projects_json")
      ;;
    *)
      mapfile -t names < <(jq -r '.[].name' <<<"$projects_json")
      mapfile -t ids   < <(jq -r '.[].id' <<<"$projects_json")
      echo "Multiple projects found, pick one:"
      select name in "${names[@]}"; do
        [ -n "$name" ] || continue
        for i in "${!names[@]}"; do
          [ "${names[$i]}" = "$name" ] && project_id="${ids[$i]}" && break 2
        done
      done
      ;;
  esac
  printf '%s' "$project_id" > ~/.bws-project-id
  green "Using project ID: ${project_id}"
fi

echo "==> Deploying dotfiles (for the secrets-sync service unit)..."
chezmoi init --source ~/.os/chezmoi --apply

if systemctl --user is-enabled bws-secrets-sync.service &>/dev/null; then
  :
else
  echo "==> Enabling login-time secrets sync..."
  systemctl --user daemon-reload
  systemctl --user enable bws-secrets-sync.service
fi

echo "==> Fetching secrets now..."
./scripts/sync-bitwarden-secrets.sh

green "==> Done. Open a new shell (or run 'secrets-sync') to load secrets. Log into 'bw' and Bitwarden Desktop yourself with your email + master password."
