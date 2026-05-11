return {
  {
    "Mofiqul/vscode.nvim",
    italic_comments = true,
    italic_inlayhints = true,
    underline_links = true,
    terminal_colors = true,

    lazy = false,
    priority = 1000,
    config = function()
      local c = require('vscode.colors').get_colors()
      require('vscode').setup({
        transparent = true,
        italic_comments = true,
        group_overrides = {
            Cursor = { fg=c.vscDarkBlue, bg=c.vscLightGreen, bold=true },
        }
      })
      vim.cmd.colorscheme("vscode")
    end,
  }
}