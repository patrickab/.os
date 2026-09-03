-- nvim-treesitter is pinned to the `main` branch (see lazy-lock.json), whose
-- setup() reads only `install_dir`. `auto_install` and `highlight` were
-- master-branch options and did nothing here: parsers are installed from
-- `ensure_installed` by LazyVim, and highlighting is started per-buffer by
-- vim.treesitter.start().
return {
  "nvim-treesitter/nvim-treesitter",
  opts = {
    -- Merged into LazyVim's own list via opts_extend, which already covers
    -- bash, c, diff, html, javascript, json, lua, markdown, markdown_inline,
    -- python, query, regex, toml, tsx, typescript, vim, vimdoc, xml and yaml.
    ensure_installed = {
      "latex",
    },
  },
}
