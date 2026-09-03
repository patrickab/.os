-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set({ "n", "v", "i" }, "<C-a>", "<Esc>ggVG", { desc = "Select All" })

vim.keymap.set("n", "<Tab>", ":bnext<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<S-Tab>", ":bprevious<CR>", { noremap = true, silent = true })

vim.keymap.set("n", "<C-Down>", ":resize +2<CR>", { silent = true })
vim.keymap.set("n", "<C-Up>", ":resize -2<CR>", { silent = true })
vim.keymap.set("n", "<C-Right>", ":vertical resize -2<CR>", { silent = true })
vim.keymap.set("n", "<C-Left>", ":vertical resize +2<CR>", { silent = true })

vim.keymap.set("n", "<A-Down>", ":m .+1<CR>==", { desc = "Move line down" })
vim.keymap.set("n", "<A-Up>", ":m .-2<CR>==", { desc = "Move line up" })

vim.keymap.set("o", "f", function()
  if vim.v.operator == "y" then
    vim.fn.setreg("+", vim.fn.expand("%:p"))
    return "<Esc>"
  end
  return "f"
end, { expr = true, desc = "Yank file path (yf)" })

-- same toggle as <leader>uh
Snacks.toggle.inlay_hints():map("<leader>ch")
