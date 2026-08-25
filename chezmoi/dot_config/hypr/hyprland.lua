-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Disable all Omarchy default bindings. Add your own in hypr/bindings.lua.
-- omarchy_default_bindings = false
--
-- Or disable only bindings for Omarchy's preinstalled apps/web apps while
-- keeping core window-manager bindings:
-- omarchy_preinstalled_bindings = false

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")

-- Toggle config flags dynamically.
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })

-- Obsidian glassy transparency (blur handled by Hyprland compositor).
o.window("obsidian", { opacity = "0.78 0.75" })

-- Tried mirroring this as a windowrule on kitty too, but kitty declares a
-- fully-opaque surface once its own background_opacity is 1, and Hyprland
-- won't blur/blend behind that regardless of a windowrule opacity — kitty
-- has to declare its own alpha < 1 for the blur to render at all. See
-- background_opacity in ~/.config/kitty/personal.conf instead.

-- Blur/dim/xray scoped to just the popup card (see Menu.qml's cardBackdrop).
-- no_anim: skip the default layer slide-in animation.
hl.layer_rule({
  match = { namespace = "omarchy-menu-backdrop" },
  blur = true,
  xray = true,
  no_anim = true,
})
