// Shared card-sizing primitive for popup pickers (Menu.qml, Clipboard.qml).
// A menu card is a fixed fraction of the monitor's own width/height (golden
// ratio conjugate), so it always matches the screen's aspect ratio. Row
// height is derived from that same box (the space left after the header and
// padding, split evenly across a target row count) so an exact whole number
// of rows fill it — no row ever clipped mid-way, no leftover blank strip.
//
// Duplicated verbatim into each plugin directory (noob.menu, noob.clipboard)
// rather than shared from one location: plugins here are self-contained,
// there's no shared cross-plugin Commons import path.

var CARD_SIZE_FRACTION = 0.382

function cardWidth(panelWidth, gapsOut, fraction) {
  var f = fraction === undefined ? CARD_SIZE_FRACTION : fraction
  return Math.min(Math.round(panelWidth * f), panelWidth - gapsOut * 2)
}

function cardHeight(panelHeight, gapsOut, fraction) {
  var f = fraction === undefined ? CARD_SIZE_FRACTION : fraction
  return Math.min(Math.round(panelHeight * f), panelHeight - gapsOut * 2)
}

// Space left in the card for the row list itself, after the header/padding.
function listCapacity(cardHeightPx, contentMargin, headerHeight, contentSpacing) {
  return cardHeightPx - contentMargin * 2 - headerHeight - contentSpacing
}

// Row height so exactly rowCount whole rows fill listCapacity(...), with no
// leftover and no row ever clipped mid-way. Floors (not rounds): rounding up
// even a fraction of a pixel, times rowCount rows, can push the total just
// past capacity and force a clip anyway.
function rowHeight(capacity, rowSpacing, rowCount, minHeight) {
  var h = Math.floor((capacity - (rowCount - 1) * rowSpacing) / rowCount)
  return Math.max(h, minHeight || 0)
}

// When every row fits, the list gets its full height. When they don't, stop
// exactly at the last row that fully fits — never show a row cut off
// mid-way. `totals` is cumulative height-through-row-i (rows can vary in
// height, e.g. a detail row); use foldedUniformListHeight below when every
// row is the same height.
function foldedListHeight(totals, available, fallbackHeight) {
  var count = totals.length
  if (count === 0) return fallbackHeight

  if (totals[count - 1] <= available) return totals[count - 1]

  var full = 0
  while (full < count && totals[full] <= available) full++
  if (full < 1) return Math.max(available, fallbackHeight)

  return totals[full - 1]
}

// Closed-form equivalent of foldedListHeight for a uniform-height list (every
// row the same height) — avoids building a totals array just to fold it.
function foldedUniformListHeight(count, uniformRowHeight, rowSpacing, available, fallbackHeight) {
  if (count === 0) return fallbackHeight

  var total = count * uniformRowHeight + (count - 1) * rowSpacing
  if (total <= available) return total

  var full = Math.floor((available + rowSpacing) / (uniformRowHeight + rowSpacing))
  if (full < 1) return Math.max(available, fallbackHeight)

  return full * uniformRowHeight + (full - 1) * rowSpacing
}
