local M = {}

local canonical_dir = vim.fn.expand("~/.os/chezmoi/dot_agents")
local deployed_dir = vim.fn.expand("~/.config/opencode")

if vim.fn.isdirectory(canonical_dir) == 0 then
  canonical_dir = nil
end

local git_cache = {}

local function git_root(dir)
  local h = io.popen("git -C " .. vim.fn.shellescape(dir) .. " rev-parse --show-toplevel 2>/dev/null")
  if not h then
    return nil
  end
  local root = h:read("*a"):gsub("%s+$", "")
  h:close()
  return root ~= "" and root or nil
end

local function git_badge(filepath)
  local dir = vim.fn.fnamemodify(filepath, ":h")
  local root = git_root(dir)
  if not root then
    return nil
  end
  if not git_cache[root] then
    local statuses = {}
    local h = io.popen("git -C " .. vim.fn.shellescape(root) .. " status --porcelain 2>/dev/null")
    if h then
      for line in h:lines() do
        statuses[root .. "/" .. line:sub(4)] = line:sub(1, 2)
      end
      h:close()
    end
    git_cache[root] = statuses
  end
  local code = git_cache[root][filepath]
  if not code then
    return nil
  end
  for _, pair in ipairs({ { "M", "M" }, { "%?", "?" }, { "A", "A" }, { "D", "D" }, { "R", "R" } }) do
    if code:find(pair[1]) then
      return pair[2]
    end
  end
  return nil
end

local function project_root()
  local h = io.popen("git rev-parse --show-toplevel 2>/dev/null")
  if not h then
    return vim.fn.getcwd()
  end
  local result = h:read("*a"):gsub("%s+$", "")
  h:close()
  return result ~= "" and result or vim.fn.getcwd()
end

local function scan_skills(dir, scope, entries)
  local skills_dir = dir .. "/skills"
  if vim.fn.isdirectory(skills_dir) == 0 then
    return
  end
  for _, name in ipairs(vim.fn.readdir(skills_dir)) do
    local path = skills_dir .. "/" .. name .. "/SKILL.md"
    if vim.fn.filereadable(path) == 1 then
      table.insert(entries, { kind = "skill", scope = scope, name = name, path = path })
    end
  end
end

local function scan_commands(dir, scope, entries)
  local cmd_dir = dir .. "/commands"
  if vim.fn.isdirectory(cmd_dir) == 1 then
    for _, name in ipairs(vim.fn.readdir(cmd_dir)) do
      local path = cmd_dir .. "/" .. name .. "/SKILL.md"
      if vim.fn.filereadable(path) == 1 then
        table.insert(entries, { kind = "cmd", scope = scope, name = name, path = path })
      end
    end
    return
  end
  cmd_dir = dir .. "/command"
  if vim.fn.isdirectory(cmd_dir) == 1 then
    for _, fname in ipairs(vim.fn.readdir(cmd_dir)) do
      local path = cmd_dir .. "/" .. fname
      if vim.fn.filereadable(path) == 1 then
        table.insert(entries, { kind = "cmd", scope = scope, name = fname:gsub("%.md$", ""), path = path })
      end
    end
  end
end

function M.collect_entries()
  local entries = {}

  if canonical_dir then
    if vim.fn.filereadable(canonical_dir .. "/AGENTS.md") == 1 then
      table.insert(entries, { kind = "rules", scope = "source", name = "AGENTS.md", path = canonical_dir .. "/AGENTS.md" })
    end
    scan_skills(canonical_dir, "source", entries)
    scan_commands(canonical_dir, "source", entries)
  end

  local deployed_agents = deployed_dir .. "/AGENTS.md"
  if vim.fn.filereadable(deployed_agents) == 1 then
    table.insert(entries, { kind = "rules", scope = "deployed", name = "AGENTS.md", path = deployed_agents })
  end

  scan_skills(deployed_dir, "deployed", entries)
  scan_commands(deployed_dir, "deployed", entries)

  local root = project_root()
  for _, sub in ipairs({ ".agents", ".opencode" }) do
    local pdir = root .. "/" .. sub
    if vim.fn.isdirectory(pdir .. "/skills") == 1 then
      scan_skills(pdir, "project", entries)
      scan_commands(pdir, "project", entries)
      break
    end
  end

  return entries
