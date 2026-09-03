-- Apply ruff's source actions in order, synchronously.
--
-- `source.fixAll.ruff` does not sort imports unless the project selects the `I`
-- rules, so import organizing is requested separately and first. Each request
-- blocks until its edit is applied; firing both asynchronously would let the
-- second compute its range against a stale document version and be dropped.
local function ruff_fix_all(bufnr)
  local client = vim.lsp.get_clients({ bufnr = bufnr, name = "ruff" })[1]
  if not client then
    vim.notify("ruff is not attached to this buffer", vim.log.levels.WARN)
    return
  end

  for _, kind in ipairs({ "source.organizeImports.ruff", "source.fixAll.ruff" }) do
    local params = vim.lsp.util.make_range_params(0, client.offset_encoding)
    params.context = { only = { kind }, diagnostics = {} }

    local res = client:request_sync("textDocument/codeAction", params, 2000, bufnr)
    for _, action in pairs(res and res.result or {}) do
      -- ruff advertises resolveProvider, so actions arrive without their edit
      if not action.edit then
        local resolved = client:request_sync("codeAction/resolve", action, 2000, bufnr)
        action = resolved and resolved.result or action
      end
      if action.edit then
        vim.lsp.util.apply_workspace_edit(action.edit, client.offset_encoding)
      end
    end
  end
end

return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- mason still installs it; disable to avoid a second server
        pyright = { enabled = false },
        -- needed for parameter semantic tokens; ruff lints, mypy types
        basedpyright = {
          settings = {
            basedpyright = {
              analysis = {
                typeCheckingMode = "off",
              },
            },
          },
          handlers = {
            ["textDocument/publishDiagnostics"] = function() end,
          },
        },
        ruff = {
          keys = {
            {
              "<leader>ca",
              function()
                ruff_fix_all(vim.api.nvim_get_current_buf())
              end,
              desc = "Ruff: fix all + organize imports",
            },
          },
          on_attach = function(client, _)
            client.server_capabilities.hoverProvider = false
          end,
        },
      },
    },
  },
}
