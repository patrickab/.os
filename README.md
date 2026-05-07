# OS Setup Dotfiles

For personal use. Stateless, declarative, cross-distro provisioning with automatic version control.

## Usage

Single command bootstraps entire system: installs prerequisites, provisions packages, deploys dotfiles.

```bash
./setup.sh
```

## Key Benefits

- ✅ **Reproducible Environments** - Fresh machine becomes ready in a single command.
- ✅ **Automatic Updates** - No static binary rot. brew/flaptpak update all software (CLI/GUI) in one command.
- ✅ **Cross-Distro Compatibility** - Same setup works on any Linux distribution.
- ✅ **Declarative Configuration** - System state defined in code, not manual commands.
- ✅ **Idempotent Provisioning** - Safe to re-run. Already-installed packages skip automatically.
- ✅ **Rollback Capability** - Package managers track installations. Uninstall cleanly if needed.
- ✅ **Dependency Management** - Homebrew/Flatpak handle transitive dependencies automatically.
- ✅ **Secrets Management** - Chezmoi encrypts sensitive data (API keys, tokens) in dotfiles.

## Stack

- **Ansible** — declarative package management (apt/pacman/dnf autodetected via `package` module)
- **Homebrew** — CLI tools with `brew upgrade` for updates, identical versions cross-distro
- **Flatpak** — sandboxed GUI apps, distro-agnostic
- **Chezmoi** — dotfile templating and secrets (maps `dot_` to `.`)

## Design

- **CLI via Homebrew** — avoids `curl | bash` static binary rot; `brew upgrade` handles all updates
- **GUI via Flatpak** — sandboxed, dependency-free, works on immutable distros
- **Core tools via system pkg manager** — git, tmux, htop, kitty stay native
- **Fonts via Homebrew Casks** — user-space install to `~/.local/share/fonts`

All tasks are idempotent — safe to re-run. Same playbook works on Arch, Debian, Fedora, Ubuntu without modification.

## Customization

Add `dot_bashrc_appendix` to chezmoi directory, then `chezmoi apply`.
