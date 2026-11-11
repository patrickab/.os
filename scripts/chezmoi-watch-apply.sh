#!/bin/sh
# Applies chezmoi when the source tree changes, and keeps the watch list
# covering the whole tree.
#
# systemd path units watch one directory each -- inotify is not recursive --
# so a drop-in with one PathChanged= line per directory is generated here.
# Only directories holding tracked or non-ignored files are listed: each line
# costs an inotify fd, and gitignored trees (node_modules, .venv) blow past the
# per-user limit. Creating a new directory counts as a change to its parent,
# which is already watched, so this run regenerates the list and the new
# directory is picked up without any manual step.
set -eu

SRC="$HOME/.os/chezmoi"
DROPIN_DIR="$HOME/.config/systemd/user/chezmoi-watch.path.d"
DROPIN="$DROPIN_DIR/10-recursive.conf"

CHEZMOI="$(command -v chezmoi || echo /usr/local/bin/chezmoi)"

"$CHEZMOI" apply --source "$SRC"

mkdir -p "$DROPIN_DIR"
tmp="$(mktemp)"
{
	printf '[Path]\nPathChanged=%s\n' "$SRC"
	git -C "$SRC" -c core.quotePath=false ls-files --cached --others --exclude-standard |
		awk -F/ '{ dir = ""; for (i = 1; i < NF; i++) { dir = dir (i > 1 ? "/" : "") $i; print dir } }' |
		sort -u |
		sed "s|^|PathChanged=$SRC/|"
} >"$tmp"

if cmp -s "$tmp" "$DROPIN"; then
	rm -f "$tmp"
else
	mv "$tmp" "$DROPIN"
	systemctl --user daemon-reload
	# --no-block: this runs inside the unit the path unit activates.
	systemctl --user --no-block restart chezmoi-watch.path
fi
