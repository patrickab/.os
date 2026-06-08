return {
  "nvim-telescope/telescope.nvim",
  keys = {
    {
      "<leader>oc",
      function()
        require("config.opencode-config").open_picker()
      end,
      desc = "OpenCode Config Manager",
    },
  },
}
