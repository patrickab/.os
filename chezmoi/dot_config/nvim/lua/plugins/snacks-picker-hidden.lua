-- <leader><leader> ("Find Files (Root Dir)") is served by snacks.picker, not telescope.
-- Show dotfiles, but keep respecting .gitignore.
return {
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = { hidden = true, ignored = false },
          explorer = { hidden = true, ignored = false },
          grep = { hidden = true, ignored = false },
        },
      },
    },
  },
}
