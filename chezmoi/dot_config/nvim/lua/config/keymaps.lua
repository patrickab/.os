-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set({ "n", "v", "i" }, "<C-a>", "<Esc>ggVG", { desc = "Select All" })

vim.keymap.set("o", "f", function()
  if vim.v.operator == "y" then
    vim.fn.setreg("+", vim.fn.expand("%:p"))
    return "<Esc>"
  end
  return "f"
end, { expr = true, desc = "Yank file path (yf)" })
