# @honk/shared

Shared runtime utilities used by server, app, desktop, and scripts.

- Use explicit subpath exports such as `@honk/shared/git`; do not add a barrel index.
- Keep utilities small, dependency-light, and independent from UI/runtime ownership.
- If logic is only used by one package, keep it in that package until a second real consumer exists.
