-- Lets lualine's auto theme follow this colorscheme and transparency.

local function attr(group, key)
  local hl = vim.api.nvim_get_hl(0, { name = group, link = false })
  return hl[key] and string.format("#%06x", hl[key])
end

local accent = {
  normal = attr("Type", "fg"),
  insert = attr("Function", "fg"),
  visual = attr("Constant", "fg"),
  replace = attr("Keyword", "fg"),
  command = attr("String", "fg"),
}

local editor = attr("Normal", "bg") or "NONE"
local ink = attr("StatusLineTerm", "bg")
local muted = attr("Comment", "fg")

local function mode(color)
  return {
    -- The mode pill is the only painted block.
    a = { bg = color, fg = ink, gui = "bold" },
    b = { bg = editor, fg = color },
    c = { bg = editor, fg = muted },
  }
end

return {
  normal = mode(accent.normal),
  insert = mode(accent.insert),
  visual = mode(accent.visual),
  replace = mode(accent.replace),
  command = mode(accent.command),
  terminal = mode(accent.insert),
  inactive = {
    a = { bg = editor, fg = muted },
    b = { bg = editor, fg = muted },
    c = { bg = editor, fg = muted },
  },
}
