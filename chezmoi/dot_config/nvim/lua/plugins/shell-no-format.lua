-- Work machines (NVIM_NO_SHELL_FORMAT=1, set in ~/.bashrc_wsl_appendix): don't format shell files.
-- shfmt (LazyVim default) rewrites indentation and blank lines in repos with their own style.
-- Elsewhere the LazyVim defaults stay. shellcheck diagnostics are on either way.
if not vim.env.NVIM_NO_SHELL_FORMAT then return {} end

return {
  "stevearc/conform.nvim",
  opts = {
    formatters_by_ft = {
      sh = {},
      bash = {},
    },
  },
}
