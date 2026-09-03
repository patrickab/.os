-- oh-lucy-evening-custom
--
-- A single-file colorscheme. Neovim sources colors/<name>.lua afresh on every
-- :colorscheme call, so everything below re-evaluates on each apply -- which is
-- what makes Themery, :TransparencyToggle and the config hot-reloader able to
-- re-apply it. (Splitting this across require()d modules is what previously
-- made every re-apply a silent no-op: require returns the cached module.)
--
-- Layout: options -> palette -> highlight table -> apply.
--
-- Options, all settable as globals before the scheme loads:
--   g:oh_lucy_evening_transparent_background   (default 0)
--   g:oh_lucy_evening_italic_comments          (default 1)
--   g:oh_lucy_evening_italic_keywords          (default 1)
--   g:oh_lucy_evening_italic_functions         (default 0)
--   g:oh_lucy_evening_italic_variables         (default 1)
--   g:oh_lucy_evening_italic_booleans          (default 0)

vim.g.colors_name = nil
vim.cmd 'highlight clear'
if vim.fn.exists 'syntax_on' == 1 then
  vim.cmd 'syntax reset'
end

vim.o.termguicolors = true
-- 'background' is deliberately NOT set here. Writing it from inside a
-- colorscheme re-enters Neovim's did_set_background handler, which resets the
-- default highlight groups and re-sources g:colors_name -- so the assignment
-- below on the last line gets clobbered and the scheme is left half-applied
-- with nvim's own (light) defaults. It is pinned in lua/config/options.lua.

-----------------------------------------
--        Options
-----------------------------------------

local function opt(key, default)
  key = 'oh_lucy_evening_' .. key
  if vim.g[key] == nil then
    return default
  end
  if vim.g[key] == 0 then
    return false
  end
  return vim.g[key]
end

local function italic(key, default)
  return opt(key, default) and 'italic' or 'NONE'
end

local config = {
  transparent_background = opt('transparent_background', false),
  italic_comments = italic('italic_comments', true),
  italic_keywords = italic('italic_keywords', true),
  italic_functions = italic('italic_functions', false),
  italic_variables = italic('italic_variables', true),
  italic_booleans = italic('italic_booleans', false),
}

-- Every group that paints editor chrome routes its background through this, so
-- transparency is a property of the scheme rather than something an external
-- script has to un-paint afterwards.
local function bg_or_none(value)
  return config.transparent_background and 'NONE' or value
end

-----------------------------------------
--        Palette
-----------------------------------------

local colors = {
  fg               = "#DED7D0",
  bg               = "#1E1D23",
  none             = "#1E1D23",
  --17161B
  dark             = '#1A191E',
  comment          = "#686069",
  popup_back       = '#515761',
  cursor_fg        = '#DED7D0',
  context          = '#515761',
  cursor_bg        = '#AEAFAD',
  accent           = '#BBBBBB',
  diff_add         = '#8CD881',
  diff_change      = '#6CAEC0',
  cl_bg            = "#524A51",
  diff_text        = '#568BB4',
  line_fg          = "#524A51",
  line_bg          = "#1E1D23",
  gutter_bg        = "#1E1D23",
  non_text         = "#7F737D",
  selection_bg     = "#817081",
  selection_fg     = "#615262",
  vsplit_fg        = "#cccccc",
  vsplit_bg        = "#2E2930",
  visual_select_bg = "#29292E",

  red_key_w  = "#FF7DA3",
  red_err    = "#D95555",
  green_func = '#7EC49D',
  green      = "#7EC49D",
  blue_type  = '#8BB8D0',
  black1     = "#29292E",
  black      = "#1A191E",
  white1     = "#DED7D0",
  white      = "#DED7D0",
  variable   = "#ABA6A4",
  gray_punc  = "#938884",
  gray2      = "#7F737D",
  gray1      = '#413E41',
  gray       = "#322F32",
  orange     = "#E0828D",
  boolean    = "#B898DD",
  orange_wr  = "#E39A65",
  pink       = "#BDA9D4",
  yellow     = "#EFD472",

}

-----------------------------------------
--        Highlight groups
-----------------------------------------

