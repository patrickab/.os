return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
      "nvim-tree/nvim-web-devicons",
    },
    ft = { "markdown", "vimwiki" },
    config = function()
      require("render-markdown").setup({
        heading = { enabled = false },
        paragraph = { enabled = false },
        bullet = { enabled = false },
        checkbox = { enabled = false },
        quote = { enabled = false },
        dash = { enabled = false },
        indent = { enabled = false },
        code = { enabled = false },
        table = { enabled = true },
        image = {
          enabled = "all",
          width = 80,
          height = 40,
        },
        link = {
          enabled = true,
          hyperlink = "󰌹 ",
        },
        win_options = {
          conceallevel = { default = 0, rendered = 2 },
          concealcursor = { default = "", rendered = "" },
        },
        anti_conceal = { enabled = false },
      })
      vim.api.nvim_create_autocmd("FileType", {
        pattern = { "markdown", "vimwiki" },
        callback = function()
          vim.opt_local.spell = false
          vim.api.nvim_set_hl(0, "SpellBad", {})
          vim.api.nvim_set_hl(0, "SpellCap", {})
          vim.api.nvim_set_hl(0, "SpellLocal", {})
          vim.api.nvim_set_hl(0, "SpellRare", {})

          vim.keymap.set("n", "gx", function()
            if vim.fn.executable("kitten") == 1 then
              vim.fn.system({ "kitten", "hints", "--type=url", "--program=xdg-open" })
            else
              vim.ui.open(vim.fn.expand("<cfile>"))
            end
          end, { buffer = true, desc = "Open Link (Kitty hints)" })
        end,
      })
    end,
  },
}
