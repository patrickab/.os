require("config.lazy")

vim.keymap.set("n", "<Tab>", ":bnext<CR>", { noremap = true, silent = true })
vim.keymap.set("n", "<S-Tab>", ":bprevious<CR>", { noremap = true, silent = true })

vim.keymap.set("n", "<C-Down>", ":resize +2<CR>", { silent = true })
vim.keymap.set("n", "<C-Up>", ":resize -2<CR>", { silent = true })
vim.keymap.set("n", "<C-Right>", ":vertical resize -2<CR>", { silent = true })
vim.keymap.set("n", "<C-Left>", ":vertical resize +2<CR>", { silent = true })

vim.keymap.set("n", "<A-Down>", ":m .+1<CR>==", { desc = "Move line down" })
vim.keymap.set("n", "<A-Up>", ":m .-2<CR>==", { desc = "Move line up" })

vim.opt.whichwrap:append({
  ["<"] = true,
  [">"] = true,
  ["["] = true,
  ["]"] = true,
  h = true,
  l = true,
})
