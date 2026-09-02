return {
  { "LazyVim/LazyVim", opts = { colorscheme = "oh-lucy-evening" } },

  -- All colorscheme plugins below load lazily and are never applied directly;
  -- they just need to be installed so the picker (Themery, via <leader>uT)
  -- and hot-reload can switch between them. The active default lives above.

  -- previously-trimmed "round 1" mainstream batch, restored
  { "catppuccin/nvim", lazy = true },
  { "folke/tokyonight.nvim", lazy = true },
  { "rebelot/kanagawa.nvim", lazy = true },
  { "EdenEast/nightfox.nvim", lazy = true },
  { "ellisonleao/gruvbox.nvim", lazy = true },
  { "rose-pine/neovim", name = "rose-pine", lazy = true },
  { "projekt0n/github-nvim-theme", lazy = true },
  { "navarasu/onedark.nvim", lazy = true },
  { "Mofiqul/dracula.nvim", lazy = true },
  { "gbprod/nord.nvim", lazy = true },
  { "sainnhe/everforest", lazy = true },
  { "sainnhe/sonokai", lazy = true },
  { "sainnhe/edge", lazy = true },
  { "loctvl842/monokai-pro.nvim", lazy = true },
  { "Shatur/neovim-ayu", lazy = true },
  { "bluz71/vim-moonfly-colors", lazy = true },
  { "marko-cerovac/material.nvim", lazy = true },

  -- "round 2" batch
  { "sainnhe/gruvbox-material", lazy = true },
  { "rockyzhang24/arctic.nvim", dependencies = { "rktjmp/lush.nvim" }, lazy = true },
  { "webhooked/kanso.nvim", lazy = true },
  { "comfysage/evergarden", lazy = true },
  { "eldritch-theme/eldritch.nvim", lazy = true },
  { "craftzdog/solarized-osaka.nvim", lazy = true },
  { "ramojus/mellifluous.nvim", lazy = true },
  { "kvrohit/mellow.nvim", lazy = true },
  { "kvrohit/rasmus.nvim", lazy = true },
  { "Yazeed1s/oh-lucy.nvim", lazy = true },
  { "Yazeed1s/minimal.nvim", lazy = true },
  { "rafamadriz/neon", lazy = true },
  { "oxfist/night-owl.nvim", lazy = true },
  { "wtfox/jellybeans.nvim", lazy = true },
  { "Mofiqul/adwaita.nvim", lazy = true },
  { "ficcdaf/ashen.nvim", lazy = true },
  { "zootedb0t/citruszest.nvim", lazy = true },
  { "rockerBOO/boo-colorscheme-nvim", lazy = true },
  { "0xstepit/flow.nvim", lazy = true },

  -- fresh finds
  { "scottmckendry/cyberdream.nvim", lazy = true },
  { "cranberry-clockworks/coal.nvim", lazy = true },

  -- Picker for switching between the themes above.
  {
    "zaldih/themery.nvim",
    lazy = false,
    keys = {
      { "<leader>uT", "<cmd>Themery<cr>", desc = "Theme Picker (Themery)" },
    },
    config = function()
      require("themery").setup({
        themes = {
          "gruvbox-material",
          "arctic",
          "kanso-zen", "kanso-ink", "kanso-mist",
          "evergarden",
          "eldritch",
          "solarized-osaka",
          "mellifluous",
          "mellow",
          "rasmus",
          "oh-lucy", "oh-lucy-evening",
          "minimal",
          "neon",
          "night-owl",
          "jellybeans",
          "adwaita",
          "ashen",
          "citruszest",
          "boo",
          "flow",
        },
        livePreview = true,
      })
    end,
  },
}
