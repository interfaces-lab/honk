# @honk/app

React/Vite application for Honk's web UI and desktop renderer.

- `src/routes` contains TanStack Router contracts only: guards, search validation, loader wiring, and component references.
- `src/app/routes` contains route surfaces and route-level composition.
- `src/components` contains reusable app components that know about Honk state, stores, RPC, or environment runtime.
- Reusable primitives come from `@honk/honkkit/*`; do not recreate local primitive wrappers in this package.
- Keep shareable route state in typed URL/search params. Keep domain state in stores or TanStack Query caches.
