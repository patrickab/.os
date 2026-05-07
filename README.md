# Dotfiles

## Deployment pipeline

```
dot_<name>  --chezmoi-->  .<name>  --ansible-->  wired into shell rc files
```

1. **Chezmoi** maps `dot_` prefix → `.` for a single path component.
   - `dot_bashrc_appendix` → `~/.bashrc_appendix` (file)
   - `dot_config/fish/` → `~/.config/fish/` (directory; `dot_` only applies to the `config` component)

2. **Ansible** idempotently injects `source` lines into shell rc files (e.g. `~/.bashrc`).

3. **Ordering**: `~/.bashrc` sources Omarchy defaults first, then dotfiles rc, then appendix last.
   Appendix aliases always win because they're sourced last.

## Adding shell customization

1. Create `dot_bashrc_appendix` (or `dot_fish_appendix`, etc.) in the appropriate dir.
2. Ansible wiring is already in place — the file just needs to exist.
3. Run chezmoi apply to deploy.

## Provisioning Architecture

- **Tooling Split**: Ansible handles system state/packages. Chezmoi manages personal dotfiles/secrets.
- **Native Packages**: Ansible `package` module autodetects apt/pacman/dnf for cross-distro compatibility.
- **Homebrew**: Manages CLI utilities to prevent static binary rot (update trap).
- **Direct Extraction**: OS-agnostic declarative fallback for fonts (bypasses macOS-only Casks).
- **Vendor Scripts**: Last resort for missing tools. Idempotency enforced via `creates: /path/to/binary`.
- **Flatpak**: Consistent, sandboxed GUI application installations across distros.
