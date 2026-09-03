-- Transparency toggle (<leader>ut / :TransparencyToggle).
--
-- The colorscheme owns every background it paints, via bg_or_none() driven by
-- g:oh_lucy_evening_transparent_background. So toggling is just: flip the flag,
-- re-apply. Third-party groups either link to Normal/NormalFloat or are already
-- defined by the scheme, so they follow along on their own -- no sweep needed.

if vim.g.transparency_enabled == nil then
  vim.g.transparency_enabled = true
end

local function apply()
  vim.g.oh_lucy_evening_transparent_background = vim.g.transparency_enabled and 1 or 0
  -- Applied by name, not via g:colors_name, so a lost colors_name still recovers.
  vim.cmd.colorscheme("oh-lucy-evening-custom")
end

vim.api.nvim_create_user_command("TransparencyToggle", function()
  vim.g.transparency_enabled = not vim.g.transparency_enabled
  apply()
  vim.notify("Transparency " .. (vim.g.transparency_enabled and "enabled" or "disabled"))
end, { desc = "Toggle editor transparency", force = true })

vim.keymap.set("n", "<leader>ut", "<cmd>TransparencyToggle<cr>", { desc = "Toggle Transparency" })

apply()
