#!/bin/bash
# Re-runs whenever this file changes: add or remove plugins here.
set -euo pipefail

"$HOME/.local/bin/mise" exec -- omp plugin install omp_hub_client
