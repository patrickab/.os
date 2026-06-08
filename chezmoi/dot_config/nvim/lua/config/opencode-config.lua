local M = {}

local global_dir = vim.fn.expand("~/.config/opencode")
local local_dir = vim.fn.expand("~/.os/chezmoi/dot_config/opencode")

if vim.fn.isdirectory(local_dir) == 0 then
  local_dir = nil
end

--- Git status cache: git_root -> { [absolute_path] = status_code }
local git_cache = {}

local function find_git_root(dir)
  local handle = io.popen("git -C " .. vim.fn.shellescape(dir) .. " rev-parse --show-toplevel 2>/dev/null")
  if not handle then
    return nil
  end
  local root = handle:read("*a"):gsub("%s+$", "")
  handle:close()
  if root == "" then
    return nil
  end
  return root
end

local function get_git_status_for_file(filepath)
  local dir = vim.fn.fnamemodify(filepath, ":h")
  local root = find_git_root(dir)
  if not root then
    return nil
  end
  if not git_cache[root] then
    local statuses = {}
    local handle = io.popen("git -C " .. vim.fn.shellescape(root) .. " status --porcelain 2>/dev/null")
    if handle then
      for line in handle:lines() do
        local code = line:sub(1, 2)
        local rel = line:sub(4)
        statuses[root .. "/" .. rel] = code
      end
      handle:close()
    end
    git_cache[root] = statuses
  end
  return git_cache[root][filepath]
end

local function badge_char(code)
  if not code then
    return nil
  end
  if code:find("M") then
    return "M"
  elseif code:find("%?") then
    return "?"
  elseif code:find("A") then
    return "A"
  elseif code:find("D") then
    return "D"
  elseif code:find("R") then
    return "R"
  end
  return nil
end

function M.get_project_root()
  local handle = io.popen("git rev-parse --show-toplevel 2>/dev/null")
  if not handle then
    return vim.fn.getcwd()
  end
  local result = handle:read("*a"):gsub("%s+$", "")
  handle:close()
  if result ~= "" then
    return result
  end
  return vim.fn.getcwd()
end

function M.get_project_skills_dir()
  local root = M.get_project_root()
  local dir = root .. "/.opencode/skills"
  if vim.fn.isdirectory(dir) == 1 then
    return dir
  end
  return nil
end

function M.get_config_file(dir)
  local jsonc = dir .. "/opencode.jsonc"
  local json = dir .. "/opencode.json"
  if vim.fn.filereadable(jsonc) == 1 then
    return jsonc
  elseif vim.fn.filereadable(json) == 1 then
    return json
  end
  return nil
end

function M.collect_entries()
  local entries = {}

  local function add(prefix, scope, name, path)
    local code = get_git_status_for_file(path)
    local badge = badge_char(code)
    local display
    if badge then
      display = string.format("%-7s %-7s %-24s %s", prefix, scope, name, badge)
    else
      display = string.format("%-7s %-7s %s", prefix, scope, name)
    end
    local ordinal = prefix .. " " .. scope .. " " .. name
    if badge then
      ordinal = ordinal .. " " .. badge
    end
    table.insert(entries, {
      prefix = prefix,
      scope = scope,
      name = name,
      path = path,
      badge = badge,
      display = display,
      ordinal = ordinal,
    })
  end

  local scopes = { "global", "local" }
  local function dir_for_scope(scope)
    return scope == "global" and global_dir or local_dir
  end

  for _, scope in ipairs(scopes) do
    local dir = dir_for_scope(scope)
    if dir then
      local path = M.get_config_file(dir)
      if path then
        add("config", scope, "opencode.jsonc", path)
      end
    end
  end

  for _, scope in ipairs(scopes) do
    local dir = dir_for_scope(scope)
    if dir then
      local cmd_dir = dir .. "/command"
      if vim.fn.isdirectory(cmd_dir) == 1 then
        local files = vim.fn.readdir(cmd_dir)
        for _, fname in ipairs(files) do
          local path = cmd_dir .. "/" .. fname
          if vim.fn.filereadable(path) == 1 then
            add("command", scope, fname:gsub("%.md$", ""), path)
          end
        end
      end
    end
  end

  for _, scope in ipairs(scopes) do
    local dir = dir_for_scope(scope)
    if dir then
      local skills_dir = dir .. "/skills"
      if vim.fn.isdirectory(skills_dir) == 1 then
        local skill_names = vim.fn.readdir(skills_dir)
        for _, sname in ipairs(skill_names) do
          local skill_path = skills_dir .. "/" .. sname .. "/SKILL.md"
          if vim.fn.filereadable(skill_path) == 1 then
            add("skill", scope, sname, skill_path)
          end
        end
      end
    end
  end

  local proj_skills_dir = M.get_project_skills_dir()
  if proj_skills_dir then
    local skill_names = vim.fn.readdir(proj_skills_dir)
    for _, sname in ipairs(skill_names) do
      local skill_path = proj_skills_dir .. "/" .. sname .. "/SKILL.md"
      if vim.fn.filereadable(skill_path) == 1 then
        add("skill", "project", sname, skill_path)
      end
    end
  end

  for _, scope in ipairs(scopes) do
    local dir = dir_for_scope(scope)
    if dir then
      local path = dir .. "/AGENTS.md"
      if vim.fn.filereadable(path) == 1 then
        add("agent", scope, "AGENTS", path)
      end
    end
  end

  return entries
