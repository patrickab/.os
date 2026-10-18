; extends

; Keep inline formatting above the list's base text color.
((list_item
  (paragraph) @markup.list.text)
  (#set! priority 90))
