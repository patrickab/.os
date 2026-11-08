#!/bin/bash
# Re-runs whenever this file changes: add or remove packages here.
set -euo pipefail

"$HOME/.local/bin/mise" exec -- pi install npm:pi-compact-transcript