end

--- Keybind actions

local function edit_in(buf_command, path)
  vim.cmd(buf_command)
  vim.cmd("edit " .. vim.fn.fnameescape(path))
end

local function confirm_delete(entry)
  local dir = vim.fn.fnamemodify(entry.path, ":h")
  local list_cmd = "ls -la " .. vim.fn.shellescape(dir)
  if entry.prefix == "skill" then
    local files = vim.fn.readdir(dir)
    vim.notify(string.format("Skill '%s' (%d files):", entry.name, #files), vim.log.levels.INFO)
  end
  vim.ui.input({ prompt = string.format("Delete '%s'? (y/N): ", entry.name) }, function(input)
    if input and input:lower() == "y" then
      if entry.prefix == "skill" then
        vim.fn.delete(dir, "rf")
      else
        vim.fn.delete(entry.path)
      end
      vim.notify("Deleted: " .. entry.name, vim.log.levels.INFO)
    end
  end)
end

local function create_new()
  vim.ui.input({ prompt = "Create (skill/command): " }, function(entry_type)
    if not entry_type or entry_type == "" then
      return
    end
    vim.ui.input({ prompt = "Name: " }, function(name)
      if not name or name == "" then
        return
      end
      local base = global_dir
      if not base then
        vim.notify("Global config dir not found", vim.log.levels.ERROR)
        return
      end
      local filepath
      local content

      if entry_type == "skill" then
        filepath = base .. "/skills/" .. name .. "/SKILL.md"
        content = "# " .. name .. "\n\n"
      elseif entry_type == "command" then
        filepath = base .. "/command/" .. name .. ".md"
        content = "---\ndescription: \n---\n\n"
      else
        vim.notify("Unknown type: " .. entry_type, vim.log.levels.ERROR)
        return
      end

      vim.fn.mkdir(vim.fn.fnamemodify(filepath, ":h"), "p")
      vim.fn.writefile(vim.split(content, "\n", true), filepath)
      vim.cmd("edit " .. vim.fn.fnameescape(filepath))
    end)
  end)
end

function M.open_picker(opts)
  opts = opts or {}
  local entries = M.collect_entries()

  if #entries == 0 then
    vim.notify("No opencode config entries found", vim.log.levels.WARN)
    return
  end

  local pickers = require("telescope.pickers")
  local finders = require("telescope.finders")
  local previewers = require("telescope.previewers")
  local actions = require("telescope.actions")
  local action_state = require("telescope.actions.state")
  local conf = require("telescope.config").values

  local entry_count = #entries

  pickers.new(opts, {
    prompt_title = "OpenCode Configs",
    results_title = string.format("e=edit v=vsp x=sp t=tab d=del y=yank n=new [%d]", entry_count),
    finder = finders.new_table({
      results = entries,
      entry_maker = function(entry)
        return {
          entry.path,
          display = entry.display,
          ordinal = entry.ordinal,
          filename = entry.path,
          path = entry.path,
          value = entry.path,
          cwd = vim.fn.fnamemodify(entry.path, ":h"),
          prefix = entry.prefix,
          scope = entry.scope,
          name = entry.name,
          badge = entry.badge,
        }
      end,
    }),
    sorter = conf.generic_sorter(opts),
    previewer = conf.grep_previewer(opts),
    attach_mappings = function(prompt_bufnr, map)
      actions.select_default:replace(function()
        local selection = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if selection then
          vim.cmd("edit " .. vim.fn.fnameescape(selection.path))
        end
      end)

      map("i", "<C-v>", function()
        local selection = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if selection then
          edit_in("vsplit", selection.path)
        end
      end)

      map("i", "<C-x>", function()
        local selection = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if selection then
          edit_in("split", selection.path)
        end
      end)

      map("i", "<C-t>", function()
        local selection = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if selection then
          edit_in("tabnew", selection.path)
        end
      end)

      map("i", "<C-d>", function()
        local selection = action_state.get_selected_entry()
        actions.close(prompt_bufnr)
        if selection then
          confirm_delete(selection)
        end
      end)

      map("i", "<C-y>", function()
        local selection = action_state.get_selected_entry()
        if selection then
          vim.fn.setreg("+", selection.path)
          vim.notify("Copied: " .. selection.path, vim.log.levels.INFO)
        end
      end)

      map("i", "<C-n>", function()
        actions.close(prompt_bufnr)
        create_new()
      end)

      return true
    end,
  }):find()
end

return M
