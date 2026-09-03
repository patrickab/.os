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
        -- Treesitter already colours markdown via the @markup.* captures in the
        -- colorscheme; what was missing is structure. These renderers add the
        -- icons, heading backgrounds and code-block body that make the shape of
        -- a document readable at a glance.
        heading = { enabled = true },
        bullet = { enabled = true },
        checkbox = { enabled = true },
        quote = { enabled = true },
        dash = { enabled = true },
        code = { enabled = true, style = "full", width = "block", min_width = 60 },
        table = { enabled = true },
        -- Left off deliberately: both add vertical/horizontal padding rather
        -- than colour, and push body text away from the gutter.
        paragraph = { enabled = false },
        indent = { enabled = false },
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
        -- On with rendering enabled: without it the markers concealed by
        -- conceallevel=2 stay hidden on the cursor line too, so there is no way
        -- to see the ** or [] you are editing.
        anti_conceal = { enabled = true },
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
