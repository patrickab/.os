return {
  {
    "saghen/blink.cmp",
    version = "*",
    dependencies = {
    },
    opts = {
      completion = {
        ghost_text = { enabled = true },
        menu = { border = "rounded" },
      },
      sources = {
        default = { "lsp", "path", "buffer" },
        providers = {
        },
      },
      keymap = {
        ["<Tab>"] = { "select_next", "fallback" },
        ["<S-Tab>"] = { "select_prev", "fallback" },
        ["<CR>"] = { "accept", "fallback" },
      },
    },
  },
}
