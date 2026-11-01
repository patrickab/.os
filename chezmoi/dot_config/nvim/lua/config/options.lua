-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
vim.opt.relativenumber = true
vim.opt.ttimeout = true
vim.opt.ttimeoutlen = 10
vim.opt.clipboard = "unnamedplus"
vim.opt.whichwrap:append("<,>,[,],h,l")
vim.opt.autoindent = true
vim.opt.scrolloff = 999 -- keep cursor vertically centered

-- Use the local provider normally; forward yanks through SSH to the terminal.
if vim.env.SSH_CONNECTION or vim.env.SSH_TTY or vim.env.SSH_CLIENT then
  vim.g.clipboard = vim.env.TMUX and "tmux" or "osc52"
end

-- 'background' is left unset on purpose: Neovim detects it from the terminal (OSC 11) and the
-- colorscheme follows, <leader>ub flips it. Setting it here would disable that detection.
