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
        -- Only images & tables render; everything else stays plain text.
        heading = { enabled = false },
        bullet = { enabled = false },
        checkbox = { enabled = false },
        quote = { enabled = false },
        dash = { enabled = false },
        code = { enabled = false },
        paragraph = { enabled = false },
        indent = { enabled = false },
        link = {
          enabled = true,
          hyperlink = "󰌹 ",
        },
        table = { enabled = true },
        image = {
          enabled = "all",
          width = 80,
          height = 40,
        },
        win_options = {
          conceallevel = { default = 0, rendered = 2 },
          concealcursor = { default = "", rendered = "" },
        },
        anti_conceal = { enabled = true },
      })
    end,
  },
  {
    "3rd/image.nvim",
    build = false, -- vendored lua-magick, no luarocks build needed
    ft = { "markdown", "vimwiki" },
    opts = {
      backend = "kitty",
      integrations = {
        markdown = {
          enabled = true,
          only_render_image_at_cursor = false,
          filetypes = { "markdown", "vimwiki" },
        },
      },
      max_width_window_percentage = 80,
      max_height_window_percentage = 60,
      window_overlap_clear_enabled = true,
    },
  },
}
