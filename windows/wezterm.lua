-- Managed by ~/.os/windows/setup-wsl-windows.sh (source: ~/.os/windows/wezterm.lua)
-- WezTerm on Windows: native window (tiled by komorebi), shell runs in WSL.
-- Mirrors ~/.config/kitty/personal.conf from the Linux side.
local wezterm = require 'wezterm'
local act = wezterm.action
local config = wezterm.config_builder()

-- Open straight into WSL, in the Linux home dir
config.default_domain = 'WSL:Ubuntu-26.04'

-- Font: matches what kitty actually renders. kitty's "JetBrainsMono Nerd Font Thin Italic"
-- isn't a real family name, so kitty falls back to the Regular face (bold/italic auto-picked).
config.font = wezterm.font('JetBrainsMono Nerd Font')
config.font_size = 11.0

-- Window: no title bar (komorebi handles layout), small padding
config.window_decorations = 'RESIZE'
config.window_padding = { left = 2, right = 2, top = 2, bottom = 2 }
config.adjust_window_size_when_changing_font_size = false
-- Close windows/tabs/panes immediately, no "Really kill this window?" prompt
config.window_close_confirmation = 'NeverPrompt'

-- Glass: real Windows acrylic blur behind the terminal
config.window_background_opacity = 0.85
config.win32_system_backdrop = 'Acrylic'
-- Acrylic's default tint is a grey-blue (#2e3440); tint with black so the background stays black like kitty
config.win32_acrylic_accent_color = '#000000'

-- Tabs: hidden until there is more than one
config.hide_tab_bar_if_only_one_tab = true
config.use_fancy_tab_bar = false

config.scrollback_lines = 2000

-- Wez theme (same palette as kitty)
config.colors = {
  foreground = '#b3b3b3',
  background = '#000000',
  cursor_bg = '#AEAFAD',
  cursor_border = '#AEAFAD',
  cursor_fg = '#000000',
  selection_bg = '#4c52f8',
  selection_fg = '#000000',
  split = '#05f721',
  ansi    = { '#000000', '#cc5555', '#55cc55', '#cdcd55', '#5455cb', '#cc55cc', '#7acaca', '#cccccc' },
  brights = { '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff' },
}

-- Keys: Ctrl+Tab / Ctrl+Shift+Tab cycle panes (kitty: next_window / previous_window)
config.keys = {
  { key = 'Tab', mods = 'CTRL',       action = act.ActivatePaneDirection 'Next' },
  { key = 'Tab', mods = 'CTRL|SHIFT', action = act.ActivatePaneDirection 'Prev' },
}

return config
