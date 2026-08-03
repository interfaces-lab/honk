# Patterns

- Compose shell anatomy with `Shell.Panel`, `Shell.Split`, and `Shell.Region`; do not reproduce its
  paint at call sites.
- Use shared `Button`, `IconButton`, `Picker`, `ListRow`, and `Menu` semantics. Layout wrappers may
  position controls but not repaint their chrome.
- Use on-self state attributes and Base UI starting/ending attributes. Include reduced-motion behavior.
- For environment reads use an external store; for element measurement use callback-ref observers.
- Keep tabs presentational: stores own state and pass intents; pointer capture avoids conflicts with
  desktop drag regions.
- Honest controls render interaction semantics only when the corresponding action exists.

These are routed implementation patterns, not universal standards. Read the matching exemplar and
owning source before applying one.
