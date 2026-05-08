return {
  "mikavilpas/yazi.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
  },
  keys = {
    {
      "<leader>y",
      function()
        require("yazi").yazi()
      end,
      desc = "Open Yazi file explorer",
    },
  },
  opts = {
    open_for_directories = true,
    floating_window_scaling_factor = 0.9,
  },
}
