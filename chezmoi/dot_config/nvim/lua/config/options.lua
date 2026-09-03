-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
vim.opt.relativenumber = false
vim.opt.ttimeout = true
vim.opt.ttimeoutlen = 10
vim.opt.clipboard = "unnamedplus"
vim.opt.whichwrap:append("<,>,[,],h,l")
vim.opt.autoindent = true

-- Use the local provider normally; forward yanks through SSH to the terminal.
if vim.env.SSH_CONNECTION or vim.env.SSH_TTY or vim.env.SSH_CLIENT then
  vim.g.clipboard = vim.env.TMUX and "tmux" or "osc52"
end

-- Pinned outside the colorscheme on purpose: setting 'background' from inside
-- colors/*.lua re-enters did_set_background and wipes the scheme. Setting it
-- here also gives it a real script sid, which makes Neovim drop its OSC-11
-- background auto-detection autocmd at VimEnter.
vim.o.background = "dark"
