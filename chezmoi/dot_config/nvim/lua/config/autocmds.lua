-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Hot-reload: re-source the whole config on save of any file under this config dir,
-- so options/keymaps/autocmds/plugin-spec tweaks (e.g. theme experiments) apply
-- without closing nvim. A brand-new plugin still needs one `:Lazy sync` afterwards.
vim.api.nvim_create_autocmd("BufWritePost", {
  group = vim.api.nvim_create_augroup("hot_reload_config", { clear = true }),
  pattern = "*.lua",
  callback = function(args)
    local config_dir = vim.fn.stdpath("config")
    local file = vim.fn.fnamemodify(args.file, ":p")
    if file:sub(1, #config_dir) ~= config_dir then
      return
    end
    for name, _ in pairs(package.loaded) do
      if name:match("^config%.") or name:match("^plugins%.") then
        package.loaded[name] = nil
      end
    end
    dofile(vim.env.MYVIMRC)
    vim.notify("nvim config reloaded", vim.log.levels.INFO)
  end,
})
