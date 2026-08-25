/*
 * Popup card sizing for the menu and clipboard pickers. Plugins cannot import
 * across plugin directories, so this module is intentionally duplicated.
 * Row sizes are floored and folded at complete-row boundaries to prevent clips.
 */

var CARD_SIZE_FRACTION = 0.382

function cardWidth(panelWidth, gapsOut) {
  return Math.min(Math.round(panelWidth * CARD_SIZE_FRACTION), panelWidth - gapsOut * 2)
}

function cardHeight(panelHeight, gapsOut) {
  return Math.min(Math.round(panelHeight * CARD_SIZE_FRACTION), panelHeight - gapsOut * 2)
}

function listCapacity(cardHeightPx, contentMargin, headerHeight, contentSpacing) {
  return cardHeightPx - contentMargin * 2 - headerHeight - contentSpacing
}

function rowHeight(capacity, rowSpacing, rowCount) {
  return Math.floor((capacity - (rowCount - 1) * rowSpacing) / rowCount)
}

function foldedListHeight(totals, available, fallbackHeight) {
  var count = totals.length
  if (count === 0) return fallbackHeight

  if (totals[count - 1] <= available) return totals[count - 1]

  var full = 0
  while (full < count && totals[full] <= available) full++
  if (full < 1) return Math.max(available, fallbackHeight)

  return totals[full - 1]
}

function foldedUniformListHeight(count, uniformRowHeight, rowSpacing, available, fallbackHeight) {
  if (count === 0) return fallbackHeight

  var total = count * uniformRowHeight + (count - 1) * rowSpacing
  if (total <= available) return total

  var full = Math.floor((available + rowSpacing) / (uniformRowHeight + rowSpacing))
  if (full < 1) return Math.max(available, fallbackHeight)

  return full * uniformRowHeight + (full - 1) * rowSpacing
}