local theme = {}

theme.base = {
    ---------------------------------------
    --        Styles
    ---------------------------------------
    Bold = { style = 'bold' },
    Italic = { style = 'italic' },
    Underlined = { style = 'underline' },
    ---------------------------------------
    --        Editors settings
    -----------------------------------------
    Boolean = { fg = colors.boolean , style = config.italic_booleans},

    Character    = { fg = colors.yellow },
    ColorColumn  = { bg = colors.black1 },
    Comment      = { fg = colors.comment, style = config.italic_comments },
    Conceal      = { fg = colors.fg }, -- {bg = bg_or_none(colors.bg) },
    Conditional  = { fg = colors.red_key_w },
    Constant     = { fg = colors.pink },
    Cursor       = { fg = colors.yellow, bg = colors.bg },
    CursorColumn = { fg = "NONE", bg = "NONE" },
    -- CursorIM = { fg = colors.cursor_fg, bg = colors.cursor_bg },
    CursorLine   = { bg = colors.black1 },
    CursorLineNr = { fg = colors.white, bg = bg_or_none(colors.gutter_bg), style = 'bold' },

    Debug       = { fg = colors.fg },
    Define      = { fg = colors.blue_type },
    Delimiter   = { fg = colors.gray_punc },
    DiffAdd     = { fg = colors.diff_add, bg = colors.black1 },
    DiffAdded   = { fg = colors.diff_add },
    DiffChange  = { fg = colors.diff_change, bg = colors.black1 },
    DiffDelete  = { fg = colors.red_err, bg = colors.black1 },
    DiffRemoved = { fg = colors.red_err },
    DiffText    = { fg = colors.diff_text, bg = colors.gray },
    DiffFile    = { fg = colors.pink },
    -- DiffIndexLine     = { fg = colors.gray3 },

    -- EndOfBuffer = { fg = colors.bg },
    Error     = { fg = colors.red_key_w, bg = colors.bg, style = 'bold' },
    ErrorMsg  = { fg = colors.white, bg = colors.red_err, style = 'bold' },
    Exception = { fg = colors.white },

    Float       = { fg = colors.orange },
    FloatBorder = { fg = colors.gray2, bg = "NONE" },
    FoldColumn  = { fg = colors.line_fg, bg = bg_or_none(colors.bg) },
    Folded      = { fg = colors.white, bg = colors.gray },
    Function    = { fg = colors.green_func },

    Identifier = { fg = colors.white1 },
    Ignore     = { fg = colors.gray_punc },
    IncSearch  = { fg = colors.bg, bg = colors.orange },
    Include    = { fg = colors.blue_type },

    Keyword = { fg = colors.red_key_w },

    Label  = { fg = colors.red_key_w },
    LineNr = { fg = colors.line_fg, bg = bg_or_none(colors.line_bg) },

    Macro         = { fg = colors.blue_type },
    MatchParen    = { fg = colors.white1, bg = colors.black },
    MatchParenCur = { style = 'underline' },
    MatchWord     = { style = 'underline' },
    MatchWordCur  = { style = 'underline' },
    ModeMsg       = { fg = colors.fg, bg = colors.bg },
    MoreMsg       = { fg = colors.orange_wr },
    MsgArea       = { fg = colors.fg, bg = bg_or_none(colors.bg) },
    MsgSeparator  = { fg = colors.fg, bg = colors.bg },

    NonText     = { fg = colors.gray2 },
    Normal      = { fg = colors.fg, bg = bg_or_none(colors.bg) },
    NormalFloat = { fg = colors.fg, bg = bg_or_none(colors.dark) },
    FloatTitle  = { fg = colors.blue_type, bg = bg_or_none(colors.dark), style = 'bold' },
    FloatFooter = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    NormalNC    = { fg = colors.white, bg = bg_or_none(colors.bg) },
    Number      = { fg = colors.orange },

    Operator   = { fg = colors.white },
    Pmenu      = { fg = colors.white1, bg = bg_or_none(colors.black) },
    PmenuSbar  = { bg = colors.gray },
    PmenuSel   = { fg = colors.white, bg = colors.selection_fg, style = 'bold' },
    PmenuThumb = { bg = colors.line_fg },
    PmenuMatch = { fg = colors.blue_type, style = 'bold' },
    PmenuKind  = { fg = colors.green_func, bg = colors.black },
    PmenuExtra = { fg = colors.gray2, bg = colors.black },
    PreCondit  = { fg = colors.blue_type },
    PreProc    = { fg = colors.blue_type },

    Question     = { fg = colors.green_func },
    QuickFixLine = { fg = colors.orange_wr },

    Repeat = { fg = colors.red_key_w },

    CurSearch           = { fg = colors.bg, bg = colors.yellow, style = 'bold' },
    Search              = { fg = colors.line_fg, bg = colors.orange },
    SignColumn          = { bg = bg_or_none(colors.line_bg) },
    Special             = { fg = colors.gray_punc },
    SpecialChar         = { fg = colors.yellow },
    SpecialComment      = { fg = colors.pink },
    SpecialKey          = { fg = colors.gray_punc, style = 'bold' },
    SpellBad            = { fg = colors.red_key_w, style = 'underline' },
    SpellCap            = { fg = colors.orange, style = 'underline' },
    SpellLocal          = { fg = colors.green, style = 'underline' },
    SpellRare           = { fg = colors.pink, style = 'underline' },
    Statement           = { fg = colors.red_key_w },
    StatusLine          = { fg = colors.dark, bg = colors.gray_punc },
    StatusLineNC        = { fg = colors.dark, bg = colors.gray_punc },
    StatusLineSeparator = { fg = colors.dark },
    StatusLineTerm      = { fg = colors.green_func, bg = colors.black },
    StatusLineTermNC    = { fg = colors.gray_punc, bg = colors.black },
    StorageClass        = { fg = colors.blue_type },
    String              = { fg = colors.yellow },
    Structure           = { fg = colors.green_func },
    Substitute          = { fg = colors.gray2, bg = colors.orange },

    TabLine      = { fg = colors.line_fg },
    TabLineFill  = { fg = colors.line_fg },
    TabLineSel   = { fg = colors.fg },
    Tag          = { fg = colors.gray_punc },
    TermCursor   = { fg = colors.cursor_fg, bg = colors.cursor_bg },
    TermCursorNC = { fg = colors.cursor_fg, bg = colors.cursor_bg },
    Title        = { fg = colors.gray_punc },
    Todo         = { fg = colors.yellow, style = 'bold' },
    Type         = { fg = colors.blue_type },
    Typedef      = { fg = colors.blue_type },

    Variable    = { fg = colors.variable },
    VertSplit   = { fg = colors.vsplit_fg, bg = colors.vsplit_bg },
    WinSeparator = { fg = colors.vsplit_fg, bg = bg_or_none(colors.bg) },
    WinBar      = { fg = colors.gray_punc, bg = bg_or_none(colors.bg) },
    WinBarNC    = { fg = colors.line_fg, bg = bg_or_none(colors.bg) },
    Visual    = { fg = "NONE", bg = colors.visual_select_bg, style = 'bold' },
    VisualNOS = { fg = colors.selection_fg, bg = colors.selection_bg },

    WarningMsg = { fg = colors.orange_wr, bg = colors.none },
    Whitespace = { fg = colors.non_text },
    WildMenu   = { fg = colors.fg },
    lCursor    = { fg = colors.cursor_fg, bg = colors.cursor_bg },

    -- Markdown, JSON, YAML etc. are highlighted by treesitter here, so the
    -- legacy vim-regex markdown* groups can never fire. Styling lives in the
    -- @markup.* captures in theme.plugins instead.

}

