-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- Unify move-focus and group-cycling on the same arrow keys (Pop!_OS style):
-- if the active window is part of a group, cycle the group instead of moving focus.
hl.unbind("SUPER + LEFT")
hl.unbind("SUPER + RIGHT")
hl.unbind("SUPER + UP")
hl.unbind("SUPER + DOWN")
o.bind("SUPER + LEFT", "Focus left / cycle group back", "hypr-smart-focus.sh l")
o.bind("SUPER + RIGHT", "Focus right / cycle group forward", "hypr-smart-focus.sh r")
o.bind("SUPER + UP", "Focus up / cycle group back", "hypr-smart-focus.sh u")
o.bind("SUPER + DOWN", "Focus down / cycle group forward", "hypr-smart-focus.sh d")

-- Unify group join/eject on SUPER+SHIFT+arrow (Pop!_OS style):
-- grouped window -> eject; ungrouped window -> merge into the neighbor.
-- Replaces the default swap-window-in-direction binding and makes the
-- dedicated SUPER+ALT+arrow join binds redundant.
hl.unbind("SUPER + SHIFT + LEFT")
hl.unbind("SUPER + SHIFT + RIGHT")
hl.unbind("SUPER + SHIFT + UP")
hl.unbind("SUPER + SHIFT + DOWN")
o.bind("SUPER + SHIFT + LEFT", "Join group left / eject", "hypr-smart-group.sh l")
o.bind("SUPER + SHIFT + RIGHT", "Join group right / eject", "hypr-smart-group.sh r")
o.bind("SUPER + SHIFT + UP", "Join group up / eject", "hypr-smart-group.sh u")
o.bind("SUPER + SHIFT + DOWN", "Join group down / eject", "hypr-smart-group.sh d")

-- Plain window position swap on SUPER+ALT+arrow (now free - its old job,
-- joining a group, moved to SUPER+SHIFT+arrow above). Useful for rearranging
-- tiles, and for the manual two-step workaround around Hyprland's
-- split-target group merge limitation (unify a split side into one tile via
-- SUPER+SHIFT+arrow, then swap/merge the other window in).
hl.unbind("SUPER + ALT + LEFT")
hl.unbind("SUPER + ALT + RIGHT")
hl.unbind("SUPER + ALT + UP")
hl.unbind("SUPER + ALT + DOWN")
o.bind("SUPER + ALT + LEFT", "Swap window left", hl.dsp.window.swap({ direction = "l" }))
o.bind("SUPER + ALT + RIGHT", "Swap window right", hl.dsp.window.swap({ direction = "r" }))
o.bind("SUPER + ALT + UP", "Swap window up", hl.dsp.window.swap({ direction = "u" }))
o.bind("SUPER + ALT + DOWN", "Swap window down", hl.dsp.window.swap({ direction = "d" }))

hl.unbind("SUPER + G")
o.bind("SUPER + S", "Toggle window grouping", hl.dsp.group.toggle())
