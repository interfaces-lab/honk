# Anti-exemplar: raw and repainted controls

Do not add raw product buttons or repaint shared Button, Picker, ListRow, or Menu chrome in
`packages/app`. This splits interaction behavior from appearance and is mechanically checked by the
existing design lint rules.

Focus-sensitive Lexical listbox options are the documented exception: they retain composite semantics
and editor-focus behavior while reusing canonical row anatomy. App wrappers may own layout; shared
surface, radius, ring, typography, and interaction state remain in `@honk/ui`.
