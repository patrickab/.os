-- Change the default Omarchy look'n'feel.

-- https://wiki.hypr.land/Configuring/Basics/Variables/#general
-- hl.config({
--   general = {
--     -- No gaps between windows or borders.
--     gaps_in = 0,
--     gaps_out = 0,
--     border_size = 0,
--
--     -- Change to niri-like side-scrolling layout.
--     layout = "scrolling",
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#general
-- Active and inactive window borders both fully transparent (no hue at all).
hl.config({
  general = {
    -- Tighter than Omarchy's default (5 / 10).
    gaps_in = 2,
    gaps_out = 4,

    col = {
      active_border = "rgba(00000000)",
      inactive_border = "rgba(00000000)",
    },
  },

  -- Same treatment for grouped/stacked windows.
  group = {
    col = {
      border_active = "rgba(00000000)",
      border_inactive = "rgba(00000000)",
    },
  },
})

-- https://wiki.hypr.land/Configuring/Advanced-and-Cool/Animations/
-- Omarchy's default animates the border color/size transition (leaf "border")
-- on every focus change, which reads as a flicker/redraw when cycling the
-- active window within a stacked group. Turn that transition off so the
-- border cue snaps instantly instead of animating.
hl.animation({ leaf = "border", enabled = false })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#decoration
hl.config({
  decoration = {
    rounding = 8,

    blur = {
      enabled = true,
      -- Stronger blur on transparent surfaces than Omarchy's default (4 / 2).
      size = 6,
      passes = 3,
      brightness = 0.60,
      contrast = 0.75,
    },
  },
})

-- Remaining examples below, for reference:
-- hl.config({
--   decoration = {
--     -- Use round window corners.
--     rounding = 8,
--
--     -- Dim unfocused windows (0.0 = no dim, 1.0 = fully dimmed).
--     dim_inactive = true,
--     dim_strength = 0.15,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#animations
-- hl.config({
--   animations = {
--     -- Disable all animations.
--     enabled = false,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#layout
-- hl.config({
--   layout = {
--     -- Avoid overly wide single-window layouts on wide screens.
--     single_window_aspect_ratio = { 1, 1 },
--   },
-- })

-- https://wiki.hypr.land/Configuring/Layouts/Scrolling-Layout/
-- hl.config({
--   scrolling = {
--     -- See only one column per screen instead of two.
--     column_width = 0.97,
--   },
-- })
