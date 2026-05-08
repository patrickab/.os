return {
  { "Mofiqul/vscode.nvim", lazy = true, priority = 1000 },
  {
    name = "vscode-syntax-overlay",
    dir = vim.fn.stdpath("config"),
    lazy = false,
    priority = 1000,
    dependencies = { "Mofiqul/vscode.nvim" },
    config = function()
      local vsc_colors
      local function apply_vscode_syntax()
        local ok, colors = pcall(require, "vscode.colors")
        if not ok then
          vsc_colors = nil
          return
        end
        vsc_colors = colors.get_colors()
        local c = vsc_colors
        local function hl(group, spec)
          vim.api.nvim_set_hl(0, group, spec)
        end

        hl("Comment", { fg = c.vscGreen, bg = "NONE", italic = true })
        hl("Constant", { fg = c.vscBlue, bg = "NONE" })
        hl("String", { fg = c.vscOrange, bg = "NONE" })
        hl("Character", { fg = c.vscOrange, bg = "NONE" })
        hl("Number", { fg = c.vscLightGreen, bg = "NONE" })
        hl("Boolean", { fg = c.vscBlue, bg = "NONE" })
        hl("Float", { fg = c.vscLightGreen, bg = "NONE" })
        hl("Identifier", { fg = c.vscLightBlue, bg = "NONE" })
        hl("Function", { fg = c.vscYellow, bg = "NONE" })
        hl("Statement", { fg = c.vscPink, bg = "NONE" })
        hl("Conditional", { fg = c.vscPink, bg = "NONE" })
        hl("Repeat", { fg = c.vscPink, bg = "NONE" })
        hl("Label", { fg = c.vscPink, bg = "NONE" })
        hl("Operator", { fg = c.vscFront, bg = "NONE" })
        hl("Keyword", { fg = c.vscPink, bg = "NONE" })
        hl("Exception", { fg = c.vscPink, bg = "NONE" })
        hl("PreProc", { fg = c.vscPink, bg = "NONE" })
        hl("Include", { fg = c.vscPink, bg = "NONE" })
        hl("Define", { fg = c.vscPink, bg = "NONE" })
        hl("Macro", { fg = c.vscPink, bg = "NONE" })
        hl("Type", { fg = c.vscBlue, bg = "NONE" })
        hl("StorageClass", { fg = c.vscBlue, bg = "NONE" })
        hl("Structure", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("Typedef", { fg = c.vscBlue, bg = "NONE" })
        hl("Special", { fg = c.vscYellowOrange, bg = "NONE" })
        hl("SpecialChar", { fg = c.vscFront, bg = "NONE" })
        hl("Tag", { fg = c.vscFront, bg = "NONE" })
        hl("Delimiter", { fg = c.vscFront, bg = "NONE" })
        hl("SpecialComment", { fg = c.vscGreen, bg = "NONE" })

        hl("@punctuation.bracket", { fg = c.vscFront, bg = "NONE" })
        hl("@punctuation.special", { fg = c.vscFront, bg = "NONE" })
        hl("@punctuation.delimiter", { fg = c.vscFront, bg = "NONE" })
        hl("@comment", { fg = c.vscGreen, bg = "NONE", italic = true })
        hl("@comment.note", { fg = c.vscBlueGreen, bg = "NONE", bold = true })
        hl("@comment.warning", { fg = c.vscYellowOrange, bg = "NONE", bold = true })
        hl("@comment.error", { fg = c.vscRed, bg = "NONE", bold = true })
        hl("@constant", { fg = c.vscAccentBlue, bg = "NONE" })
        hl("@constant.builtin", { fg = c.vscBlue, bg = "NONE" })
        hl("@constant.macro", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("@string.regexp", { fg = c.vscOrange, bg = "NONE" })
        hl("@string", { fg = c.vscOrange, bg = "NONE" })
        hl("@string.documentation", { fg = c.vscOrange, bg = "NONE" })
        hl("@character", { fg = c.vscOrange, bg = "NONE" })
        hl("@number", { fg = c.vscLightGreen, bg = "NONE" })
        hl("@number.float", { fg = c.vscLightGreen, bg = "NONE" })
        hl("@boolean", { fg = c.vscBlue, bg = "NONE" })
        hl("@annotation", { fg = c.vscYellow, bg = "NONE" })
        hl("@attribute", { fg = c.vscYellow, bg = "NONE" })
        hl("@attribute.builtin", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("@module", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("@function", { fg = c.vscYellow, bg = "NONE" })
        hl("@function.builtin", { fg = c.vscYellow, bg = "NONE" })
        hl("@function.macro", { fg = c.vscYellow, bg = "NONE" })
        hl("@function.method", { fg = c.vscYellow, bg = "NONE" })
        hl("@variable", { fg = c.vscLightBlue, bg = "NONE" })
        hl("@variable.builtin", { fg = c.vscBlue, bg = "NONE" })
        hl("@variable.parameter", { fg = c.vscLightBlue, bg = "NONE" })
        hl("@variable.member", { fg = c.vscLightBlue, bg = "NONE" })
        hl("@property", { fg = c.vscLightBlue, bg = "NONE" })
        hl("@constructor", { fg = c.vscBlue, bg = "NONE" })
        hl("@label", { fg = c.vscLightBlue, bg = "NONE" })
        hl("@keyword", { fg = c.vscBlue, bg = "NONE" })
        hl("@keyword.conditional", { fg = c.vscPink, bg = "NONE" })
        hl("@keyword.repeat", { fg = c.vscPink, bg = "NONE" })
        hl("@keyword.return", { fg = c.vscPink, bg = "NONE" })
        hl("@keyword.exception", { fg = c.vscPink, bg = "NONE" })
        hl("@keyword.import", { fg = c.vscPink, bg = "NONE" })
        hl("@keyword.function", { fg = c.vscPink, bg = "NONE" })
        hl("@operator", { fg = c.vscFront, bg = "NONE" })
        hl("@type", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("@type.builtin", { fg = c.vscBlue, bg = "NONE" })
        hl("@type.qualifier", { fg = c.vscBlue, bg = "NONE" })
        hl("@tag", { fg = c.vscBlue, bg = "NONE" })
        hl("@tag.delimiter", { fg = c.vscGray, bg = "NONE" })
        hl("@tag.attribute", { fg = c.vscLightBlue, bg = "NONE" })

        hl("@diff.plus", { link = "DiffAdd" })
        hl("@diff.minus", { link = "DiffDelete" })
        hl("@diff.delta", { link = "DiffChange" })

        hl("@markup.strong", { fg = c.vscBlue, bold = true })
        hl("@markup.italic", { fg = c.vscFront, bg = "NONE", italic = true })
        hl("@markup.underline", { fg = c.vscYellowOrange, bg = "NONE", underline = true })
        hl("@markup.strikethrough", { fg = c.vscFront, bg = "NONE", strikethrough = true })
        hl("@markup.heading", { fg = c.vscBlue, bold = true })
        hl("@markup.raw", { fg = c.vscOrange, bg = "NONE" })

        -- Python-specific
        hl("pythonStatement", { fg = c.vscBlue, bg = "NONE" })
        hl("pythonOperator", { fg = c.vscBlue, bg = "NONE" })
        hl("pythonException", { fg = c.vscPink, bg = "NONE" })
        hl("pythonExClass", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("pythonBuiltinObj", { fg = c.vscLightBlue, bg = "NONE" })
        hl("pythonBuiltinType", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("pythonBoolean", { fg = c.vscBlue, bg = "NONE" })
        hl("pythonNone", { fg = c.vscBlue, bg = "NONE" })
        hl("pythonClassVar", { fg = c.vscBlue, bg = "NONE" })
        hl("pythonClassDef", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("@constructor.python", { fg = c.vscBlueGreen, bg = "NONE" })

        -- JS/TS
        hl("jsVariableDef", { fg = c.vscLightBlue, bg = "NONE" })
        hl("jsFuncArgs", { fg = c.vscLightBlue, bg = "NONE" })
        hl("jsThis", { fg = c.vscBlue, bg = "NONE" })
        hl("jsOperatorKeyword", { fg = c.vscBlue, bg = "NONE" })
        hl("jsObjectKey", { fg = c.vscLightBlue, bg = "NONE" })
        hl("jsGlobalObjects", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("jsFuncCall", { fg = c.vscYellow, bg = "NONE" })
        hl("jsClassKeyword", { fg = c.vscBlue, bg = "NONE" })
        hl("jsClassDefinition", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("jsExtendsKeyword", { fg = c.vscBlue, bg = "NONE" })
        hl("jsExportDefault", { fg = c.vscPink, bg = "NONE" })
        hl("typescriptClassName", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("typescriptExport", { fg = c.vscPink, bg = "NONE" })
        hl("typescriptImport", { fg = c.vscPink, bg = "NONE" })
        hl("typescriptFuncKeyword", { fg = c.vscBlue, bg = "NONE" })
        hl("typescriptInterfaceKeyword", { fg = c.vscBlue, bg = "NONE" })
        hl("typescriptTypeReference", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("typescriptPredefinedType", { fg = c.vscBlueGreen, bg = "NONE" })

        -- HTML/CSS
        hl("htmlTagName", { fg = c.vscBlue, bg = "NONE" })
        hl("htmlArg", { fg = c.vscLightBlue, bg = "NONE" })
        hl("cssTagName", { fg = c.vscYellowOrange, bg = "NONE" })
        hl("cssClassName", { fg = c.vscYellowOrange, bg = "NONE" })
        hl("cssProp", { fg = c.vscLightBlue, bg = "NONE" })
        hl("cssAttr", { fg = c.vscOrange, bg = "NONE" })
        hl("cssFunction", { fg = c.vscOrange, bg = "NONE" })
        hl("cssFunctionName", { fg = c.vscOrange, bg = "NONE" })

        -- JSON/YAML/TOML
        hl("jsonKeyword", { fg = c.vscLightBlue, bg = "NONE" })
        hl("yamlKey", { fg = c.vscBlue, bg = "NONE" })

        -- Markdown
        hl("markdownCode", { fg = c.vscOrange, bg = "NONE" })
        hl("markdownBold", { fg = c.vscBlue, bold = true })

        -- Git commits
        hl("gitcommitSummary", { fg = c.vscPink, bg = "NONE" })

        -- Lua
        hl("luaFuncCall", { fg = c.vscYellow, bg = "NONE" })
        hl("luaFuncKeyword", { fg = c.vscPink, bg = "NONE" })
        hl("luaLocal", { fg = c.vscPink, bg = "NONE" })
        hl("luaBuiltIn", { fg = c.vscBlue, bg = "NONE" })

        -- SH/Bash
        hl("shDeref", { fg = c.vscLightBlue, bg = "NONE" })
        hl("shVariable", { fg = c.vscLightBlue, bg = "NONE" })

        -- Go
        hl("goStatement", { fg = c.vscPink, bg = "NONE" })
        hl("goPackage", { fg = c.vscBlue, bg = "NONE" })
        hl("goImport", { fg = c.vscBlue, bg = "NONE" })
        hl("goType", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("goBuiltins", { fg = c.vscYellow, bg = "NONE" })
        hl("goFunctionCall", { fg = c.vscYellow, bg = "NONE" })

        -- Rainbow delimiters
        hl("RainbowDelimiterRed", { fg = c.vscPink, bg = "NONE" })
        hl("RainbowDelimiterOrange", { fg = c.vscOrange, bg = "NONE" })
        hl("RainbowDelimiterYellow", { fg = c.vscYellowOrange, bg = "NONE" })
        hl("RainbowDelimiterGreen", { fg = c.vscGreen, bg = "NONE" })
        hl("RainbowDelimiterCyan", { fg = c.vscBlueGreen, bg = "NONE" })
        hl("RainbowDelimiterBlue", { fg = c.vscMediumBlue, bg = "NONE" })
        hl("RainbowDelimiterViolet", { fg = c.vscViolet, bg = "NONE" })
      end

      -- Apply on load
      apply_vscode_syntax()

      -- Re-apply on theme change so hot-reload picks it up
      vim.api.nvim_create_autocmd("ColorScheme", {
        group = vim.api.nvim_create_augroup("VSCodeSyntaxOverlay", {}),
        callback = function()
          -- small delay so the new colorscheme has fully applied
          vim.defer_fn(function()
            pcall(apply_vscode_syntax)
          end, 50)
        end,
      })
    end,
  },
}
