--- Presents closed Python functions as one highlighted signature plus a virtual return-type line.
--- Wrapped signatures otherwise disappear behind nvim-ufo's single fold row, making annotated code
--- hard to scan without reopening folds.

local return_type_ns = vim.api.nvim_create_namespace("fold-return-type")

local function scan_signature(first, last, get_chunks)
  local signature = {}
  local depth = 0
  local opened = false

  for lnum = first, last do
    local chunks = get_chunks(lnum)
    local line = {}
    for _, chunk in ipairs(chunks) do
      line[#line + 1] = chunk[1]
    end
    local return_type = table.concat(line):match("%-%>%s*(.-):%s*$")

    if lnum > first then
      signature[#signature + 1] = { " ", "NonText" }
    end
    for i, chunk in ipairs(chunks) do
      local text = lnum > first and i == 1 and chunk[1]:gsub("^%s+", "") or chunk[1]
      local close_at
      for byte = 1, #text do
        local char = text:sub(byte, byte)
        if char == "(" then
          depth = depth + 1
          opened = true
        elseif char == ")" and opened then
          depth = depth - 1
          if depth == 0 then
            close_at = byte
            break
          end
        end
      end

      signature[#signature + 1] = { close_at and text:sub(1, close_at) or text, chunk[2] }
      if close_at then
        return signature, return_type
      end
    end

    if not opened or depth == 0 then
      return signature, return_type
    end
  end

  return signature
end

local function fit_with_suffix(chunks, suffix, width, truncate)
  local suffix_width = 0
  for _, chunk in ipairs(suffix) do
    suffix_width = suffix_width + vim.fn.strdisplaywidth(chunk[1])
  end

  local target = width - suffix_width
  local result = {}
  local used = 0
  for _, chunk in ipairs(chunks) do
    local chunk_width = vim.fn.strdisplaywidth(chunk[1])
    if target > used + chunk_width then
      result[#result + 1] = chunk
      used = used + chunk_width
    else
      result[#result + 1] = { truncate(chunk[1], target - used), chunk[2] }
      break
    end
  end

  return vim.list_extend(result, suffix)
end

local function refresh_return_types()
  local bufnr = vim.api.nvim_get_current_buf()
  if vim.bo[bufnr].filetype ~= "python" then
    return
  end

  -- A closed fold cannot host virt_lines; anchor above the following line.
  local last_line = vim.api.nvim_buf_line_count(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, return_type_ns, 0, -1)

  local lnum = vim.fn.line("w0")
  local window_end = vim.fn.line("w$")
  while lnum <= window_end do
    if vim.fn.foldclosed(lnum) == lnum then
      local fold_end = vim.fn.foldclosedend(lnum)
      local scan_end = math.min(fold_end, lnum + 30)
      local lines = vim.api.nvim_buf_get_lines(bufnr, lnum - 1, scan_end, false)
      local def_line = lines[1] or ""
      if def_line:match("^%s*def%s") then
        local _, return_type = scan_signature(lnum, scan_end, function(line_number)
          return { { lines[line_number - lnum + 1] or "", "Normal" } }
        end)

        -- EOF folds have no following line for the extmark anchor.
        if fold_end < last_line then
          if return_type then
            local indent = (def_line:match("^%s*") or "") .. "    "
            vim.api.nvim_buf_set_extmark(bufnr, return_type_ns, fold_end, 0, {
              virt_lines = { { { indent, "Normal" }, { "→ ", "@comment" }, { return_type, "Type" } } },
              virt_lines_above = true,
            })
          end
        end
      end
      lnum = fold_end + 1
    else
      lnum = lnum + 1
    end
  end
end

local function toggle_all_folds()
  local ufo = require("ufo")
  if vim.b.ufo_all_closed then
    ufo.openAllFolds()
  else
    ufo.closeAllFolds()
  end
  vim.b.ufo_all_closed = not vim.b.ufo_all_closed
  -- UFO applies fold changes on the next tick.
  vim.schedule(refresh_return_types)
end

return {
  {
    -- which-key's "z" preset labels every native fold/spell/scroll motion;
    -- disabling it only hides them from the popup, zt/z=/zg/etc. still work.
    "folke/which-key.nvim",
    opts = {
      plugins = { presets = { z = false } },
      spec = {
        { "za", desc = "Toggle fold under cursor" },
        { "zA", desc = "Toggle all folds under cursor" },
      },
    },
  },
  {
    "kevinhwang91/nvim-ufo",
    dependencies = { "kevinhwang91/promise-async" },
    event = "BufReadPost",
    -- UFO needs foldlevel 99 to own startup fold state.
    init = function()
      vim.o.fillchars = "eob: ,fold: ,foldopen:,foldsep: ,foldinner: ,foldclose:"
      vim.o.foldcolumn = "1"
      vim.o.foldlevel = 99
      vim.o.foldlevelstart = 99
      vim.o.foldenable = true
    end,
    opts = {
      provider_selector = function()
        return { "treesitter", "indent" }
      end,
      enable_get_fold_virt_text = true,
      fold_virt_text_handler = function(virt_text, lnum, end_lnum, width, truncate, ctx)
        local signature = scan_signature(lnum, end_lnum, function(line_number)
          return line_number == lnum and virt_text or ctx.get_fold_virt_text(line_number)
        end)

        local suffix = { { " 󰁂  ", "@comment" }, { ("  %d lines"):format(end_lnum - lnum), "NonText" } }
        return fit_with_suffix(signature, suffix, width, truncate)
      end,
    },
    config = function(_, opts)
      require("ufo").setup(opts)
      local group = vim.api.nvim_create_augroup("fold_return_type", { clear = true })
      vim.api.nvim_create_autocmd({ "BufWinEnter", "WinScrolled", "CursorMoved", "TextChanged" }, {
        group = group,
        callback = refresh_return_types,
      })
    end,
    keys = {
      { "<leader>cc", toggle_all_folds, desc = "Code Collapse (toggle all folds)" },
      { "zf", toggle_all_folds, desc = "Toggle all folds (open/close)" },
      {
        "<leader>cp",
        function()
          require("ufo").peekFoldedLinesUnderCursor()
        end,
        desc = "Code Peek (preview fold under cursor)",
      },
      {
        "<leader>cf",
        function()
          vim.cmd("normal! za")
          vim.schedule(refresh_return_types)
        end,
        desc = "Code Fold (toggle fold under cursor)",
      },
    },
  },
}
