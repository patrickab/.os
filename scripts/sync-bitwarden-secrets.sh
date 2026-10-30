#!/usr/bin/env bash
# Regenerates ~/.secrets from Bitwarden Secrets Manager. Run at login via
# bws-secrets-sync.service, or manually (alias: secrets-sync) after adding
# a new secret in Bitwarden. Writes to a temp file first so a failed fetch
# never leaves ~/.secrets truncated.
set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$*"; }

TOKEN_FILE="${HOME}/.bws-token"
PROJECT_FILE="${HOME}/.bws-project-id"
OUT_FILE="${HOME}/.secrets"
# Absolute path: systemd user services lack ~/.local/bin on PATH (setup-bitwarden.sh installs here).
BWS_BIN="${HOME}/.local/bin/bws"

[ -f "${TOKEN_FILE}" ]   || { red "Missing ${TOKEN_FILE}"; exit 1; }
[ -f "${PROJECT_FILE}" ] || { red "Missing ${PROJECT_FILE}"; exit 1; }
[ -x "${BWS_BIN}" ]      || { red "Missing ${BWS_BIN}, run setup-bitwarden.sh"; exit 1; }

TMP_FILE=$(mktemp)
trap 'rm -f "${TMP_FILE}"' EXIT

BWS_ACCESS_TOKEN="$(cat "${TOKEN_FILE}")" \
  "${BWS_BIN}" secret list "$(cat "${PROJECT_FILE}")" -o env |
  sed -E '/^(#|$)/! s/^/export /' > "${TMP_FILE}"

mv "${TMP_FILE}" "${OUT_FILE}"
chmod 600 "${OUT_FILE}"
