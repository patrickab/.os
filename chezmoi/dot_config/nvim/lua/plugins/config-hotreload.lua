-- Reload this config when Chezmoi or an editor changes a file below ~/.config/nvim.
return {
  {
    name = "config-hotreload",
    dir = vim.fn.stdpath("config"),
    lazy = false,
    priority = 1000,
    config = function()
      local config_dir = vim.fn.stdpath("config")
      local uv = vim.uv or vim.loop
      local state = _G.config_hotreload or {}
      _G.config_hotreload = state

      for _, watcher in ipairs(state.watchers or {}) do
        watcher:stop()
        watcher:close()
      end
      if state.timer then
        state.timer:stop()
        state.timer:close()
      end
      state.watchers = {}

      local function apply_theme()
        package.loaded["plugins.theme"] = nil
        local ok, theme = pcall(require, "plugins.theme")
        local colorscheme = ok and theme[1] and theme[1].opts and theme[1].opts.colorscheme
        if colorscheme then
          pcall(vim.cmd.colorscheme, colorscheme)
        end

        local transparency = config_dir .. "/after/plugin/transparency.lua"
        if vim.fn.filereadable(transparency) == 1 then
          vim.cmd.source(transparency)
        end
        vim.cmd("redraw!")
      end


      local timer = uv.new_timer()
      state.timer = timer
      local function schedule_reload()
        timer:stop()
        timer:start(150, 0, vim.schedule_wrap(apply_theme))
      end

      -- ponytail: libuv needs one watcher per directory on Linux; no plugin dependency.
      local directories = { config_dir }
      for _, path in ipairs(vim.fn.globpath(config_dir, "**", false, true)) do
        if vim.fn.isdirectory(path) == 1 then
          table.insert(directories, path)
        end
      end
      for _, directory in ipairs(directories) do
        local watcher = uv.new_fs_event()
        watcher:start(directory, {}, vim.schedule_wrap(schedule_reload))
        table.insert(state.watchers, watcher)
      end
    end,
  },
}