end

local kind_icon = { skill = "󰯉", cmd = "", rules = "" }

local function format_entry(e)
  local icon = kind_icon[e.kind] or " "
  local badge = git_badge(e.path) or ""
  local badge_str = badge ~= "" and (" " .. badge) or ""
  return string.format("%s %-6s %-30s %s%s", icon, e.kind, e.name, e.scope, badge_str)
end

local function edit_in(cmd, path)
  vim.cmd(cmd)
  vim.cmd("edit " .. vim.fn.fnameescape(path))
end

local function confirm_delete(entry)
  local dir = vim.fn.fnamemodify(entry.path, ":h")
  vim.ui.input({ prompt = string.format("Delete '%s'? (y/N): ", entry.name) }, function(input)
    if input and input:lower() == "y" then
      if entry.kind == "skill" or entry.kind == "cmd" then
        vim.fn.delete(dir, "rf")
      else
        vim.fn.delete(entry.path)
      end
      vim.notify("Deleted: " .. entry.name, vim.log.levels.INFO)
    end
  end)
end

local function create_new()
  vim.ui.select({ "skill", "command" }, { prompt = "Create:" }, function(kind)
    if not kind then
      return
    end
    vim.ui.input({ prompt = "Name: " }, function(name)
      if not name or name == "" then
        return
      end
      if not canonical_dir then
        vim.notify("Canonical .agents dir not found", vim.log.levels.ERROR)
        return
      end
      local subdir = kind == "command" and "commands" or "skills"
      local filepath = canonical_dir .. "/" .. subdir .. "/" .. name .. "/SKILL.md"
      local content = "---\nname: " .. name .. "\ndescription: \n---\n\n"
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
    vim.notify("No agent config entries found", vim.log.levels.WARN)
    return
  end

  local pickers = require("telescope.pickers")
  local finders = require("telescope.finders")
  local actions = require("telescope.actions")
  local action_state = require("telescope.actions.state")
  local conf = require("telescope.config").values

  pickers
    .new(opts, {
      prompt_title = "Agent Config",
      results_title = string.format("⏎=edit ^v=vsp ^x=sp ^t=tab ^d=del ^y=yank ^n=new [%d]", #entries),
      finder = finders.new_table({
        results = entries,
        entry_maker = function(e)
          return {
            display = format_entry(e),
            ordinal = e.name .. " " .. e.kind .. " " .. e.scope,
            filename = e.path,
            path = e.path,
            value = e,
            kind = e.kind,
            scope = e.scope,
            name = e.name,
          }
        end,
      }),
      sorter = conf.generic_sorter(opts),
      previewer = conf.grep_previewer(opts),
      attach_mappings = function(prompt_bufnr, map)
        actions.select_default:replace(function()
          local sel = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if sel then
            vim.cmd("edit " .. vim.fn.fnameescape(sel.path))
          end
        end)

        map("i", "<C-v>", function()
          local sel = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if sel then
            edit_in("vsplit", sel.path)
          end
        end)

        map("i", "<C-x>", function()
          local sel = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if sel then
            edit_in("split", sel.path)
          end
        end)

        map("i", "<C-t>", function()
          local sel = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if sel then
            edit_in("tabnew", sel.path)
          end
        end)

        map("i", "<C-d>", function()
          local sel = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if sel then
            confirm_delete(sel)
          end
        end)

        map("i", "<C-y>", function()
          local sel = action_state.get_selected_entry()
          if sel then
            vim.fn.setreg("+", sel.path)
            vim.notify("Copied: " .. sel.path, vim.log.levels.INFO)
          end
        end)

        map("i", "<C-n>", function()
          actions.close(prompt_bufnr)
          create_new()
        end)

        return true
      end,
    })
    :find()
end

return M
