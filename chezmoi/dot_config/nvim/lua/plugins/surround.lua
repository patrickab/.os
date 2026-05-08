return {
  "kylechui/nvim-surround",
  version = "*",
  event = "VeryLazy",
  config = function(_, opts)
    require("nvim-surround").setup(opts)
    vim.keymap.set("x", "gs", "<Plug>(nvim-surround-visual)", { desc = "Surround (Visual Mode)" })
    vim.keymap.set("x", "gS", "<Plug>(nvim-surround-visual-line)", { desc = "Surround (Visual Line Mode)" })
  end,
}
