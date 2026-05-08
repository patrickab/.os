return {
  "nvim-treesitter/nvim-treesitter",
  opts = {
    ensure_installed = {
      "python",
      "lua",
      "vim",
      "vimdoc",
      "javascript",
      "json",
      "latex",
      "markdown",
      "markdown_inline",
    },
    auto_install = true,
    highlight = {
      enable = true,
      additional_vim_regex_highlighting = false,
    },
  },
}
