#!/bin/bash
# Re-runs whenever this file changes: add or remove packages here.
set -euo pipefail

mise=("$HOME/.local/bin/mise" exec --)
"${mise[@]}" pi install npm:pi-compact-transcript
"${mise[@]}" pi install npm:pi-subagents
"${mise[@]}" pi install npm:pi-intercom