theme.plugins = {

    -----------------------------------------

    WhichKey = { fg = colors.blue_type, },
    WhichKeySeperator = { fg = colors.red_key_w, },
    WhichKeyGroup = { fg = colors.pink },
    WhichKeyDesc = { fg = colors.white },
    WhichKeyFloat = { bg = bg_or_none(colors.dark) },

    -----------------------------------------
    --   Cmp:    github.com/hrsh7th/nvim-cmp
    -----------------------------------------
    CmpDocumentation       = { fg = colors.fg },
    CmpDocumentationBorder = { fg = colors.gray2 },
    -----------------------------------------
    --   blink.cmp: github.com/Saghen/blink.cmp  (the active completer)
    -----------------------------------------
    BlinkCmpMenu              = { fg = colors.white1, bg = bg_or_none(colors.dark) },
    BlinkCmpMenuBorder        = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    BlinkCmpMenuSelection     = { fg = colors.white, bg = colors.selection_fg, style = 'bold' },
    BlinkCmpScrollBarThumb    = { bg = colors.line_fg },
    BlinkCmpScrollBarGutter   = { bg = colors.black1 },
    BlinkCmpLabel             = { fg = colors.white1 },
    BlinkCmpLabelDeprecated   = { fg = colors.gray2, style = 'strikethrough' },
    BlinkCmpLabelMatch        = { fg = colors.blue_type, style = 'bold' },
    BlinkCmpLabelDetail       = { fg = colors.comment },
    BlinkCmpLabelDescription  = { fg = colors.comment },
    BlinkCmpKind              = { fg = colors.green_func },
    BlinkCmpKindClass         = { fg = colors.blue_type },
    BlinkCmpKindStruct        = { fg = colors.blue_type },
    BlinkCmpKindInterface     = { fg = colors.blue_type },
    BlinkCmpKindEnum          = { fg = colors.blue_type },
    BlinkCmpKindMethod        = { fg = colors.green_func },
    BlinkCmpKindFunction      = { fg = colors.green_func },
    BlinkCmpKindConstructor   = { fg = colors.yellow },
    BlinkCmpKindVariable      = { fg = colors.variable },
    BlinkCmpKindField         = { fg = colors.white },
    BlinkCmpKindProperty      = { fg = colors.white },
    BlinkCmpKindConstant      = { fg = colors.pink },
    BlinkCmpKindEnumMember    = { fg = colors.orange },
    BlinkCmpKindKeyword       = { fg = colors.red_key_w },
    BlinkCmpKindSnippet       = { fg = colors.orange_wr },
    BlinkCmpSource            = { fg = colors.pink },
    BlinkCmpDoc               = { fg = colors.fg, bg = bg_or_none(colors.dark) },
    BlinkCmpDocBorder         = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    BlinkCmpDocSeparator      = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    BlinkCmpSignatureHelp     = { fg = colors.fg, bg = bg_or_none(colors.dark) },
    BlinkCmpSignatureHelpBorder      = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    BlinkCmpSignatureHelpActiveParameter = { fg = colors.orange_wr, style = 'bold' },
    BlinkCmpGhostText         = { fg = colors.line_fg, style = 'italic' },
    -----------------------------------------
    --   Diffview
    -----------------------------------------
    DiffViewNormal             = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    -----------------------------------------
    --   Gitsigns: github.com/lewis6991/gitsigns.nvim
    -----------------------------------------
    GitSignsAdd    = { fg = colors.green_func, bg = colors.line_bg },
    GitSignsChange = { fg = colors.diff_change, bg = colors.line_bg },
    GitSignsDelete = { fg = colors.red_key_w, bg = colors.line_bg },
    -----------------------------------------
    --   snacks.nvim: github.com/folke/snacks.nvim (LazyVim default picker)
    -----------------------------------------
    SnacksIndent          = { fg = colors.black1 },
    SnacksIndentScope     = { fg = colors.context },
    SnacksNormal          = { fg = colors.fg, bg = bg_or_none(colors.dark) },
    SnacksNormalNC        = { fg = colors.white1, bg = bg_or_none(colors.dark) },
    SnacksWinBar          = { fg = colors.blue_type, bg = bg_or_none(colors.dark), style = 'bold' },
    SnacksBackdrop        = { bg = colors.black },
    SnacksPicker          = { fg = colors.fg, bg = bg_or_none(colors.dark) },
    SnacksPickerBorder    = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    SnacksPickerTitle     = { fg = colors.blue_type, style = 'bold' },
    SnacksPickerMatch     = { fg = colors.orange_wr, style = 'bold' },
    SnacksPickerDir       = { fg = colors.comment },
    SnacksPickerFile      = { fg = colors.white1 },
    SnacksPickerPathHidden = { fg = colors.gray2 },
    SnacksPickerCursorLine = { bg = colors.black1 },
    SnacksPickerPrompt    = { fg = colors.red_key_w },
    SnacksPickerInputBorder = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    SnacksNotifierInfo    = { fg = colors.yellow },
    SnacksNotifierWarn    = { fg = colors.orange_wr },
    SnacksNotifierError   = { fg = colors.red_err },
    SnacksNotifierDebug   = { fg = colors.comment },
    SnacksNotifierTrace   = { fg = colors.pink },
    SnacksDashboardHeader = { fg = colors.blue_type },
    SnacksDashboardTitle  = { fg = colors.white, style = 'bold' },
    SnacksDashboardIcon   = { fg = colors.orange },
    SnacksDashboardDesc   = { fg = colors.white1 },
    SnacksDashboardKey    = { fg = colors.red_key_w },
    SnacksDashboardFooter = { fg = colors.comment },
    -----------------------------------------
    --   Lsp: neovim.io/doc/user/lsp.html
    -----------------------------------------
    DiagnosticVirtualTextInfo = { fg = colors.yellow },
    DiagnosticHint            = { fg = colors.blue_type },
    DiagnosticError           = { fg = colors.red_err },
    DiagnosticInfo            = { fg = colors.yellow },
    DiagnosticVirtualTextWarn = { fg = colors.orange_wr },
    DiagnosticWarn            = { fg = colors.orange_wr },

    DiagnosticFloatingError = { fg = colors.red_err },
    DiagnosticFloatingHint  = { fg = colors.blue_type },
    DiagnosticFloatingInfo  = { fg = colors.yellow },
    DiagnosticFloatingWarn  = { fg = colors.orange_wr },

    DiagnosticSignError = { fg = colors.red_err, bg = colors.line_bg },
    DiagnosticSignHint  = { fg = colors.blue_type, bg = colors.line_bg },
    DiagnosticSignInfo  = { fg = colors.yellow, bg = colors.line_bg },
    DiagnosticSignWarn  = { fg = colors.orange_wr, bg = colors.line_bg },

    DiagnosticUnderlineError = { sp = colors.red_err, style = 'undercurl' },
    DiagnosticUnderlineHint  = { sp = colors.blue_type, style = 'undercurl' },
    DiagnosticUnderlineInfo  = { sp = colors.yellow, style = 'undercurl' },
    DiagnosticUnderlineWarn  = { sp = colors.orange_wr, style = 'undercurl' },

    DiagnosticVirtualTextError = { fg = colors.red_err },
    DiagnosticVirtualTextHint  = { fg = colors.gray2 },

    -- Emitted heavily by pyright/lua_ls/vtsls for unused imports and locals.
    DiagnosticUnnecessary = { fg = colors.line_fg, style = 'undercurl' },
    DiagnosticDeprecated  = { fg = colors.gray2, style = 'strikethrough' },
    DiagnosticOk          = { fg = colors.green_func },

    DiagnosticVirtualTextOk = { fg = colors.green_func },
    DiagnosticFloatingOk    = { fg = colors.green_func },
    DiagnosticSignOk        = { fg = colors.green_func, bg = colors.line_bg },
    -----------------------------------------
    -- NerdTree: github.com/preservim/nerdtree
    -----------------------------------------
    Directory               = { fg = colors.white },

    -----------------------------------------
    --   LspDiagnostics:
    -----------------------------------------
    LspReferenceRead  = { bg = colors.black1, style = 'bold' },
    LspReferenceText  = { bg = colors.black1, style = 'bold' },
    LspReferenceWrite = { bg = colors.black1, style = 'bold' },

    LspInlayHint                = { fg = colors.line_fg, bg = colors.black1, style = 'italic' },
    LspSignatureActiveParameter = { fg = colors.orange_wr, style = 'bold' },
    LspCodeLens                 = { fg = colors.comment, style = 'italic' },
    LspCodeLensSeparator        = { fg = colors.line_fg },
    LspInfoBorder               = { fg = colors.gray2, bg = bg_or_none(colors.dark) },
    -----------------------------------------
    --    telescope: github.com/nvim-telescope/telescope.nvim
    -----------------------------------------
    TelescopeBorder       = { fg = colors.white, bg = bg_or_none(colors.bg) },
    TelescopeMatching     = { fg = colors.blue_type },
    TelescopePromptPrefix = { fg = colors.green_func },
    TelescopeSelection    = { fg = colors.line_fg, bg = colors.black },
    -----------------------------------------
    TroubleTextInformation = { fg = colors.blue_type },
    TroubleFile = { fg = colors.yellow }, -- the source file that has error
    TroubleFoldIcon = { fg = colors.blue_type }, -- fold icon color
    TroubleCount = { fg = colors.red_key_w },
    TroubleError = { fg = colors.red_key_w, bg = colors.line_fg },

    TroubleTextError = { fg = colors.red_key_w }, -- error info text
    TroubleNormal = { fg = colors.white },
    TroubleLocation = { fg = colors.white }, -- location of error
    TroubleIndent = { fg = colors.comment }, -- indent color

    TroubleCode = { fg = colors.orange_wr },
    TroubleSignError = { fg = colors.red_key_w }, -- error sign color

    TroubleSignWarning     = { fg = colors.orange_wr },
    TroubleWarning         = { fg = colors.orange_wr },
    TroublePreview         = { fg = colors.red_key_w },
    TroubleSignInformation = { fg = colors.white },

    TroubleSource = { fg = colors.blue_type },
    TroubleSignHint = { fg = colors.green },
    TroubleSignOther = { fg = colors.green },
    TroubleTextWarning = { fg = colors.orange_wr },
    TroubleInformation = { fg = colors.white },
    TroubleHint = { fg = colors.orange_wr },
    TroubleTextHint = { fg = colors.white },
    TroubleText = { fg = colors.white },

    -----------------------------------------

    -----------------------------------------
    -- treesitter:  github.com/nvim-treesitter/nvim-treesitter
    -----------------------------------------
    -- Capture names follow the nvim 0.10+ standard set. nvim auto-links
    -- `@a.b` down to `@a`, so only the specific captures that should differ
    -- from their parent need an entry here.

    -- Identifiers
    ["@variable"]           = { fg = colors.variable, style = config.italic_variables },
    ["@variable.builtin"]   = { fg = colors.pink },
    ["@variable.parameter"] = { fg = colors.white },
    ["@variable.member"]    = { fg = colors.white },
    ["@property"]           = { fg = colors.white },
    ["@field"]              = { fg = colors.white },

    -- Modules / imports. Without this `@module` falls through to `Structure`
    -- and imported names render function-green in every language.
    ["@module"]             = { fg = colors.blue_type },
    ["@module.builtin"]     = { fg = colors.blue_type },

    -- Constants and literals
    ["@constant"]           = { fg = colors.pink },
    ["@constant.builtin"]   = { fg = colors.pink },
    ["@constant.macro"]     = { fg = colors.blue_type },
    ["@boolean"]            = { fg = colors.boolean, style = config.italic_booleans },
    ["@number"]             = { fg = colors.pink },
    ["@number.float"]       = { fg = colors.pink },
    ["@character"]          = { fg = colors.yellow },
    ["@character.special"]  = { fg = colors.yellow },

    -- Strings
    ["@string"]             = { fg = colors.yellow },
    ["@string.escape"]      = { fg = colors.boolean },
    ["@string.regexp"]      = { fg = colors.yellow },
    ["@string.special"]     = { fg = colors.yellow },
    ["@string.special.url"]    = { fg = colors.yellow, style = 'underline' },
    ["@string.special.path"]   = { fg = colors.yellow },
    ["@string.special.symbol"] = { fg = colors.white },

    -- Functions
    ["@function"]              = { fg = colors.green_func, style = config.italic_functions },
    ["@function.call"]         = { fg = colors.green_func },
    ["@function.builtin"]      = { fg = colors.green_func },
    ["@function.macro"]        = { fg = colors.blue_type },
    ["@function.method"]       = { fg = colors.green_func },
    ["@function.method.call"]  = { fg = colors.green_func },
    ["@constructor"]           = { fg = colors.blue_type },

    -- Keywords
    ["@keyword"]             = { fg = colors.red_key_w, style = config.italic_keywords },
    ["@keyword.function"]    = { fg = colors.red_key_w },
    ["@keyword.operator"]    = { fg = colors.red_key_w },
    ["@keyword.return"]      = { fg = colors.red_key_w },
    ["@keyword.import"]      = { fg = colors.red_key_w },
    ["@keyword.conditional"] = { fg = colors.red_key_w },
    ["@keyword.repeat"]      = { fg = colors.red_key_w },
    ["@keyword.exception"]   = { fg = colors.red_key_w },
    ["@keyword.coroutine"]   = { fg = colors.red_key_w },
    ["@keyword.directive"]   = { fg = colors.red_key_w },
    ["@keyword.modifier"]    = { fg = colors.red_key_w },
    -- Go `var`/`const`, Rust `static`, C `static`: these read as types, not flow.
    ["@keyword.storage"]     = { fg = colors.blue_type },

    -- Types
    ["@type"]              = { fg = colors.blue_type },
    ["@type.builtin"]      = { fg = colors.red_key_w },
    ["@type.definition"]   = { fg = colors.red_key_w },
    ["@attribute"]         = { fg = colors.yellow },
    ["@attribute.builtin"] = { fg = colors.yellow },
    ["@label"]             = { fg = colors.pink },
    ["@operator"]          = { fg = colors.red_key_w },

    -- Punctuation
    ["@punctuation.bracket"]   = { fg = colors.gray_punc },
    ["@punctuation.delimiter"] = { fg = colors.gray_punc },
    ["@punctuation.special"]   = { fg = colors.gray_punc },

    -- Comments. Without the four below, TODO/FIXME stop standing out in
    -- every treesitter-highlighted language.
    ["@comment"]         = { fg = colors.comment, style = config.italic_comments },
    ["@comment.todo"]    = { fg = colors.yellow, style = 'bold' },
    ["@comment.note"]    = { fg = colors.blue_type, style = 'bold' },
    ["@comment.warning"] = { fg = colors.orange_wr, style = 'bold' },
    ["@comment.error"]   = { fg = colors.red_err, style = 'bold' },

    -- Markup (markdown, rst, org, and doc comments in every language)
    ["@markup"]                = { fg = colors.fg },
    ["@markup.heading"]        = { fg = colors.white, style = 'bold' },
    ["@markup.heading.1"]      = { fg = colors.red_key_w, style = 'bold' },
    ["@markup.heading.2"]      = { fg = colors.orange, style = 'bold' },
    ["@markup.heading.3"]      = { fg = colors.yellow, style = 'bold' },
    ["@markup.heading.4"]      = { fg = colors.green_func, style = 'bold' },
    ["@markup.heading.5"]      = { fg = colors.blue_type, style = 'bold' },
    ["@markup.heading.6"]      = { fg = colors.pink, style = 'bold' },
    ["@markup.strong"]         = { fg = colors.white, style = 'bold' },
    ["@markup.italic"]         = { style = 'italic' },
    ["@markup.strikethrough"]  = { style = 'strikethrough' },
    ["@markup.underline"]      = { style = 'underline' },
    ["@markup.raw"]            = { fg = colors.orange },
    ["@markup.raw.block"]      = { fg = colors.orange },
    ["@markup.quote"]          = { fg = colors.accent, style = 'italic' },
    ["@markup.math"]           = { fg = colors.boolean },
    ["@markup.link"]           = { fg = colors.pink },
    ["@markup.link.label"]     = { fg = colors.white },
    ["@markup.link.url"]       = { fg = colors.yellow, style = 'underline' },
    ["@markup.list"]           = { fg = colors.red_key_w },
    ["@markup.list.checked"]   = { fg = colors.green_func },
    ["@markup.list.unchecked"] = { fg = colors.gray2 },

    -- Tags (HTML, JSX, XML, Vue)
    ["@tag"]           = { fg = colors.red_key_w },
    ["@tag.builtin"]   = { fg = colors.red_key_w },
    ["@tag.attribute"] = { fg = colors.orange },
    ["@tag.delimiter"] = { fg = colors.gray_punc },

    -- The `diff` parser: diff/gitcommit buffers, fugitive, patch files.
    ["@diff.plus"]  = { fg = colors.diff_add },
    ["@diff.minus"] = { fg = colors.red_err },
    ["@diff.delta"] = { fg = colors.diff_change },

    -- `@none` is treesitter's sentinel for "suppress highlighting" (upstream
    -- python uses it for f-string interpolation); it must not carry a colour.
    -----------------------------------------
    -- LSP semantic tokens: neovim.io/doc/user/lsp.html#lsp-semantic-highlight
    -- nvim links @lsp.type.* to the matching @-capture by default, so only
    -- the modifiers and the groups with no capture equivalent need entries.
    -----------------------------------------
    ["@lsp.type.namespace"]     = { fg = colors.blue_type },
    ["@lsp.type.enumMember"]    = { fg = colors.orange },
    ["@lsp.type.typeParameter"] = { fg = colors.blue_type },
    ["@lsp.type.selfKeyword"]   = { fg = colors.pink },
    ["@lsp.mod.readonly"]       = { fg = colors.pink },
    ["@lsp.mod.deprecated"]     = { style = 'strikethrough' },
    ["@lsp.typemod.variable.readonly"] = { fg = colors.pink },
    ["@lsp.typemod.function.defaultLibrary"] = { fg = colors.green_func },
    ["@lsp.typemod.variable.defaultLibrary"] = { fg = colors.pink },
    -----------------------------------------

}

