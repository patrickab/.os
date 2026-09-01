return {
  {
    "github/copilot.vim",
    lazy = false,
  },
  {
    "olimorris/codecompanion.nvim",
    version = "^19.0.0",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    opts = {
      interactions = {
        chat = {
          adapter = "copilot",
        },
        inline = {
          adapter = "copilot",
        },
      },
      rules = {
        default = {
          files = {
            "AGENTS.md",
            "AGENTS.local.md",
          },
        },
      },
    },
    cmd = { "CodeCompanion", "CodeCompanionChat", "CodeCompanionActions" },
    keys = {
      {
        "<leader>cc",
        "<cmd>CodeCompanionChat Toggle<cr>",
        desc = "CodeCompanion Chat",
      },
      {
        "<leader>ci",
        "<cmd>CodeCompanion<cr>",
        mode = { "n", "v" },
        desc = "CodeCompanion Inline",
      },
    },
  },
}
