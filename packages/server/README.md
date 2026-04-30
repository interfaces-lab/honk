# usemulti

Node.js server and CLI package for Multi.

- The server is the process and security boundary between GUI clients and coding-agent runtimes.
- Domain folders under `src` are self-contained. Implementation modules use `Foo.ts`; service contracts/tags use `Foo.service.ts`.
- Do not add `Layers/`, `Services/`, or barrel `index.ts` files.
- Keep schemas shared with the app in `@multi/contracts`; keep runtime utilities shared with the app in `@multi/shared`.
- The package name and binary stay `usemulti`/`multi`.
