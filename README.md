# OS Setup Dotfiles

Personal, idempotent, cross-distro provisioning.

```bash
./setup.sh
```

## Stack

- **Ansible**: system packages (apt/pacman/dnf)
- **Homebrew**: CLI tools and fonts
- **Flatpak**: GUI apps
- **Chezmoi**: dotfiles (`chezmoi/`)
- **Bitwarden Secrets Manager**: secrets

## Secrets

`~/.secrets` is generated from Bitwarden at login by `bws-secrets-sync.service` and sourced by `.bashrc`. Never edit or commit it.

- New machine: `./setup-bitwarden.sh`
- Add a secret: create it in Bitwarden, then run `secrets-sync`

## Monitors

Defaults live in `chezmoi/dot_config/hypr/monitors.lua`. Local overrides go in `~/.config/hypr/hyprmon.lua` (not deployed). Use `hyprmon`: `A` applies, `S` saves.

## Modules

- [Pi coding agent](chezmoi/dot_pi/README.md)
