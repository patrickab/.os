;; extends

;; `from x import y` — colour lowercase imported symbols like their call sites.
;;
;; This is a naming heuristic, not semantics: `from os import environ` renders a
;; dict as a function. It stays a query because "imported callable" is not
;; expressible as a highlight group — no @-capture and no LSP semantic token
;; distinguishes it from any other imported name.
;;
;; Capitalised names are deliberately not re-captured: upstream already tags
;; them @type (^[A-Z].*[a-z]) or @constant (SCREAMING_CASE), and a broader
;; ^[A-Z] here regressed `from x import MAX_LEN` from constant to type.

((import_from_statement
   name: (dotted_name (identifier) @function))
 (#lua-match? @function "^[a-z_]"))

((import_from_statement
   name: (aliased_import
           name: (dotted_name (identifier) @function)
           alias: (identifier) @function))
 (#lua-match? @function "^[a-z_]"))
