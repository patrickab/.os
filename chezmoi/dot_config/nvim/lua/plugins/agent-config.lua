return {
  "nvim-telescope/telescope.nvim",
  keys = {
    {
      "<leader>ac",
      function()
        require("config.agent-config").open_picker()
      end,
      desc = "Agent Config",
    },
  },
}