-- :terminal, lazygit, and any embedded shell read these; util.load maps the
-- list onto vim.g.terminal_color_0 .. _15.
theme.terminal = {
  colors.black,      -- 0  black
  colors.red_err,    -- 1  red
  colors.green_func, -- 2  green
  colors.yellow,     -- 3  yellow
  colors.blue_type,  -- 4  blue
  colors.boolean,    -- 5  magenta
  colors.diff_change,-- 6  cyan
  colors.white1,     -- 7  white
  colors.line_fg,    -- 8  bright black
  colors.red_key_w,  -- 9  bright red
  colors.diff_add,   -- 10 bright green
  colors.orange_wr,  -- 11 bright yellow
  colors.diff_text,  -- 12 bright blue
  colors.pink,       -- 13 bright magenta
  colors.accent,     -- 14 bright cyan
  colors.fg,         -- 15 bright white
}

-----------------------------------------
--        Apply
-----------------------------------------

-- Attributes nvim_set_hl accepts as booleans. Anything else in a `style`
-- string is ignored rather than silently producing a broken highlight.
local ATTRIBUTES = {
  'bold',
  'italic',
  'underline',
  'undercurl',
  'underdouble',
  'underdotted',
  'underdashed',
  'strikethrough',
  'reverse',
  'standout',
  'nocombine',
}

local function color(value)
  if value == nil or value == 'NONE' or value == 'none' then
    return nil
  end
  return value
end

local function highlight(group, properties)
  if properties.link then
    vim.api.nvim_set_hl(0, group, { link = properties.link })
    return
  end

  local spec = {
    fg = color(properties.fg),
    bg = color(properties.bg),
    sp = color(properties.sp),
    blend = properties.blend,
  }

  local style = properties.style
  if style and style ~= 'NONE' and style ~= 'none' then
    for _, attribute in ipairs(ATTRIBUTES) do
      if style:find(attribute, 1, true) then
        spec[attribute] = true
      end
    end
  end

  vim.api.nvim_set_hl(0, group, spec)
end

-- Explicit order: iterating the theme table with `pairs` left precedence
-- between base and plugins up to Lua's table iteration order.
for _, section in ipairs { theme.base, theme.plugins } do
  for group, properties in pairs(section) do
    highlight(group, properties)
  end
end

-- :terminal, lazygit and any embedded shell read these.
for index, value in ipairs(theme.terminal) do
  vim.g['terminal_color_' .. (index - 1)] = value
end

vim.g.colors_name = 'oh-lucy-evening-custom'
