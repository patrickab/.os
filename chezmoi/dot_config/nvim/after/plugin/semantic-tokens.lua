vim.lsp.semantic_tokens.enable()

vim.api.nvim_create_user_command("SemanticTokensToggle", function()
  local enabled = not vim.lsp.semantic_tokens.is_enabled()
  vim.lsp.semantic_tokens.enable(enabled)
  vim.notify("Semantic tokens " .. (enabled and "enabled" or "disabled"))
end, { desc = "Toggle LSP semantic token highlighting", force = true })

vim.keymap.set("n", "<leader>uk", "<cmd>SemanticTokensToggle<cr>", { desc = "Toggle Semantic Tokens" })
